import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { ResumeTarget } from "../../domain/resume";
import type {
  ParsedSearchTerm,
  SearchMatchRole,
  SearchResult,
} from "../../domain/search";
import { matchesTerm } from "../../domain/search";
import type { SessionSummary } from "../../domain/session";
import type { Transcript, TranscriptEntry } from "../../domain/transcript";
import { isDirectory, safeReaddir } from "../../shared/fs";
import { readJsonlObjects } from "../../shared/jsonl";
import { HOME, tildify } from "../../shared/paths";
import type { SessionSource } from "../session-source";

const CLAUDE_DIR = join(HOME, ".claude", "projects");

export const claudeSource: SessionSource = {
  source: "claude",
  async discoverSessions() {
    return discoverClaudeSessions();
  },
  async search(term) {
    return searchClaudeSessions(term);
  },
  async loadTranscript(sessionId) {
    return loadClaudeTranscript(sessionId);
  },
  async getResumeTarget(sessionId) {
    return getClaudeResumeTarget(sessionId);
  },
};

interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  content: string | TextBlock[];
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface JsonlRecord {
  type: "user" | "assistant";
  isMeta?: boolean;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
  };
}

export function getClaudeJsonlPaths(): string[] {
  if (!existsSync(CLAUDE_DIR)) return [];

  return safeReaddir(CLAUDE_DIR)
    .map((dir) => join(CLAUDE_DIR, dir))
    .filter(isDirectory)
    .flatMap((dirPath) =>
      safeReaddir(dirPath)
        .filter((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))
        .map((file) => join(dirPath, file)),
    );
}

export function discoverClaudeSessions(): SessionSummary[] {
  return getClaudeJsonlPaths()
    .map(parseClaudeSession)
    .filter((session): session is SessionSummary => session !== null);
}

export function searchClaudeSessions(term: ParsedSearchTerm): SearchResult[] {
  const results: SearchResult[] = [];

  for (const filePath of getClaudeJsonlPaths()) {
    const records = readClaudeRecords(filePath);
    const session = parseClaudeRecords(filePath, records);
    if (!session) continue;

    for (const record of records) {
      const matchRole = matchRoleInRecord(record, term);
      if (!matchRole) continue;

      const extracted = extractSearchableText(record);
      const matchedText = extracted
        ? extracted.text.replace(/\n/g, " ").trim()
        : "";
      results.push({
        session,
        matchRole,
        preview: matchedText,
        matchedText,
      });
      break;
    }
  }

  return results;
}

export function loadClaudeTranscript(sessionId: string): Transcript {
  for (const filePath of getClaudeJsonlPaths()) {
    const records = readClaudeRecords(filePath);
    const session = parseClaudeRecords(filePath, records);
    if (
      !session ||
      (session.id !== sessionId && !session.id.startsWith(sessionId))
    )
      continue;

    return {
      session,
      entries: records.flatMap(transcriptEntriesForRecord),
    };
  }

  throw new Error(`Claude session not found: ${sessionId}`);
}

export function getClaudeResumeTarget(sessionId: string): ResumeTarget {
  const session = discoverClaudeSessions().find(
    (candidate) =>
      candidate.id === sessionId || candidate.id.startsWith(sessionId),
  );

  return {
    source: "claude",
    executable: "claude",
    args: ["--dangerously-skip-permissions", "--resume", sessionId],
    cwd: session?.cwd || session?.projectDir || "",
  };
}

function parseClaudeSession(filePath: string): SessionSummary | null {
  return parseClaudeRecords(filePath, readClaudeRecords(filePath));
}

function transcriptEntriesForRecord(record: JsonlRecord): TranscriptEntry[] {
  if (record.isMeta || !record.timestamp) return [];

  const content = record.message?.content;
  if (!content) return [];

  if (typeof content === "string") {
    if (record.type === "user" && isMetaOrCommand(content)) return [];
    return [{ timestamp: record.timestamp, role: record.type, text: content }];
  }

  return content.flatMap((block): TranscriptEntry[] => {
    if (block.type === "text") {
      if (record.type === "user" && isMetaOrCommand(block.text)) return [];
      return [
        {
          timestamp: record.timestamp ?? "",
          role: record.type,
          text: block.text,
        },
      ];
    }
    if (block.type === "tool_use") {
      return [
        {
          timestamp: record.timestamp ?? "",
          role: "tool_call",
          text: stringifyToolInput(block.input),
          toolName: block.name,
        },
      ];
    }
    if (block.type === "tool_result") {
      return [
        {
          timestamp: record.timestamp ?? "",
          role: "tool_result",
          text: toolResultText(block.content),
        },
      ];
    }
    return [];
  });
}

