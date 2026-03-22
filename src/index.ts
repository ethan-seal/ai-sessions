#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { execSync, spawnSync } from "child_process";
import { Database } from "bun:sqlite";

// --- Types ---

type Source = "claude" | "opencode";

interface Session {
  id: string;
  source: Source;
  projectDir: string;
  filePath: string; // JSONL path (claude) or "" (opencode)
  startTime: string; // ISO string
  endTime: string;
  title: string; // opencode title or "" for claude
  firstMessage: string;
  cwd: string;
}

interface ProjectGroup {
  projectDir: string;
  sessions: Session[];
  lastActive: string;
}

// --- Helpers ---

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude", "projects");
const OPENCODE_DB = join(HOME, ".local", "share", "opencode", "opencode.db");
const DEFAULT_BACKUP_DIR = join(HOME, ".ai-sessions-backups");

function tildify(path: string): string {
  return path.startsWith(HOME) ? "~" + path.slice(HOME.length) : path;
}

function untildify(path: string): string {
  return path.startsWith("~") ? HOME + path.slice(1) : path;
}

function dirNameToPath(dirName: string): string {
  const encoded = dirName.replace(/^-/, "");
  const parts = encoded.split("-");
  let resolved = "/";
  let i = 0;

  while (i < parts.length) {
    if (parts[i] === "") {
      i++;
      if (i >= parts.length) break;
      let matched = false;
      for (let j = parts.length; j > i; j--) {
        const segment = "." + parts.slice(i, j).join("-");
        if (existsSync(join(resolved, segment))) {
          resolved = join(resolved, segment);
          i = j;
          matched = true;
          break;
        }
      }
      if (!matched) {
        resolved = join(resolved, "." + parts[i]);
        i++;
      }
      continue;
    }

    let matched = false;
    for (let j = parts.length; j > i; j--) {
      const segment = parts.slice(i, j).join("-");
      if (existsSync(join(resolved, segment))) {
        resolved = join(resolved, segment);
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) {
      resolved = join(resolved, parts[i]);
      i++;
    }
  }

  return tildify(resolved);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sourceTag(source: Source): string {
  return source === "claude" ? "[claude]" : "[opencode]";
}

function outputViaPager(content: string): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(content);
    return;
  }

  const pagerCmd = process.env.PAGER || "less -R";
  const parts = pagerCmd.split(/\s+/);
  const cmd = parts[0];
  const pagerArgs = parts.slice(1);

  const result = spawnSync(cmd, pagerArgs, {
    input: content,
    stdio: ["pipe", "inherit", "inherit"],
  });

  // If pager failed (e.g., less not found), fall back to direct output
  if (result.status !== 0 && result.status !== null) {
    process.stdout.write(content);
  }
}

function formatMessageHeader(role: string, time: string): string {
  const label = `── ${role} [${time}] `;
  const padLen = Math.max(0, 60 - label.length);
  return label + "─".repeat(padLen);
}

function formatToolUse(block: any): string {
  const lines: string[] = [];
  const toolName = block.name || "unknown_tool";
  lines.push(`  [tool_use: ${toolName}]`);

  if (block.input && typeof block.input === "object") {
    for (const [key, value] of Object.entries(block.input)) {
      let display: string;
      if (typeof value === "string") {
        // For long strings, show first 200 chars
        if (value.length > 200) {
          display = value.slice(0, 200) + "...";
        } else {
          display = value;
        }
        // Indent multiline values
        display = display.split("\n").join("\n      ");
      } else {
        display = JSON.stringify(value);
        if (display.length > 200) {
          display = display.slice(0, 200) + "...";
        }
      }
      lines.push(`    ${key}: ${display}`);
    }
  }

  return lines.join("\n");
}

// --- Claude session parsing ---

function cleanMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");
  }
  return "";
}

/**
 * Extract all searchable text from a Claude JSONL record.
 * Handles string content, text blocks, tool_use blocks (stringifies input),
 * and tool_result blocks (extracts text content).
 * Returns { text, role } where role is "user", "assistant", or "tool".
 */
