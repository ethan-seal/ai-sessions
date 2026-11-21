import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { from } from "functools";
import type { ResumeTarget } from "../../domain/resume";
import type {
  ParsedSearchTerm,
  SearchMatchRole,
  SearchResult,
} from "../../domain/search";
import {
  buildPrefilter,
  matchesTerm,
  type TextPrefilter,
} from "../../domain/search";
import type { SessionSummary } from "../../domain/session";
import type { Transcript, TranscriptEntry } from "../../domain/transcript";
import {
  FILE_READ_CONCURRENCY,
  isDirectory,
  safeReaddir,
} from "../../shared/fs";
import {
  bufferLines,
  parseJsonLine,
  readFileBytes,
  readJsonlObjects,
  readJsonlTail,
  streamJsonlObjects,
} from "../../shared/jsonl";
import { isMetaOrCommand, singleLine } from "../../shared/messages";
import { HOME, tildify } from "../../shared/paths";
import type { SessionSource } from "../session-source";

const CLAUDE_DIR = join(HOME, ".claude", "projects");
const SKILL_EVAL_COMMAND = /-skill-[0-9a-f]{8}$/;
/** Bytes read from the end of a session file for its last activity, doubled while too few. */
const CLOSING_WINDOW_BYTES = 64 * 1024;

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
  const mayMatch = buildPrefilter(term);
  return from(await getClaudeJsonlPaths())
    .mapConcurrent((filePath) => searchClaudeFile(filePath, term, mayMatch), {
      limit: FILE_READ_CONCURRENCY,
    })
    .filter((result): result is SearchResult => result !== null)
    .toArray();
}

/** The first matching record in a file, parsing only the files and lines that could match. */
async function searchClaudeFile(
  filePath: string,
  term: ParsedSearchTerm,
  mayMatch: TextPrefilter,
): Promise<SearchResult | null> {
  const bytes = await readFileBytes(filePath);
  // Latin1 keeps ASCII bytes as they are, so a whole file is checked without decoding UTF-8.
  if (!bytes || !mayMatch(bytes.toString("latin1"))) return null;

  const hit = await bufferLines(bytes)
    .filter(mayMatch)
    .map((line) => parseJsonLine(line, asClaudeRecord))
    .filter((record): record is JsonlRecord => record !== null)
    .map((record) => ({ record, matchRole: matchRoleInRecord(record, term) }))
    .find((candidate) => candidate.matchRole !== null);
  if (!hit?.matchRole) return null;

  // Only files with a match pay for the full parse that builds the summary.
  const session = await parseClaudeSession(filePath);
  if (!session) return null;

  const extracted = extractSearchableText(hit.record);
  const matchedText = extracted ? singleLine(extracted.text) : "";
  return {
    session,
    matchRole: hit.matchRole,
    preview: matchedText,
    matchedText,
  };
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

/**
 * The summary of a session file, read from its opening exchange and its last
 * lines rather than in full. Timestamps are close to append order, so the
 * earliest and latest of those records stand in for the file's.
 */
export async function parseClaudeSession(
  filePath: string,
): Promise<SessionSummary | null> {
  try {
    const { size } = await stat(filePath);
    if (size <= CLOSING_WINDOW_BYTES) {
      return parseClaudeRecords(filePath, await readClaudeRecords(filePath));
    }
    const [opening, closing] = await Promise.all([
      readOpeningRecords(filePath),
      readClosingRecords(filePath, size, CLOSING_WINDOW_BYTES),
    ]);
    return parseClaudeRecords(filePath, opening, closing);
  } catch {
    return null;
  }
}

/**
 * The records up to the first reply to a prompt, or every record if none is
 * answered. Everything a summary takes from a session but its last activity,
 * startup attachments such as the skill listing included, is written by then.
 */
async function readOpeningRecords(filePath: string): Promise<JsonlRecord[]> {
  const records: JsonlRecord[] = [];
  let prompted = false;
  for await (const record of streamJsonlObjects(filePath, asClaudeRecord)) {
    records.push(record);
    prompted ||= promptText(record) !== null;
    if (prompted && record.type === "assistant") break;
  }
  return records;
}

/** The records on a file's last lines, widened until one carries a timestamp or the window covers the file. */
async function readClosingRecords(
  filePath: string,
  size: number,
  window: number,
): Promise<JsonlRecord[]> {
  const records = await readJsonlTail(filePath, window, asClaudeRecord);
  if (window >= size || records.some((record) => record.timestamp)) {
    return records;
  }
  return readClosingRecords(filePath, size, window * 2);
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

/** A summary from a file's `opening` records, with `closing` records only widening its time span. */
function parseClaudeRecords(
  filePath: string,
  opening: readonly JsonlRecord[],
  closing: readonly JsonlRecord[] = [],
): SessionSummary | null {
  const timestamps = [...opening, ...closing]
    .flatMap((record) => (record.timestamp ? [record.timestamp] : []))
    .sort();
  const userRecords = opening.filter((record) => record.type === "user");

  const sessionId = userRecords.find((record) => record.sessionId)?.sessionId;
  const firstMessage = opening.map(promptText).find((text) => text !== null);
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
    skillEval: isSkillEval(opening, userRecords),
  };
}

/** The text of a prompt the user typed, or null for any other record. */
function promptText(record: JsonlRecord): string | null {
  if (record.type !== "user" || record.isMeta) return null;
  if (record.message?.role !== "user") return null;
  const text = cleanMessageContent(record.message.content);
  return isMetaOrCommand(text) ? null : text;
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
  return readJsonlObjects(filePath, asClaudeRecord);
}

function asClaudeRecord(value: unknown): JsonlRecord {
  return value as JsonlRecord;
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