function parseClaudeRecords(
  filePath: string,
  records: readonly JsonlRecord[],
): SessionSummary | null {
  if (records.length === 0) return null;

  let sessionId = "";
  let cwd = "";
  let startTime = "";
  let endTime = "";
  let firstMessage = "";

  for (const record of records) {
    if (record.timestamp) {
      if (!startTime || record.timestamp < startTime)
        startTime = record.timestamp;
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
    cwd,
    title: "",
    firstMessage: firstMessage.replace(/\n/g, " ").trim(),
    startedAt: startTime,
    lastActiveAt: endTime,
    backingRef: filePath,
  };
}

function readClaudeRecords(filePath: string): JsonlRecord[] {
  return readJsonlObjects(filePath, (value) => value as JsonlRecord);
}

function stringifyToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "";
  }
}

function toolResultText(content: string | TextBlock[]): string {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n");
}

function cleanMessageContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function extractSearchableText(
  record: JsonlRecord,
): { text: string; role: SearchMatchRole } | null {
  if (record.isMeta) return null;

  const msgContent = record.message?.content;
  if (!msgContent) return null;

  const role =
    record.type === "user"
      ? "user"
      : record.type === "assistant"
        ? "assistant"
        : null;
  if (!role) return null;

  const parts: string[] = [];

  if (typeof msgContent === "string") {
    parts.push(msgContent);
  } else {
    for (const block of msgContent) {
      if (block.type === "text" && block.text) {
        parts.push(block.text);
      } else if (block.type === "tool_use" && block.input) {
        try {
          parts.push(JSON.stringify(block.input));
        } catch {}
        if (block.name) parts.push(block.name);
      } else if (block.type === "tool_result") {
        if (typeof block.content === "string") {
          parts.push(block.content);
        } else {
          parts.push(...block.content.map((sub) => sub.text).filter(Boolean));
        }
      }
    }
  }

  const text = parts.join("\n");
  return text.trim() ? { text, role } : null;
}

function matchRoleInRecord(
  record: JsonlRecord,
  term: ParsedSearchTerm,
): SearchMatchRole | null {
  if (record.isMeta) return null;

  const msgContent = record.message?.content;
  if (!msgContent) return null;

  const baseRole =
    record.type === "user"
      ? "user"
      : record.type === "assistant"
        ? "assistant"
        : null;
  if (!baseRole) return null;

  if (typeof msgContent === "string") {
    return matchesTerm(msgContent, term) ? baseRole : null;
  }

  if (
    msgContent.some(
      (block) =>
        block.type === "text" && block.text && matchesTerm(block.text, term),
    )
  ) {
    return baseRole;
  }

  for (const block of msgContent) {
    if (block.type === "tool_use") {
      if (block.name && matchesTerm(block.name, term)) return "tool";
      try {
        if (matchesTerm(JSON.stringify(block.input), term)) return "tool";
      } catch {}
    }
    if (block.type === "tool_result") {
      if (typeof block.content === "string" && matchesTerm(block.content, term))
        return "tool";
      if (
        Array.isArray(block.content) &&
        block.content.some((sub) => sub.text && matchesTerm(sub.text, term))
      ) {
        return "tool";
      }
    }
  }

  return null;
}

function isMetaOrCommand(text: string): boolean {
  return (
    text.startsWith("<command-name>") ||
    text.startsWith("<command-message>") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<turn_aborted>") ||
    text.startsWith("<local-command-stdout>") ||
    text.startsWith("Caveat: The messages below") ||
    text.trim() === ""
  );
}

function dirNameToPath(dirName: string): string {
  const parts = dirName.replace(/^-/, "").split("-");
  let path = "/";
  let i = 0;

  while (i < parts.length) {
    const isDotfile = parts[i] === "";
    if (isDotfile) {
      i++;
      if (i >= parts.length) break;
    }

    const segment = findLongestMatchingSegment(parts.slice(i), path, isDotfile);
    path = join(path, segment.name);
    i += segment.consumed;
  }

  return tildify(path);
}

function findLongestMatchingSegment(
  parts: readonly string[],
  basePath: string,
  isDotfile: boolean,
): { name: string; consumed: number } {
  const prefix = isDotfile ? "." : "";

  for (let len = parts.length; len > 0; len--) {
    const name = prefix + parts.slice(0, len).join("-");
    if (existsSync(join(basePath, name))) {
      return { name, consumed: len };
    }
  }

  return { name: prefix + (parts[0] ?? ""), consumed: 1 };
}