function extractSearchableText(record: any): { text: string; role: string } | null {
  if (record.isMeta) return null;

  const msgContent = record.message?.content;
  if (!msgContent) return null;

  let role: string;
  if (record.type === "user") {
    role = "user";
  } else if (record.type === "assistant") {
    role = "assistant";
  } else {
    return null;
  }

  const parts: string[] = [];

  if (typeof msgContent === "string") {
    parts.push(msgContent);
  } else if (Array.isArray(msgContent)) {
    for (const block of msgContent) {
      if (block.type === "text" && block.text) {
        parts.push(block.text);
      } else if (block.type === "tool_use" && block.input) {
        // Mark role as tool for tool_use matches
        // Stringify input to make all fields searchable (code, file paths, commands, etc.)
        try {
          parts.push(JSON.stringify(block.input));
        } catch {
          // skip if not serializable
        }
        if (block.name) {
          parts.push(block.name);
        }
      } else if (block.type === "tool_result") {
        // tool_result content can be a string or array of text blocks
        if (typeof block.content === "string") {
          parts.push(block.content);
        } else if (Array.isArray(block.content)) {
          for (const sub of block.content) {
            if (sub.type === "text" && sub.text) {
              parts.push(sub.text);
            }
          }
        }
      }
    }
  }

  const text = parts.join("\n");
  if (!text.trim()) return null;

  // Determine if the match is in tool content — check if non-text blocks contributed
  let hasToolContent = false;
  if (Array.isArray(msgContent)) {
    hasToolContent = msgContent.some(
      (block: any) => block.type === "tool_use" || block.type === "tool_result"
    );
  }

  // If the record is an assistant message with tool content, we'll refine the role
  // after the caller checks which part actually matched
  return { text, role: hasToolContent && role === "assistant" ? "assistant" : role };
}

/**
 * Determine the specific role label for a search match within a record.
 * Returns "tool" if the match is found in tool_use/tool_result blocks,
 * otherwise returns the message role.
 */
function matchRoleInRecord(record: any, lower: string): string | null {
  if (record.isMeta) return null;

  const msgContent = record.message?.content;
  if (!msgContent) return null;

  const baseRole = record.type === "user" ? "user" : record.type === "assistant" ? "assistant" : null;
  if (!baseRole) return null;

  if (typeof msgContent === "string") {
    return msgContent.toLowerCase().includes(lower) ? baseRole : null;
  }

  if (Array.isArray(msgContent)) {
    // Check text blocks first
    for (const block of msgContent) {
      if (block.type === "text" && block.text && block.text.toLowerCase().includes(lower)) {
        return baseRole;
      }
    }
    // Check tool_use blocks
    for (const block of msgContent) {
      if (block.type === "tool_use") {
        if (block.name && block.name.toLowerCase().includes(lower)) {
          return "tool";
        }
        if (block.input) {
          try {
            if (JSON.stringify(block.input).toLowerCase().includes(lower)) {
              return "tool";
            }
          } catch {}
        }
      }
    }
    // Check tool_result blocks
    for (const block of msgContent) {
      if (block.type === "tool_result") {
        if (typeof block.content === "string" && block.content.toLowerCase().includes(lower)) {
          return "tool";
        }
        if (Array.isArray(block.content)) {
          for (const sub of block.content) {
            if (sub.type === "text" && sub.text && sub.text.toLowerCase().includes(lower)) {
              return "tool";
            }
          }
        }
      }
    }
  }

  return null;
}

function isMetaOrCommand(text: string): boolean {
  return (
    text.startsWith("<command-name>") ||
    text.startsWith("<local-command-stdout>") ||
    text.startsWith("Caveat: The messages below") ||
    text.trim() === ""
  );
}

