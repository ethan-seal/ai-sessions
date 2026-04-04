#!/usr/bin/env bun
// @bun

// src/index.ts
import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { execSync, spawnSync } from "child_process";
import { Database } from "bun:sqlite";
var HOME = homedir();
var CLAUDE_DIR = join(HOME, ".claude", "projects");
var OPENCODE_DB = join(HOME, ".local", "share", "opencode", "opencode.db");
var DEFAULT_BACKUP_DIR = join(HOME, ".ai-sessions-backups");
var MAX_TOOL_INPUT_DISPLAY = 200;
var MAX_LIST_LABEL = 70;
var MAX_SEARCH_PREVIEW = 100;
var MAX_SHORT_MESSAGE = 200;
var HEADER_WIDTH = 60;
function readJsonlRecords(filePath) {
  let data;
  try {
    data = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const lines = data.split(`
`).filter((l) => l.trim());
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {}
  }
  return records;
}
function tildify(path) {
  return path.startsWith(HOME) ? "~" + path.slice(HOME.length) : path;
}
function untildify(path) {
  return path.startsWith("~") ? HOME + path.slice(1) : path;
}
function dirNameToPath(dirName) {
  const parts = dirName.replace(/^-/, "").split("-");
  let path = "/";
  let i = 0;
  while (i < parts.length) {
    const isDotfile = parts[i] === "";
    if (isDotfile) {
      i++;
      if (i >= parts.length)
        break;
    }
    const segment = findLongestMatchingSegment(parts.slice(i), path, isDotfile);
    path = join(path, segment.name);
    i += segment.consumed;
  }
  return tildify(path);
}
function findLongestMatchingSegment(parts, basePath, isDotfile) {
  const prefix = isDotfile ? "." : "";
  for (let len = parts.length;len > 0; len--) {
    const name = prefix + parts.slice(0, len).join("-");
    if (existsSync(join(basePath, name))) {
      return { name, consumed: len };
    }
  }
  return { name: prefix + parts[0], consumed: 1 };
}
function truncate(s, max) {
  if (s.length <= max)
    return s;
  return s.slice(0, max - 3) + "...";
}
function snippetAround(text, term, maxLen) {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1)
    return truncate(text, maxLen);
  const contextLen = Math.floor((maxLen - term.length) / 2);
  let start = idx - contextLen;
  let end = idx + term.length + contextLen;
  let prefix = "";
  let suffix = "";
  if (start <= 0) {
    start = 0;
  } else {
    prefix = "...";
    start += 3;
  }
  if (end >= text.length) {
    end = text.length;
  } else {
    suffix = "...";
    end -= 3;
  }
  return prefix + text.slice(start, end) + suffix;
}
function shortId(id) {
  return id.slice(0, 8);
}
function formatDate(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
function formatDateShort(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function sourceTag(source) {
  return source === "claude" ? "[claude]" : "[opencode]";
}
function outputViaPager(content) {
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
    stdio: ["pipe", "inherit", "inherit"]
  });
  if (result.status !== 0 && result.status !== null) {
    process.stdout.write(content);
  }
}
function formatMessageHeader(role, time) {
  const label = `\u2500\u2500 ${role} [${time}] `;
  const padLen = Math.max(0, HEADER_WIDTH - label.length);
  return label + "\u2500".repeat(padLen);
}
function formatToolUse(block) {
  const lines = [];
  const toolName = block.name || "unknown_tool";
  lines.push(`  [tool_use: ${toolName}]`);
  for (const [key, value] of Object.entries(block.input)) {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    const truncated = raw.length > MAX_TOOL_INPUT_DISPLAY ? raw.slice(0, MAX_TOOL_INPUT_DISPLAY) + "..." : raw;
    const display = typeof value === "string" ? truncated.split(`
`).join(`
      `) : truncated;
    lines.push(`    ${key}: ${display}`);
  }
  return lines.join(`
`);
}
function cleanMessageContent(content) {
  if (typeof content === "string")
    return content;
  if (Array.isArray(content)) {
    return content.filter((block) => block.type === "text").map((block) => block.text).join(`
`);
  }
  return "";
}
function extractSearchableText(record) {
  if (record.isMeta)
    return null;
  const msgContent = record.message?.content;
  if (!msgContent)
    return null;
  let role;
  if (record.type === "user") {
    role = "user";
  } else if (record.type === "assistant") {
    role = "assistant";
  } else {
    return null;
  }
  const parts = [];
  if (typeof msgContent === "string") {
    parts.push(msgContent);
  } else if (Array.isArray(msgContent)) {
    for (const block of msgContent) {
      if (block.type === "text" && block.text) {
        parts.push(block.text);
      } else if (block.type === "tool_use" && block.input) {
        try {
          parts.push(JSON.stringify(block.input));
        } catch {}
        if (block.name) {
          parts.push(block.name);
        }
      } else if (block.type === "tool_result") {
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
  const text = parts.join(`
`);
  if (!text.trim())
    return null;
  return { text, role };
}
function matchRoleInRecord(record, lower) {
  if (record.isMeta)
    return null;
  const msgContent = record.message?.content;
  if (!msgContent)
    return null;
  const baseRole = record.type === "user" ? "user" : record.type === "assistant" ? "assistant" : null;
  if (!baseRole)
    return null;
  if (typeof msgContent === "string") {
    return msgContent.toLowerCase().includes(lower) ? baseRole : null;
  }
  if (!Array.isArray(msgContent))
    return null;
  if (msgContent.some((b) => b.type === "text" && b.text && b.text.toLowerCase().includes(lower))) {
    return baseRole;
  }
  for (const block of msgContent) {
    if (block.type === "tool_use") {
      if (block.name?.toLowerCase().includes(lower))
        return "tool";
      try {
        if (JSON.stringify(block.input).toLowerCase().includes(lower))
          return "tool";
      } catch {}
    }
    if (block.type === "tool_result") {
      if (typeof block.content === "string" && block.content.toLowerCase().includes(lower))
        return "tool";
      if (Array.isArray(block.content) && block.content.some((sub) => sub.text?.toLowerCase().includes(lower)))
        return "tool";
    }
  }
  return null;
}
function isMetaOrCommand(text) {
  return text.startsWith("<command-name>") || text.startsWith("<local-command-stdout>") || text.startsWith("Caveat: The messages below") || text.trim() === "";
}
function parseClaudeSession(filePath) {
  const records = readJsonlRecords(filePath);
  if (records.length === 0)
    return null;
  let sessionId = "";
  let cwd = "";
  let startTime = "";
  let endTime = "";
  let firstMessage = "";
  for (const record of records) {
    if (record.timestamp) {
      if (!startTime || record.timestamp < startTime)
        startTime = record.timestamp;
      if (!endTime || record.timestamp > endTime)
        endTime = record.timestamp;
    }
    if (record.type === "user" && record.sessionId && !sessionId) {
      sessionId = record.sessionId;
    }
    if (record.type === "user" && record.cwd && !cwd) {
      cwd = record.cwd;
    }
    if (record.type === "user" && !record.isMeta && record.message?.role === "user" && !firstMessage) {
      const text = cleanMessageContent(record.message.content);
      if (!isMetaOrCommand(text)) {
        firstMessage = text;
      }
    }
  }
  if (!sessionId || !firstMessage)
    return null;
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
    cwd
  };
}
function getClaudeSessions() {
  return getClaudeJsonlPaths().map(parseClaudeSession).filter((s) => s !== null);
}
function safeReaddir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function getClaudeJsonlPaths() {
  if (!existsSync(CLAUDE_DIR))
    return [];
  return safeReaddir(CLAUDE_DIR).map((dir) => join(CLAUDE_DIR, dir)).filter(isDirectory).flatMap((dirPath) => safeReaddir(dirPath).filter((f) => f.endsWith(".jsonl") && !f.startsWith("agent-")).map((f) => join(dirPath, f)));
}
function getOpencodeSessions() {
  if (!existsSync(OPENCODE_DB))
    return [];
  let db;
  try {
    db = new Database(OPENCODE_DB, { readonly: true });
  } catch {
    return [];
  }
  try {
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
    `).all();
    return rows.filter((r) => r.first_message).map((r) => ({
      id: r.id,
      source: "opencode",
      projectDir: tildify(r.directory),
      filePath: "",
      startTime: new Date(r.time_created).toISOString(),
      endTime: new Date(r.time_updated).toISOString(),
      title: r.title || "",
      firstMessage: r.first_message.replace(/\n/g, " ").trim(),
      cwd: r.directory
    }));
  } finally {
    db.close();
  }
}
function getAllSessions() {
  const claude = getClaudeSessions();
  const opencode = getOpencodeSessions();
  return [...claude, ...opencode];
}
function findSession(sessionId) {
  const sessions = getAllSessions();
  const session = sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId));
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  return session;
}
function groupByProject(sessions) {
  const groups = new Map;
  for (const s of sessions) {
    const existing = groups.get(s.projectDir) || [];
    existing.push(s);
    groups.set(s.projectDir, existing);
  }
  return Array.from(groups.entries()).map(([projectDir, projectSessions]) => {
    projectSessions.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    return {
      projectDir,
      sessions: projectSessions,
      lastActive: projectSessions[0].startTime
    };
  }).sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());
}
function sessionCutoff(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
function cmdList(filter, opts = {}) {
  let sessions = getAllSessions();
  if (opts.days !== undefined) {
    const cutoff = sessionCutoff(opts.days);
    sessions = sessions.filter((s) => (s.endTime || s.startTime) >= cutoff);
  }
  let groups = groupByProject(sessions);
  if (opts.cwd) {
    const cwdPath = tildify(process.cwd());
    groups = groups.filter((g) => g.projectDir === cwdPath);
  } else if (filter) {
    const lower = filter.toLowerCase();
    groups = groups.filter((g) => g.projectDir.toLowerCase().includes(lower));
  }
  if (groups.length === 0) {
    console.log(filter || opts.cwd ? "No sessions found." : "No sessions found.");
    return;
  }
  for (const group of groups) {
    const count = group.sessions.length;
    const lastActive = formatDateShort(group.lastActive);
    console.log(`
${group.projectDir} (${count} session${count !== 1 ? "s" : ""}, last active: ${lastActive})`);
    const displaySessions = opts.limit ? group.sessions.slice(0, opts.limit) : group.sessions;
    for (const s of displaySessions) {
      const date = formatDate(s.startTime);
      const id = s.id;
      const tag = sourceTag(s.source);
      const label = s.title || truncate(s.firstMessage, MAX_LIST_LABEL);
      console.log(`  ${date}  ${id}  ${tag} "${label}"`);
    }
    if (opts.limit && count > opts.limit) {
      console.log(`  ... and ${count - opts.limit} more`);
    }
  }
  console.log();
}
function cmdSearch(term, opts = {}) {
  const lower = term.toLowerCase();
  const cutoff = opts.days !== undefined ? sessionCutoff(opts.days) : undefined;
  const cwdFilter = opts.cwd ? tildify(process.cwd()) : undefined;
  const matches = [];
  for (const filePath of getClaudeJsonlPaths()) {
    const records = readJsonlRecords(filePath);
    let sessionId = "";
    let cwd = "";
    let startTime = "";
    let firstMessage = "";
    for (const record of records) {
      if (record.type === "user" && record.sessionId && !sessionId) {
        sessionId = record.sessionId;
      }
      if (record.type === "user" && record.cwd && !cwd) {
        cwd = record.cwd;
      }
      if (record.timestamp && (!startTime || record.timestamp < startTime)) {
        startTime = record.timestamp;
      }
      if (record.type === "user" && !record.isMeta && record.message?.role === "user" && !firstMessage) {
        const text = cleanMessageContent(record.message.content);
        if (!isMetaOrCommand(text))
          firstMessage = text;
      }
    }
    if (!sessionId)
      continue;
    const projectDirName = basename(join(filePath, ".."));
    const projectDir = cwd ? tildify(cwd) : dirNameToPath(projectDirName);
    const session = {
      id: sessionId,
      source: "claude",
      projectDir,
      filePath,
      startTime: startTime || "",
      endTime: "",
      title: "",
      firstMessage: firstMessage.replace(/\n/g, " ").trim(),
      cwd
    };
    for (const record of records) {
      if (record.isMeta)
        continue;
      const role = matchRoleInRecord(record, lower);
      if (role) {
        const extracted = extractSearchableText(record);
        const displayText = extracted ? extracted.text.replace(/\n/g, " ").trim() : "";
        matches.push({ session, matchLine: displayText, role });
        break;
      }
    }
  }
  if (existsSync(OPENCODE_DB)) {
    let db = null;
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
      `).all({ $pattern: `%${term}%` });
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
            firstMessage: r.match_text.replace(/\n/g, " ").trim(),
            cwd: r.directory
          },
          matchLine: r.match_text.replace(/\n/g, " ").trim(),
          role
        });
      }
    } catch {} finally {
      db?.close();
    }
  }
  let filtered = matches;
  if (cwdFilter) {
    filtered = filtered.filter((m) => m.session.projectDir === cwdFilter);
  }
  if (cutoff) {
    filtered = filtered.filter((m) => (m.session.endTime || m.session.startTime) >= cutoff);
  }
  if (filtered.length === 0) {
    console.log(`No sessions found matching "${term}"`);
    return;
  }
  console.log(`
Found ${filtered.length} session${filtered.length !== 1 ? "s" : ""} matching "${term}":
`);
  for (const { session, matchLine, role } of filtered) {
    const date = formatDate(session.startTime);
    const id = session.id;
    const tag = sourceTag(session.source);
    const preview = snippetAround(matchLine, term, MAX_SEARCH_PREVIEW);
    console.log(`  ${date}  ${id}  ${tag} ${session.projectDir}`);
    console.log(`    [${role}] "${preview}"`);
    console.log();
  }
}
function cmdShow(sessionId, short) {
  const session = findSession(sessionId);
  const out = [];
  out.push(`
Session: ${session.id}`);
  out.push(`Source:  ${session.source}`);
  out.push(`Project: ${session.projectDir}`);
  out.push(`Started: ${formatDate(session.startTime)}`);
  if (session.title)
    out.push(`Title:   ${session.title}`);
  out.push(`CWD:     ${session.cwd}`);
  out.push(`${"\u2500".repeat(HEADER_WIDTH)}
`);
  if (session.source === "claude") {
    showClaudeSession(session, short, out);
  } else {
    showOpencodeSession(session, short, out);
  }
  const content = out.join(`
`) + `
`;
  outputViaPager(content);
}
function showClaudeSession(session, short, out) {
  const records = readJsonlRecords(session.filePath);
  if (records.length === 0) {
    console.error(`Could not read session file: ${session.filePath}`);
    process.exit(1);
  }
  for (const record of records) {
    if (!record.message || record.isMeta)
      continue;
    const time = record.timestamp ? formatDate(record.timestamp) : "";
    if (record.type === "user" && record.message.role === "user") {
      const text = cleanMessageContent(record.message.content);
      if (isMetaOrCommand(text))
        continue;
      if (short) {
        out.push(`[${time}] User:`);
        out.push(`  ${truncate(text.replace(/\n/g, " ").trim(), MAX_SHORT_MESSAGE)}`);
      } else {
        out.push(formatMessageHeader("User", time));
        out.push(text.trim());
      }
      out.push("");
      continue;
    }
    if (record.type === "assistant" && record.message.role === "assistant") {
      if (short) {
        const text = cleanMessageContent(record.message.content);
        if (!text.trim())
          continue;
        out.push(`[${time}] Assistant:`);
        out.push(`  ${truncate(text.replace(/\n/g, " ").trim(), MAX_SHORT_MESSAGE)}`);
        out.push("");
        continue;
      }
      const msgContent = record.message.content;
      const parts = typeof msgContent === "string" ? [msgContent] : Array.isArray(msgContent) ? msgContent.flatMap((block) => {
        if (block.type === "text" && block.text)
          return [block.text];
        if (block.type === "tool_use")
          return [formatToolUse(block)];
        return [];
      }) : [];
      const combined = parts.join(`
`).trim();
      if (!combined)
        continue;
      out.push(formatMessageHeader("Assistant", time));
      out.push(combined);
      out.push("");
    }
  }
}
function showOpencodeSession(session, short, out) {
  let db;
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
    `).all({ $sessionId: session.id });
    for (const msg of messages) {
      const msgData = JSON.parse(msg.data);
      const role = msgData.role === "user" ? "User" : "Assistant";
      const time = formatDate(new Date(msg.time_created).toISOString());
      const parts = db.query(`
        SELECT data FROM part
        WHERE message_id = $msgId
        ORDER BY time_created ASC
      `).all({ $msgId: msg.id });
      const textParts = parts.flatMap((p) => {
        try {
          const pd = JSON.parse(p.data);
          if (pd.type === "text" && pd.text)
            return [pd.text];
        } catch {}
        return [];
      });
      if (textParts.length === 0)
        continue;
      if (short) {
        const text = textParts.join(`
`).replace(/\n/g, " ").trim();
        out.push(`[${time}] ${role}:`);
        out.push(`  ${truncate(text, MAX_SHORT_MESSAGE)}`);
        out.push("");
      } else {
        const text = textParts.join(`
`).trim();
        out.push(formatMessageHeader(role, time));
        out.push(text);
        out.push("");
      }
    }
  } finally {
    db.close();
  }
}
function cmdResume(sessionId) {
  const session = findSession(sessionId);
  const cwd = session.cwd || untildify(session.projectDir);
  if (!existsSync(cwd)) {
    console.error(`Working directory no longer exists: ${cwd}`);
    process.exit(1);
  }
  const cmd = session.source === "claude" ? `claude --dangerously-skip-permissions --resume ${session.id}` : `opencode --session ${session.id}`;
  console.log(`Resuming ${session.source} session ${shortId(session.id)} in ${session.projectDir}...`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
  } catch {}
}
function formatTimestamp() {
  const d = new Date;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}-${min}-${ss}`;
}
function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function getBackupArchives(backupDir) {
  if (!existsSync(backupDir))
    return [];
  return readdirSync(backupDir).filter((f) => f.startsWith("ai-sessions-backup-") && f.endsWith(".tar.gz")).sort();
}
function cmdBackup(args) {
  let dest = DEFAULT_BACKUP_DIR;
  let keep = 10;
  for (let i = 0;i < args.length; i++) {
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
  mkdirSync(dest, { recursive: true });
  const claudeDir = join(HOME, ".claude", "projects");
  const sources = [];
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
  const timestamp = formatTimestamp();
  const archiveName = `ai-sessions-backup-${timestamp}.tar.gz`;
  const archivePath = join(dest, archiveName);
  const tarPaths = sources.map((s) => s.path.slice(HOME.length + 1));
  try {
    const result = spawnSync("tar", ["-czf", archivePath, "-C", HOME, ...tarPaths], { stdio: "pipe" });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || "tar command failed");
    }
  } catch (e) {
    console.error(`Error creating archive: ${e.message}`);
    process.exit(1);
  }
  let fileCount = 0;
  try {
    const result = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf-8" });
    if (result.status === 0 && result.stdout) {
      fileCount = result.stdout.trim().split(`
`).filter((l) => l && !l.endsWith("/")).length;
    }
  } catch {}
  const archiveSize = statSync(archivePath).size;
  console.log(`
Backup complete:`);
  console.log(`  Archive: ${tildify(archivePath)}`);
  console.log(`  Size:    ${formatBytes(archiveSize)}`);
  console.log(`  Files:   ${fileCount}`);
  console.log(`  Sources:`);
  for (const s of sources) {
    console.log(`    - ${s.label}`);
  }
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
function cmdRestore(args) {
  const force = args.includes("--force");
  let dest = DEFAULT_BACKUP_DIR;
  const flagValues = new Set;
  for (let i = 0;i < args.length; i++) {
    if (args[i] === "--dest" && args[i + 1]) {
      dest = untildify(args[i + 1]);
      flagValues.add(i + 1);
      i++;
    }
  }
  const archiveArg = args.find((a, idx) => !a.startsWith("--") && !flagValues.has(idx));
  if (!archiveArg) {
    const archives = getBackupArchives(dest);
    if (archives.length === 0) {
      console.log(`No backups found in ${tildify(dest)}`);
      return;
    }
    console.log(`
Available backups in ${tildify(dest)}:
`);
    for (const name of archives) {
      const size = statSync(join(dest, name)).size;
      console.log(`  ${name}  (${formatBytes(size)})`);
    }
    console.log(`
To restore: ${BIN_NAME} restore <archive> --force`);
    console.log();
    return;
  }
  let archivePath;
  if (existsSync(archiveArg)) {
    archivePath = archiveArg;
  } else if (existsSync(join(dest, archiveArg))) {
    archivePath = join(dest, archiveArg);
  } else {
    console.error(`Archive not found: ${archiveArg}`);
    console.error(`Looked in: ${tildify(dest)}`);
    process.exit(1);
  }
  let listing;
  try {
    const result = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf-8" });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || "tar command failed");
    }
    listing = result.stdout || "";
  } catch (e) {
    console.error(`Error reading archive: ${e.message}`);
    process.exit(1);
  }
  const files = listing.trim().split(`
`).filter((l) => l && !l.endsWith("/"));
  console.log(`
Archive: ${tildify(archivePath)}`);
  console.log(`Files to restore (${files.length}):
`);
  let existingCount = 0;
  for (const f of files) {
    const fullPath = join(HOME, f);
    const exists = existsSync(fullPath);
    if (exists)
      existingCount++;
    const marker = exists ? " [EXISTS - will overwrite]" : "";
    console.log(`  ~/${f}${marker}`);
  }
  console.log();
  if (existingCount > 0) {
    console.log(`WARNING: ${existingCount} existing file${existingCount !== 1 ? "s" : ""} will be overwritten.`);
  }
  if (!force) {
    console.log(`
Re-run with --force to proceed:`);
    console.log(`  ${BIN_NAME} restore ${basename(archivePath)} --force`);
    console.log();
    return;
  }
  try {
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", HOME], { stdio: "pipe" });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || "tar command failed");
    }
  } catch (e) {
    console.error(`Error extracting archive: ${e.message}`);
    process.exit(1);
  }
  console.log(`Restored ${files.length} file${files.length !== 1 ? "s" : ""} to ~/`);
  console.log();
}
var BIN_NAME = "ai-sessions";
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "list") {
    const listArgs = args.slice(1);
    let filter;
    const listOpts = {};
    for (let i = 0;i < listArgs.length; i++) {
      if (listArgs[i] === "--cwd") {
        listOpts.cwd = true;
      } else if (listArgs[i] === "--days" && listArgs[i + 1]) {
        listOpts.days = parseInt(listArgs[++i], 10);
        if (isNaN(listOpts.days) || listOpts.days < 1) {
          console.error("Error: --days must be a positive integer.");
          process.exit(1);
        }
      } else if (listArgs[i] === "--limit" && listArgs[i + 1]) {
        listOpts.limit = parseInt(listArgs[++i], 10);
        if (isNaN(listOpts.limit) || listOpts.limit < 1) {
          console.error("Error: --limit must be a positive integer.");
          process.exit(1);
        }
      } else if (!listArgs[i].startsWith("--")) {
        filter = listArgs[i];
      }
    }
    cmdList(filter, listOpts);
  } else if (command === "search") {
    const searchArgs = args.slice(1);
    const termParts = [];
    const searchOpts = {};
    for (let i = 0;i < searchArgs.length; i++) {
      if (searchArgs[i] === "--cwd") {
        searchOpts.cwd = true;
      } else if (searchArgs[i] === "--days" && searchArgs[i + 1]) {
        searchOpts.days = parseInt(searchArgs[++i], 10);
        if (isNaN(searchOpts.days) || searchOpts.days < 1) {
          console.error("Error: --days must be a positive integer.");
          process.exit(1);
        }
      } else {
        termParts.push(searchArgs[i]);
      }
    }
    if (termParts.length === 0) {
      console.error(`Usage: ${BIN_NAME} search <term> [--cwd] [--days <n>]`);
      process.exit(1);
    }
    cmdSearch(termParts.join(" "), searchOpts);
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
    --cwd               Only show sessions for the current directory
    --days <n>          Only show sessions active in the last n days
    --limit <n>         Max sessions to show per directory
  search <term>       Full-text search across all session messages
    --cwd               Only search sessions for the current directory
    --days <n>          Only search sessions active in the last n days
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
