import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { from } from "functools";
import type { ResumeTarget } from "../../domain/resume";
import type {
  ParsedSearchTerm,
  SearchMatchRole,
  SearchResult,
} from "../../domain/search";
import { matchesTerm } from "../../domain/search";
import type { SessionSummary } from "../../domain/session";
import type { Transcript, TranscriptEntry } from "../../domain/transcript";
import {
  FILE_READ_CONCURRENCY,
  isDirectory,
  safeReaddir,
} from "../../shared/fs";
import { readJsonlObjects } from "../../shared/jsonl";
import { isMetaOrCommand, singleLine } from "../../shared/messages";
import { HOME, tildify } from "../../shared/paths";
import type { SessionSource } from "../session-source";

const CLAUDE_DIR = join(HOME, ".claude", "projects");
const SKILL_EVAL_COMMAND = /-skill-[0-9a-f]{8}$/;

export const claudeSource: SessionSource = {
  source: "claude",
  async discoverSessions() {
    return discoverClaudeSessions();
  },
  async search(term) {
    return searchClaudeSessions(term);
  },
  async loadTranscript(session) {
    return loadClaudeTranscript(session);
  },
  async getResumeTarget(session) {
    return getClaudeResumeTarget(session);
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
  type: "user" | "assistant" | "attachment";
  isMeta?: boolean;
  sessionId?: string;
  cwd?: string;
  entrypoint?: string;
  attachment?: { type?: string; names?: string[] };
  timestamp?: string;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
  };
}

export async function getClaudeJsonlPaths(): Promise<string[]> {
  return from(await safeReaddir(CLAUDE_DIR))
    .map((dir) => join(CLAUDE_DIR, dir))
    .filter(isDirectory)
    .flatMap(async (dirPath) =>
      (await safeReaddir(dirPath))
        .filter((file) => file.endsWith(".jsonl") && !file.startsWith("agent-"))
        .map((file) => join(dirPath, file)),
    )
    .toArray();
}

export async function discoverClaudeSessions(): Promise<SessionSummary[]> {
  return from(await getClaudeJsonlPaths())
    .mapConcurrent(parseClaudeSession, { limit: FILE_READ_CONCURRENCY })
    .filter((session): session is SessionSummary => session !== null)
    .toArray();
}

export async function searchClaudeSessions(
  term: ParsedSearchTerm,
): Promise<SearchResult[]> {
  return from(await getClaudeJsonlPaths())
    .mapConcurrent((filePath) => searchClaudeFile(filePath, term), {
      limit: FILE_READ_CONCURRENCY,
    })
    .filter((result): result is SearchResult => result !== null)
    .toArray();
}

async function searchClaudeFile(
  filePath: string,
  term: ParsedSearchTerm,
): Promise<SearchResult | null> {
  const records = await readClaudeRecords(filePath);
  const session = parseClaudeRecords(filePath, records);
  if (!session) return null;

  for (const record of records) {
    const matchRole = matchRoleInRecord(record, term);
    if (!matchRole) continue;

    const extracted = extractSearchableText(record);
    const matchedText = extracted ? singleLine(extracted.text) : "";
    return { session, matchRole, preview: matchedText, matchedText };
  }
  return null;
}

export async function loadClaudeTranscript(
  session: SessionSummary,
): Promise<Transcript> {
  const records = await readClaudeRecords(session.backingRef);
  return { session, entries: records.flatMap(transcriptEntriesForRecord) };
}

export function getClaudeResumeTarget(session: SessionSummary): ResumeTarget {
  return {
    source: "claude",
    executable: "claude",
    args: ["--dangerously-skip-permissions", "--resume", session.id],
    cwd: session.cwd,
  };
}

export async function parseClaudeSession(
  filePath: string,
): Promise<SessionSummary | null> {
  return parseClaudeRecords(filePath, await readClaudeRecords(filePath));
}

function transcriptEntriesForRecord(record: JsonlRecord): TranscriptEntry[] {
  const role = record.type;
  if (role !== "user" && role !== "assistant") return [];
  if (record.isMeta || !record.timestamp) return [];

  const content = record.message?.content;
  if (!content) return [];

  if (typeof content === "string") {
    if (role === "user" && isMetaOrCommand(content)) return [];
    return [{ timestamp: record.timestamp, role, text: content }];
  }

  return content.flatMap((block): TranscriptEntry[] => {
    if (block.type === "text") {
      if (role === "user" && isMetaOrCommand(block.text)) return [];
      return [
        {
          timestamp: record.timestamp ?? "",
          role,
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
  const timestamps = records
    .flatMap((record) => (record.timestamp ? [record.timestamp] : []))
    .sort();
  const userRecords = records.filter((record) => record.type === "user");

  const sessionId = userRecords.find((record) => record.sessionId)?.sessionId;
  const firstMessage = userRecords
    .flatMap((record) =>
      !record.isMeta && record.message?.role === "user"
        ? [cleanMessageContent(record.message.content)]
        : [],
    )
    .find((text) => !isMetaOrCommand(text));
  if (!sessionId || !firstMessage) return null;

  const cwd = userRecords.find((record) => record.cwd)?.cwd ?? "";
  const projectDir = cwd
    ? tildify(cwd)
    : dirNameToPath(basename(join(filePath, "..")));

  return {
    id: sessionId,
    source: "claude",
    projectDir,
    cwd,
    title: "",
    firstMessage: singleLine(firstMessage),
    startedAt: timestamps[0] ?? "",
    lastActiveAt: timestamps.at(-1) ?? "",
    backingRef: filePath,
    skillEval: isSkillEval(records, userRecords),
  };
}

/** Headless (`claude -p`) sessions that loaded a temporary skill-eval command. */
function isSkillEval(
  records: readonly JsonlRecord[],
  userRecords: readonly JsonlRecord[],
): boolean {
  const headless = userRecords.some(
    (record) => record.entrypoint === "sdk-cli",
  );
  const hasEvalCommand = records.some((record) =>
    record.attachment?.type === "skill_listing"
      ? record.attachment.names?.some((name) => SKILL_EVAL_COMMAND.test(name))
      : false,
  );
  return headless && hasEvalCommand;
}

function readClaudeRecords(filePath: string): Promise<JsonlRecord[]> {
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