function parseClaudeSession(filePath: string): Session | null {
  let data: string;
  try {
    data = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = data.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;

  let sessionId = "";
  let cwd = "";
  let startTime = "";
  let endTime = "";
  let firstMessage = "";

  for (const line of lines) {
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.timestamp) {
      if (!startTime || record.timestamp < startTime) startTime = record.timestamp;
      if (!endTime || record.timestamp > endTime) endTime = record.timestamp;
    }

    if (record.type === "user" && record.sessionId && !sessionId) {
      sessionId = record.sessionId;
    }
    if (record.type === "user" && record.cwd && !cwd) {
      cwd = record.cwd;
    }

    if (
      record.type === "user" &&
      !record.isMeta &&
      record.message?.role === "user" &&
      !firstMessage
    ) {
      const text = cleanMessageContent(record.message.content);
      if (!isMetaOrCommand(text)) {
        firstMessage = text;
      }
    }
  }

  if (!sessionId || !firstMessage) return null;

  const projectDirName = basename(join(filePath, ".."));
  const projectDir = cwd ? tildify(cwd) : dirNameToPath(projectDirName);

  return {
    id: sessionId,
    source: "claude",
    projectDir,
    filePath,
    startTime: startTime || "",
    endTime: endTime || "",
    title: "",
    firstMessage: firstMessage.replace(/\n/g, " ").trim(),
    cwd,
  };
}

function getClaudeSessions(): Session[] {
  if (!existsSync(CLAUDE_DIR)) return [];

  const sessions: Session[] = [];
  const projectDirs = readdirSync(CLAUDE_DIR);

  for (const dir of projectDirs) {
    const dirPath = join(CLAUDE_DIR, dir);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }

    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;
      const session = parseClaudeSession(join(dirPath, file));
      if (session) sessions.push(session);
    }
  }

  return sessions;
}

// --- OpenCode session parsing ---

function getOpencodeSessions(): Session[] {
  if (!existsSync(OPENCODE_DB)) return [];

  let db: Database;
  try {
    db = new Database(OPENCODE_DB, { readonly: true });
  } catch {
    return [];
  }

  try {
    // Get all sessions with their first user message text
    const rows = db.query(`
      SELECT
        s.id,
        s.directory,
        s.title,
        s.time_created,
        s.time_updated,
        (
          SELECT json_extract(p.data, '$.text')
          FROM message m
          JOIN part p ON p.message_id = m.id
          WHERE m.session_id = s.id
            AND json_extract(m.data, '$.role') = 'user'
            AND json_extract(p.data, '$.type') = 'text'
          ORDER BY m.time_created ASC, p.time_created ASC
          LIMIT 1
        ) as first_message
      FROM session s
      WHERE s.time_archived IS NULL
      ORDER BY s.time_updated DESC
    `).all() as any[];

    return rows
      .filter((r) => r.first_message)
      .map((r) => ({
        id: r.id,
        source: "opencode" as Source,
        projectDir: tildify(r.directory),
        filePath: "",
        startTime: new Date(r.time_created).toISOString(),
        endTime: new Date(r.time_updated).toISOString(),
        title: r.title || "",
        firstMessage: (r.first_message as string).replace(/\n/g, " ").trim(),
        cwd: r.directory,
      }));
  } finally {
    db.close();
  }
}

// --- Combined ---

function getAllSessions(): Session[] {
  const claude = getClaudeSessions();
  const opencode = getOpencodeSessions();
  return [...claude, ...opencode];
}

