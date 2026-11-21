import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { from } from "functools";
import type { ResumeTarget } from "../../domain/resume";
import type { ParsedSearchTerm, SearchResult } from "../../domain/search";
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
} from "../../shared/jsonl";
import { isMetaOrCommand, singleLine } from "../../shared/messages";
import { HOME, tildify, untildify } from "../../shared/paths";
import type { SessionSource } from "../session-source";

const CODEX_HOME = process.env.CODEX_HOME
  ? untildify(process.env.CODEX_HOME)
  : join(HOME, ".codex");
const CODEX_SESSIONS_DIR = join(CODEX_HOME, "sessions");
const CODEX_STATE_DB = join(CODEX_HOME, "state_5.sqlite");

interface CodexThreadRow {
  id: string;
  rollout_path: string;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  created_at: number;
  updated_at: number;
  cwd: string;
  title: string | null;
  first_user_message: string | null;
}

interface CodexRecord {
  timestamp?: string;
  type: string;
  payload?: Record<string, unknown>;
}

interface CodexTranscriptEntry {
  role: "user" | "assistant" | "tool";
  text: string;
  time: string;
}

export const codexSource: SessionSource = {
  source: "codex",
  async discoverSessions() {
    return discoverCodexSessions();
  },
  async search(term) {
    return searchCodexSessions(term);
  },
  async loadTranscript(session) {
    return loadCodexTranscript(session);
  },
  async getResumeTarget(session) {
    return getCodexResumeTarget(session);
  },
};

export async function discoverCodexSessions(): Promise<SessionSummary[]> {
  const dbSessions = getCodexSessionsFromDb();
  if (dbSessions.length > 0) return dbSessions;

  return from(await getCodexRolloutPaths())
    .mapConcurrent(parseCodexSession, { limit: FILE_READ_CONCURRENCY })
    .filter((session): session is SessionSummary => session !== null)
    .toArray();
}

export async function searchCodexSessions(
  term: ParsedSearchTerm,
): Promise<SearchResult[]> {
  const sessions = new Map(
    (await discoverCodexSessions()).map((session) => [
      session.backingRef,
      session,
    ]),
  );

  const mayMatch = buildPrefilter(term);
  return from(await getCodexRolloutPaths())
    .mapConcurrent(
      async (filePath): Promise<SearchResult | null> => {
        const hit = await findCodexMatch(filePath, term, mayMatch);
        if (!hit) return null;

        const session =
          sessions.get(filePath) ?? (await parseCodexSession(filePath));
        if (!session) return null;

        const matchedText = singleLine(hit.text);
        return {
          session,
          matchRole: hit.role,
          preview: matchedText,
          matchedText,
        };
      },
      { limit: FILE_READ_CONCURRENCY },
    )
    .filter((result): result is SearchResult => result !== null)
    .toArray();
}

/** The first record of a rollout file that matches, parsing only files and lines that could. */
async function findCodexMatch(
  filePath: string,
  term: ParsedSearchTerm,
  mayMatch: TextPrefilter,
): Promise<CodexTranscriptEntry | undefined> {
  const bytes = await readFileBytes(filePath);
  // Latin1 keeps ASCII bytes as they are, so a whole file is checked without decoding UTF-8.
  if (!bytes || !mayMatch(bytes.toString("latin1"))) return undefined;

  return bufferLines(bytes)
    .filter(mayMatch)
    .map((line) => parseJsonLine(line, asCodexRecord))
    .filter((record): record is CodexRecord => record !== null)
    .map(codexSearchEntry)
    .find(
      (entry): entry is CodexTranscriptEntry =>
        entry !== null && matchesTerm(entry.text, term),
    );
}

export async function loadCodexTranscript(
  session: SessionSummary,
): Promise<Transcript> {
  const records = await readCodexRecords(session.backingRef);
  return {
    session,
    entries: codexDisplayEntries(records).map(toTranscriptEntry),
  };
}

export function getCodexResumeTarget(session: SessionSummary): ResumeTarget {
  return {
    source: "codex",
    executable: "codex",
    args: ["resume", session.id],
    cwd: session.cwd,
  };
}

function readCodexRecords(filePath: string): Promise<CodexRecord[]> {
  return readJsonlObjects(filePath, asCodexRecord);
}

function asCodexRecord(value: unknown): CodexRecord | null {
  const raw = asObject(value);
  if (!raw || typeof raw.type !== "string") return null;
  return {
    type: raw.type,
    timestamp: stringValue(raw.timestamp) || undefined,
    payload: asObject(raw.payload) || undefined,
  };
}

function getCodexSessionsFromDb(): SessionSummary[] {
  if (!existsSync(CODEX_STATE_DB)) return [];

  let db: Database;
  try {
    db = new Database(CODEX_STATE_DB, { readonly: true });
  } catch {
    return [];
  }

  try {
    const rows = db
      .query(`
      SELECT
        id,
        rollout_path,
        created_at_ms,
        updated_at_ms,
        created_at,
        updated_at,
        cwd,
        title,
        first_user_message
      FROM threads
      WHERE archived = 0
      ORDER BY updated_at_ms DESC, updated_at DESC
    `)
      .all() as CodexThreadRow[];

    return rows.map((row) => ({
      id: row.id,
      source: "codex",
      projectDir: tildify(row.cwd),
      cwd: row.cwd,
      title: row.title || "",
      firstMessage: singleLine(row.first_user_message || ""),
      startedAt: codexIsoFromTime(row.created_at_ms, row.created_at),
      lastActiveAt: codexIsoFromTime(row.updated_at_ms, row.updated_at),
      backingRef: row.rollout_path,
      skillEval: false,
    }));
  } finally {
    db.close();
  }
}

