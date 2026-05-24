import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResumeTarget } from "../../domain/resume";
import type { ParsedSearchTerm, SearchResult } from "../../domain/search";
import { matchesTerm } from "../../domain/search";
import type { SessionSummary } from "../../domain/session";
import type { Transcript, TranscriptEntry } from "../../domain/transcript";
import { isDirectory, safeReaddir } from "../../shared/fs";
import { readJsonlObjects } from "../../shared/jsonl";
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
  async loadTranscript(sessionId) {
    return loadCodexTranscript(sessionId);
  },
  async getResumeTarget(sessionId) {
    return getCodexResumeTarget(sessionId);
  },
};

export function discoverCodexSessions(): SessionSummary[] {
  const dbSessions = getCodexSessionsFromDb();
  if (dbSessions.length > 0) return dbSessions;

  return getCodexRolloutPaths()
    .map(parseCodexSession)
    .filter((session): session is SessionSummary => session !== null);
}

export function searchCodexSessions(term: ParsedSearchTerm): SearchResult[] {
  const sessions = new Map(
    discoverCodexSessions().map((session) => [session.backingRef, session]),
  );
  const results: SearchResult[] = [];

  for (const filePath of getCodexRolloutPaths()) {
    const records = readCodexRecords(filePath);
    const session = sessions.get(filePath) || parseCodexSession(filePath);
    if (!session) continue;

    for (const record of records) {
      const entry = codexSearchEntry(record);
      if (!entry || !matchesTerm(entry.text, term)) continue;

      const matchedText = entry.text.replace(/\n/g, " ").trim();
      results.push({
        session,
        matchRole: entry.role === "tool" ? "tool" : entry.role,
        preview: matchedText,
        matchedText,
      });
      break;
    }
  }

  return results;
}

export function loadCodexTranscript(sessionId: string): Transcript {
  const session = discoverCodexSessions().find(
    (candidate) =>
      candidate.id === sessionId || candidate.id.startsWith(sessionId),
  );
  if (!session) throw new Error(`Codex session not found: ${sessionId}`);

  const records = readCodexRecords(session.backingRef);
  return {
    session,
    entries: codexDisplayEntries(records).map(toTranscriptEntry),
  };
}

export function getCodexResumeTarget(sessionId: string): ResumeTarget {
  const session = discoverCodexSessions().find(
    (candidate) =>
      candidate.id === sessionId || candidate.id.startsWith(sessionId),
  );

  return {
    source: "codex",
    executable: "codex",
    args: ["resume", sessionId],
    cwd: session?.cwd || session?.projectDir || "",
  };
}

function readCodexRecords(filePath: string): CodexRecord[] {
  return readJsonlObjects(filePath, (value) => {
    const raw = asObject(value);
    if (!raw || typeof raw.type !== "string") return null;
    return {
      type: raw.type,
      timestamp: stringValue(raw.timestamp) || undefined,
      payload: asObject(raw.payload) || undefined,
    };
  });
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
      firstMessage: (row.first_user_message || "").replace(/\n/g, " ").trim(),
      startedAt: codexIsoFromTime(row.created_at_ms, row.created_at),
      lastActiveAt: codexIsoFromTime(row.updated_at_ms, row.updated_at),
      backingRef: row.rollout_path,
    }));
  } finally {
    db.close();
  }
}

export function getCodexRolloutPaths(): string[] {
  if (!existsSync(CODEX_SESSIONS_DIR)) return [];

  const walk = (dirPath: string): string[] =>
    safeReaddir(dirPath).flatMap((name) => {
      const path = join(dirPath, name);
      if (isDirectory(path)) return walk(path);
      return name.startsWith("rollout-") && name.endsWith(".jsonl")
        ? [path]
        : [];
    });

  return walk(CODEX_SESSIONS_DIR);
}

function parseCodexSession(filePath: string): SessionSummary | null {
  const records = readCodexRecords(filePath);
  if (records.length === 0) return null;

  let sessionId = "";
  let cwd = "";
  let startTime = "";
  let endTime = "";

  for (const record of records) {
    if (record.timestamp) {
      if (!startTime || record.timestamp < startTime)
        startTime = record.timestamp;
      if (!endTime || record.timestamp > endTime) endTime = record.timestamp;
    }

    if (record.type === "session_meta" && record.payload) {
      if (!sessionId) sessionId = stringValue(record.payload.id);
      if (!cwd) cwd = stringValue(record.payload.cwd);
      const created = stringValue(record.payload.timestamp);
      if (created && (!startTime || created < startTime)) startTime = created;
    }
  }

  const firstMessage = codexFirstUserMessage(records);
  if (!sessionId || !firstMessage) return null;

  return {
    id: sessionId,
    source: "codex",
    projectDir: cwd ? tildify(cwd) : tildify(join(filePath, "..")),
    cwd,
    title: "",
    firstMessage,
    startedAt: startTime,
    lastActiveAt: endTime,
    backingRef: filePath,
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
      return entry.text.replace(/\n/g, " ").trim();
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