function groupByProject(sessions: Session[]): ProjectGroup[] {
  const groups = new Map<string, Session[]>();

  for (const s of sessions) {
    const existing = groups.get(s.projectDir) || [];
    existing.push(s);
    groups.set(s.projectDir, existing);
  }

  const result: ProjectGroup[] = [];
  for (const [projectDir, projectSessions] of groups) {
    projectSessions.sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    result.push({
      projectDir,
      sessions: projectSessions,
      lastActive: projectSessions[0].startTime,
    });
  }

  result.sort(
    (a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime()
  );

  return result;
}

// --- Commands ---

function cmdList(filter?: string) {
  const sessions = getAllSessions();
  let groups = groupByProject(sessions);

  if (filter) {
    const lower = filter.toLowerCase();
    groups = groups.filter((g) => g.projectDir.toLowerCase().includes(lower));
  }

  if (groups.length === 0) {
    console.log(filter ? `No sessions matching "${filter}"` : "No sessions found.");
    return;
  }

  for (const group of groups) {
    const count = group.sessions.length;
    const lastActive = formatDateShort(group.lastActive);
    console.log(
      `\n${group.projectDir} (${count} session${count !== 1 ? "s" : ""}, last active: ${lastActive})`
    );
    for (const s of group.sessions) {
      const date = formatDate(s.startTime);
      const id = shortId(s.id);
      const tag = sourceTag(s.source);
      const label = s.title || truncate(s.firstMessage, 70);
      console.log(`  ${date}  ${id}  ${tag} "${label}"`);
    }
  }
  console.log();
}

function cmdSearch(term: string) {
  const lower = term.toLowerCase();
  const matches: { session: Session; matchLine: string; role: string }[] = [];

  // Search Claude sessions — all record types (user, assistant, tool)
  for (const session of getClaudeSessions()) {
    let data: string;
    try {
      data = readFileSync(session.filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = data.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.isMeta) continue;

      // Use matchRoleInRecord to find the match and determine the specific role
      const role = matchRoleInRecord(record, lower);
      if (role) {
        // Extract readable text for display context
        const extracted = extractSearchableText(record);
        const displayText = extracted ? extracted.text.replace(/\n/g, " ").trim() : "";
        matches.push({ session, matchLine: displayText, role });
        break; // first match per session for performance
      }
    }
  }

  // Search OpenCode sessions — all message roles
  if (existsSync(OPENCODE_DB)) {
    let db: Database | null = null;
    try {
      db = new Database(OPENCODE_DB, { readonly: true });
      const rows = db.query(`
        SELECT
          s.id,
          s.directory,
          s.title,
          s.time_created,
          s.time_updated,
          json_extract(m.data, '$.role') as match_role,
          json_extract(p.data, '$.text') as match_text
        FROM session s
        JOIN message m ON m.session_id = s.id
        JOIN part p ON p.message_id = m.id
        WHERE s.time_archived IS NULL
          AND json_extract(p.data, '$.type') = 'text'
          AND json_extract(p.data, '$.text') LIKE $pattern
        GROUP BY s.id
        ORDER BY s.time_updated DESC
      `).all({ $pattern: `%${term}%` }) as any[];

      for (const r of rows) {
        const role = r.match_role === "user" ? "user" : "assistant";
        matches.push({
          session: {
            id: r.id,
            source: "opencode",
            projectDir: tildify(r.directory),
            filePath: "",
            startTime: new Date(r.time_created).toISOString(),
            endTime: new Date(r.time_updated).toISOString(),
            title: r.title || "",
            firstMessage: (r.match_text as string).replace(/\n/g, " ").trim(),
            cwd: r.directory,
          },
          matchLine: (r.match_text as string).replace(/\n/g, " ").trim(),
          role,
        });
      }
    } catch {
      // skip if db query fails
    } finally {
      db?.close();
    }
  }

  if (matches.length === 0) {
    console.log(`No sessions found matching "${term}"`);
    return;
  }

  console.log(
    `\nFound ${matches.length} session${matches.length !== 1 ? "s" : ""} matching "${term}":\n`
  );
  for (const { session, matchLine, role } of matches) {
    const date = formatDate(session.startTime);
    const id = shortId(session.id);
    const tag = sourceTag(session.source);
    const preview = truncate(matchLine, 100);
    console.log(`  ${date}  ${id}  ${tag} ${session.projectDir}`);
    console.log(`    [${role}] "${preview}"`);
    console.log();
  }
}

function cmdShow(sessionId: string, short: boolean) {
  const sessions = getAllSessions();
  const session = sessions.find(
    (s) => s.id === sessionId || s.id.startsWith(sessionId)
  );

  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const out: string[] = [];
  out.push(`\nSession: ${session.id}`);
  out.push(`Source:  ${session.source}`);
  out.push(`Project: ${session.projectDir}`);
  out.push(`Started: ${formatDate(session.startTime)}`);
  if (session.title) out.push(`Title:   ${session.title}`);
  out.push(`CWD:     ${session.cwd}`);
  out.push(`${"─".repeat(60)}\n`);

  if (session.source === "claude") {
    showClaudeSession(session, short, out);
  } else {
    showOpencodeSession(session, short, out);
  }

  const content = out.join("\n") + "\n";
  outputViaPager(content);
}

function showClaudeSession(session: Session, short: boolean, out: string[]) {
  let data: string;
  try {
    data = readFileSync(session.filePath, "utf-8");
  } catch {
    console.error(`Could not read session file: ${session.filePath}`);
    process.exit(1);
  }

  const lines = data.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record.type === "user" && !record.isMeta && record.message?.role === "user") {
      const text = cleanMessageContent(record.message.content);
      if (isMetaOrCommand(text)) continue;
      const time = record.timestamp ? formatDate(record.timestamp) : "";

      if (short) {
        out.push(`[${time}] User:`);
        out.push(`  ${truncate(text.replace(/\n/g, " ").trim(), 200)}`);
        out.push("");
      } else {
        out.push(formatMessageHeader("User", time));
        out.push(text.trim());
        out.push("");
      }
    }

    if (record.type === "assistant" && record.message?.role === "assistant") {
      const time = record.timestamp ? formatDate(record.timestamp) : "";
      const msgContent = record.message.content;

      if (short) {
        const text = cleanMessageContent(msgContent);
        if (!text.trim()) continue;
        out.push(`[${time}] Assistant:`);
        out.push(`  ${truncate(text.replace(/\n/g, " ").trim(), 200)}`);
        out.push("");
      } else {
        // Full mode: show text blocks and tool_use blocks
        const parts: string[] = [];
        if (typeof msgContent === "string") {
          parts.push(msgContent);
        } else if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === "text" && block.text) {
              parts.push(block.text);
            } else if (block.type === "tool_use") {
              parts.push(formatToolUse(block));
            }
          }
        }
        const combined = parts.join("\n").trim();
        if (!combined) continue;
        out.push(formatMessageHeader("Assistant", time));
        out.push(combined);
        out.push("");
      }
    }
  }
}