export async function getCodexRolloutPaths(): Promise<string[]> {
  const walk = async (dirPath: string): Promise<string[]> =>
    from(await safeReaddir(dirPath))
      .map((name) => join(dirPath, name))
      .flatMap(async (path) => {
        if (await isDirectory(path)) return walk(path);
        const name = basename(path);
        return name.startsWith("rollout-") && name.endsWith(".jsonl")
          ? [path]
          : [];
      })
      .toArray();

  return walk(CODEX_SESSIONS_DIR);
}

async function parseCodexSession(
  filePath: string,
): Promise<SessionSummary | null> {
  const records = await readCodexRecords(filePath);
  const meta = records
    .filter((record) => record.type === "session_meta" && record.payload)
    .map((record) => record.payload)
    .filter((payload) => payload !== undefined);

  const sessionId = meta.map((m) => stringValue(m.id)).find(Boolean);
  const firstMessage = codexFirstUserMessage(records);
  if (!sessionId || !firstMessage) return null;

  const cwd = meta.map((m) => stringValue(m.cwd)).find(Boolean) ?? "";
  const timestamps = [
    ...records.flatMap((record) =>
      record.timestamp ? [record.timestamp] : [],
    ),
    ...meta.map((m) => stringValue(m.timestamp)).filter(Boolean),
  ].sort();

  return {
    id: sessionId,
    source: "codex",
    projectDir: cwd ? tildify(cwd) : tildify(dirname(filePath)),
    cwd,
    title: "",
    firstMessage,
    startedAt: timestamps[0] ?? "",
    lastActiveAt: timestamps.at(-1) ?? "",
    backingRef: filePath,
    skillEval: false,
  };
}

function codexIsoFromTime(ms: number | null, seconds: number): string {
  const millis = ms ?? seconds * 1000;
  return millis ? new Date(millis).toISOString() : "";
}

function codexContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((item) => {
      const obj = asObject(item);
      const text = obj ? stringValue(obj.text) : "";
      return text ? [text] : [];
    })
    .join("\n");
}

function codexResponseItemEntry(
  record: CodexRecord,
): CodexTranscriptEntry | null {
  const payload = record.payload;
  if (!payload || record.type !== "response_item") return null;

  const payloadType = stringValue(payload.type);
  if (payloadType === "message") {
    const role = stringValue(payload.role);
    if (role !== "user" && role !== "assistant") return null;
    const text = codexContentText(payload.content).trim();
    if (!text) return null;
    if (role === "user" && isMetaOrCommand(text)) return null;
    return { role, text, time: record.timestamp || "" };
  }

  if (payloadType === "function_call") {
    const name = stringValue(payload.name) || "unknown_tool";
    const args = stringValue(payload.arguments);
    const text = args
      ? `[tool_call: ${name}]\n${args}`
      : `[tool_call: ${name}]`;
    return { role: "tool", text, time: record.timestamp || "" };
  }

  if (payloadType === "function_call_output") {
    const output = stringValue(payload.output).trim();
    if (!output) return null;
    return {
      role: "tool",
      text: `[tool_result]\n${output}`,
      time: record.timestamp || "",
    };
  }

  return null;
}

function codexEventMessageEntry(
  record: CodexRecord,
): CodexTranscriptEntry | null {
  const payload = record.payload;
  if (!payload || record.type !== "event_msg") return null;

  const payloadType = stringValue(payload.type);
  if (payloadType === "user_message") {
    const text = stringValue(payload.message).trim();
    return text ? { role: "user", text, time: record.timestamp || "" } : null;
  }
  if (payloadType === "agent_message") {
    const text = stringValue(payload.message).trim();
    return text
      ? { role: "assistant", text, time: record.timestamp || "" }
      : null;
  }

  return null;
}

function codexSearchEntry(record: CodexRecord): CodexTranscriptEntry | null {
  return codexResponseItemEntry(record) || codexEventMessageEntry(record);
}

function codexDisplayEntries(
  records: readonly CodexRecord[],
): CodexTranscriptEntry[] {
  const responseEntries = records
    .map(codexResponseItemEntry)
    .filter((entry): entry is CodexTranscriptEntry => entry !== null);

  if (responseEntries.some((entry) => entry.role !== "tool")) {
    return responseEntries;
  }

  return records
    .map(codexEventMessageEntry)
    .filter((entry): entry is CodexTranscriptEntry => entry !== null);
}

function codexFirstUserMessage(records: readonly CodexRecord[]): string {
  for (const record of records) {
    const entry = codexSearchEntry(record);
    if (entry?.role === "user" && !isMetaOrCommand(entry.text)) {
      return singleLine(entry.text);
    }
  }
  return "";
}

function toTranscriptEntry(entry: CodexTranscriptEntry): TranscriptEntry {
  if (entry.role === "tool" && entry.text.startsWith("[tool_call:")) {
    return { timestamp: entry.time, role: "tool_call", text: entry.text };
  }
  if (entry.role === "tool") {
    return { timestamp: entry.time, role: "tool_result", text: entry.text };
  }
  return { timestamp: entry.time, role: entry.role, text: entry.text };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