function showOpencodeSession(session: Session, short: boolean, out: string[]) {
  let db: Database;
  try {
    db = new Database(OPENCODE_DB, { readonly: true });
  } catch {
    console.error("Could not open OpenCode database");
    process.exit(1);
  }

  try {
    const messages = db.query(`
      SELECT m.id, m.data, m.time_created
      FROM message m
      WHERE m.session_id = $sessionId
      ORDER BY m.time_created ASC
    `).all({ $sessionId: session.id }) as any[];

    for (const msg of messages) {
      const msgData = JSON.parse(msg.data);
      const role = msgData.role === "user" ? "User" : "Assistant";
      const time = formatDate(new Date(msg.time_created).toISOString());

      // Get text parts for this message
      const parts = db.query(`
        SELECT data FROM part
        WHERE message_id = $msgId
        ORDER BY time_created ASC
      `).all({ $msgId: msg.id }) as any[];

      const textParts = parts
        .map((p: any) => {
          try {
            const pd = JSON.parse(p.data);
            if (pd.type === "text") return pd.text;
          } catch {}
          return null;
        })
        .filter(Boolean);

      if (textParts.length === 0) continue;

      if (short) {
        const text = textParts.join("\n").replace(/\n/g, " ").trim();
        out.push(`[${time}] ${role}:`);
        out.push(`  ${truncate(text, 200)}`);
        out.push("");
      } else {
        const text = textParts.join("\n").trim();
        out.push(formatMessageHeader(role, time));
        out.push(text);
        out.push("");
      }
    }
  } finally {
    db.close();
  }
}

function cmdResume(sessionId: string) {
  const sessions = getAllSessions();
  const session = sessions.find(
    (s) => s.id === sessionId || s.id.startsWith(sessionId)
  );

  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const cwd = session.cwd || untildify(session.projectDir);

  if (!existsSync(cwd)) {
    console.error(`Working directory no longer exists: ${cwd}`);
    process.exit(1);
  }

  const cmd = session.source === "claude"
    ? `claude --resume ${session.id}`
    : `opencode --session ${session.id}`;

  console.log(`Resuming ${session.source} session ${shortId(session.id)} in ${session.projectDir}...`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
  } catch {
    // tool exiting is normal
  }
}

// --- Backup / Restore ---

function formatTimestamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}-${min}-${ss}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getBackupArchives(backupDir: string): string[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => f.startsWith("ai-sessions-backup-") && f.endsWith(".tar.gz"))
    .sort();
}

function cmdBackup(args: string[]) {
  let dest = DEFAULT_BACKUP_DIR;
  let keep = 10;

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dest" && args[i + 1]) {
      dest = untildify(args[i + 1]);
      i++;
    } else if (args[i] === "--keep" && args[i + 1]) {
      keep = parseInt(args[i + 1], 10);
      if (isNaN(keep) || keep < 1) {
        console.error("Error: --keep must be a positive integer.");
        process.exit(1);
      }
      i++;
    }
  }

  // Ensure backup directory exists
  mkdirSync(dest, { recursive: true });

  // Collect source paths that exist
  const claudeDir = join(HOME, ".claude", "projects");
  const sources: { path: string; label: string }[] = [];

  if (existsSync(claudeDir)) {
    sources.push({ path: claudeDir, label: tildify(claudeDir) });
  }
  if (existsSync(OPENCODE_DB)) {
    sources.push({ path: OPENCODE_DB, label: tildify(OPENCODE_DB) });
  }

  if (sources.length === 0) {
    console.log("Nothing to back up: no session data found.");
    return;
  }

  // Build archive
  const timestamp = formatTimestamp();
  const archiveName = `ai-sessions-backup-${timestamp}.tar.gz`;
  const archivePath = join(dest, archiveName);

  // Build tar arguments — paths relative to HOME so restore is predictable
  const tarPaths = sources.map((s) => s.path.slice(HOME.length + 1)); // strip leading HOME/
  const tarCmd = `tar -czf ${archivePath} -C ${HOME} ${tarPaths.join(" ")}`;

  try {
    execSync(tarCmd, { stdio: "pipe" });
  } catch (e: any) {
    console.error(`Error creating archive: ${e.message}`);
    process.exit(1);
  }

  // Count files in archive
  let fileCount = 0;
  try {
    const listing = execSync(`tar -tzf ${archivePath}`, { encoding: "utf-8" });
    fileCount = listing.trim().split("\n").filter((l) => l && !l.endsWith("/")).length;
  } catch {
    // non-critical
  }

  const archiveSize = statSync(archivePath).size;

  console.log(`\nBackup complete:`);
  console.log(`  Archive: ${tildify(archivePath)}`);
  console.log(`  Size:    ${formatBytes(archiveSize)}`);
  console.log(`  Files:   ${fileCount}`);
  console.log(`  Sources:`);
  for (const s of sources) {
    console.log(`    - ${s.label}`);
  }

  // Apply retention policy
  const archives = getBackupArchives(dest);
  if (archives.length > keep) {
    const toDelete = archives.slice(0, archives.length - keep);
    for (const name of toDelete) {
      unlinkSync(join(dest, name));
    }
    console.log(`  Retention: kept ${keep}, deleted ${toDelete.length} old backup${toDelete.length !== 1 ? "s" : ""}`);
  }

  console.log();
}

function cmdRestore(args: string[]) {
  const force = args.includes("--force");

  // Determine backup directory — check for --dest in args
  let dest = DEFAULT_BACKUP_DIR;
  const flagValues = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dest" && args[i + 1]) {
      dest = untildify(args[i + 1]);
      flagValues.add(i + 1);
      i++;
    }
  }

  // The archive argument is the first positional arg (not a flag or flag value)
  const archiveArg = args.find((a, idx) => !a.startsWith("--") && !flagValues.has(idx));

  // If no archive specified, list available backups
  if (!archiveArg) {
    const archives = getBackupArchives(dest);
    if (archives.length === 0) {
      console.log(`No backups found in ${tildify(dest)}`);
      return;
    }
    console.log(`\nAvailable backups in ${tildify(dest)}:\n`);
    for (const name of archives) {
      const size = statSync(join(dest, name)).size;
      console.log(`  ${name}  (${formatBytes(size)})`);
    }
    console.log(`\nTo restore: ${BIN_NAME} restore <archive> --force`);
    console.log();
    return;
  }

  // Resolve archive path
  let archivePath: string;
  if (existsSync(archiveArg)) {
    archivePath = archiveArg;
  } else if (existsSync(join(dest, archiveArg))) {
    archivePath = join(dest, archiveArg);
  } else {
    console.error(`Archive not found: ${archiveArg}`);
    console.error(`Looked in: ${tildify(dest)}`);
    process.exit(1);
  }

  // List what will be overwritten
  let listing: string;
  try {
    listing = execSync(`tar -tzf ${archivePath}`, { encoding: "utf-8" });
  } catch (e: any) {
    console.error(`Error reading archive: ${e.message}`);
    process.exit(1);
  }

  const files = listing.trim().split("\n").filter((l) => l && !l.endsWith("/"));

  console.log(`\nArchive: ${tildify(archivePath)}`);
  console.log(`Files to restore (${files.length}):\n`);

  let existingCount = 0;
  for (const f of files) {
    const fullPath = join(HOME, f);
    const exists = existsSync(fullPath);
    if (exists) existingCount++;
    const marker = exists ? " [EXISTS - will overwrite]" : "";
    console.log(`  ~/${f}${marker}`);
  }
  console.log();

  if (existingCount > 0) {
    console.log(`WARNING: ${existingCount} existing file${existingCount !== 1 ? "s" : ""} will be overwritten.`);
  }

  if (!force) {
    console.log(`\nRe-run with --force to proceed:`);
    console.log(`  ${BIN_NAME} restore ${basename(archivePath)} --force`);
    console.log();
    return;
  }

  // Perform restore
  try {
    execSync(`tar -xzf ${archivePath} -C ${HOME}`, { stdio: "pipe" });
  } catch (e: any) {
    console.error(`Error extracting archive: ${e.message}`);
    process.exit(1);
  }

  console.log(`Restored ${files.length} file${files.length !== 1 ? "s" : ""} to ~/`);
  console.log();
}

// --- Main ---

const BIN_NAME = "ai-sessions";

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "list") {
    cmdList(args[1]);
  } else if (command === "search") {
    if (!args[1]) {
      console.error(`Usage: ${BIN_NAME} search <term>`);
      process.exit(1);
    }
    cmdSearch(args.slice(1).join(" "));
  } else if (command === "show") {
    const showArgs = args.slice(1);
    const short = showArgs.includes("--short");
    const sessionArg = showArgs.find((a) => !a.startsWith("--"));
    if (!sessionArg) {
      console.error(`Usage: ${BIN_NAME} show <session-id> [--short]`);
      process.exit(1);
    }
    cmdShow(sessionArg, short);
  } else if (command === "resume") {
    if (!args[1]) {
      console.error(`Usage: ${BIN_NAME} resume <session-id>`);
      process.exit(1);
    }
    cmdResume(args[1]);
  } else if (command === "backup") {
    cmdBackup(args.slice(1));
  } else if (command === "restore") {
    cmdRestore(args.slice(1));
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Usage: ${BIN_NAME} [command]

Searches and browses sessions from Claude Code and OpenCode.

Commands:
  (none)              List all sessions grouped by project
  list [filter]       List sessions, optionally filtered by project name
  search <term>       Full-text search across all session messages
  show <session-id>   Show full conversation for a session
    --short             Truncated overview (200 chars per message)
  resume <session-id> Resume a session in its original directory

Backup & Restore:
  backup              Create a tar.gz backup of all session data
    --dest <dir>        Backup destination (default: ~/.ai-sessions-backups/)
    --keep <n>          Retention: keep last n backups (default: 10)
  restore             List available backups
    --dest <dir>        Backup directory to list from
  restore <archive>   Show what a backup would restore
    --force             Actually restore (overwrite existing files)
    --dest <dir>        Backup directory to search for archive

Sources:
  Claude Code:  ~/.claude/projects/  (JSONL files)
  OpenCode:     ~/.local/share/opencode/opencode.db  (SQLite)`);
  } else {
    console.error(`Unknown command: ${command}. Run "${BIN_NAME} help" for usage.`);
    process.exit(1);
  }
}

main();
