import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResumeTarget } from "../../domain/resume";
import type { ParsedSearchTerm, SearchResult } from "../../domain/search";
import { matchesTerm } from "../../domain/search";
import type { SessionSummary } from "../../domain/session";
import type { Transcript, TranscriptEntry } from "../../domain/transcript";
import { singleLine } from "../../shared/messages";
import { HOME, tildify } from "../../shared/paths";
import type { SessionSource } from "../session-source";

const OPENCODE_DB = join(HOME, ".local", "share", "opencode", "opencode.db");

interface OpencodeSessionRow {
  id: string;
  directory: string;
  title: string | null;
  time_created: number;
  time_updated: number;
  first_message: string | null;
}

interface OpencodeSearchRow extends OpencodeSessionRow {
  match_role: string;
  match_text: string;
}

interface OpencodeMessageRow {
  id: string;
  data: string;
  time_created: number;
}

interface OpencodePartRow {
  message_id: string;
  data: string;
}

/** Text of the earliest user message in session `s`; shared by listing and search. */
const FIRST_MESSAGE_SQL = `(
  SELECT json_extract(p.data, '$.text')
  FROM message m
  JOIN part p ON p.message_id = m.id
  WHERE m.session_id = s.id
    AND json_extract(m.data, '$.role') = 'user'
    AND json_extract(p.data, '$.type') = 'text'
  ORDER BY m.time_created ASC, p.time_created ASC
  LIMIT 1
)`;

export const opencodeSource: SessionSource = {
  source: "opencode",
  async discoverSessions() {
    return discoverOpencodeSessions();
  },
  async search(term) {
    return searchOpencodeSessions(term);
  },
  async loadTranscript(session) {
    return loadOpencodeTranscript(session);
  },
  async getResumeTarget(session) {
    return getOpencodeResumeTarget(session);
  },
};

export function discoverOpencodeSessions(): SessionSummary[] {
  const db = openOpencodeDb();
  if (!db) return [];

  try {
    const rows = db
      .query(`
      SELECT
        s.id,
        s.directory,
        s.title,
        s.time_created,
        s.time_updated,
        ${FIRST_MESSAGE_SQL} as first_message
      FROM session s
      WHERE s.time_archived IS NULL
      ORDER BY s.time_updated DESC
    `)
      .all() as OpencodeSessionRow[];

    return rows.filter((row) => row.first_message).map(sessionFromRow);
  } finally {
    db.close();
  }
}

export function searchOpencodeSessions(term: ParsedSearchTerm): SearchResult[] {
  const db = openOpencodeDb();
  if (!db) return [];

  try {
    const rows = db
      .query(`
      SELECT
        s.id,
        s.directory,
        s.title,
        s.time_created,
        s.time_updated,
        ${FIRST_MESSAGE_SQL} as first_message,
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
    `)
      .all({ $pattern: `%${term.text}%` }) as OpencodeSearchRow[];

    return rows.flatMap((row) => {
      if (
        (term.wordStart || term.wordEnd) &&
        !matchesTerm(row.match_text, term)
      )
        return [];

      const matchedText = singleLine(row.match_text);
      return [
        {
          session: sessionFromRow(row),
          matchRole: row.match_role === "user" ? "user" : "assistant",
          preview: matchedText,
          matchedText,
        } satisfies SearchResult,
      ];
    });
  } finally {
    db.close();
  }
}

export function loadOpencodeTranscript(session: SessionSummary): Transcript {
  const db = openOpencodeDb();
  if (!db) throw new Error("Could not open OpenCode database");

  try {
    const messages = db
      .query(`
      SELECT id, data, time_created
      FROM message
      WHERE session_id = $sessionId
      ORDER BY time_created ASC
    `)
      .all({ $sessionId: session.id }) as OpencodeMessageRow[];

    const parts = db
      .query(`
      SELECT message_id, data
      FROM part
      WHERE session_id = $sessionId
      ORDER BY time_created ASC
    `)
      .all({ $sessionId: session.id }) as OpencodePartRow[];

    const partsByMessage = Map.groupBy(parts, (part) => part.message_id);

    return {
      session,
      entries: messages.flatMap((message) =>
        transcriptEntriesForMessage(
          message,
          partsByMessage.get(message.id) ?? [],
        ),
      ),
    };
  } finally {
    db.close();
  }
}

export function getOpencodeResumeTarget(session: SessionSummary): ResumeTarget {
  return {
    source: "opencode",
    executable: "opencode",
    args: ["--session", session.id],
    cwd: session.cwd,
  };
}

function openOpencodeDb(): Database | null {
  if (!existsSync(OPENCODE_DB)) return null;

  try {
    return new Database(OPENCODE_DB, { readonly: true });
  } catch {
    return null;
  }
}

function sessionFromRow(row: OpencodeSessionRow): SessionSummary {
  return {
    id: row.id,
    source: "opencode",
    projectDir: tildify(row.directory),
    cwd: row.directory,
    title: row.title || "",
    firstMessage: singleLine(row.first_message || ""),
    startedAt: new Date(row.time_created).toISOString(),
    lastActiveAt: new Date(row.time_updated).toISOString(),
    backingRef: "",
    skillEval: false,
  };
}

function transcriptEntriesForMessage(
  message: OpencodeMessageRow,
  parts: readonly OpencodePartRow[],
): TranscriptEntry[] {
  const role = opencodeMessageRole(message.data);
  if (!role) return [];

  const timestamp = new Date(message.time_created).toISOString();
  const text = parts.flatMap(textFromPart).join("\n").trim();
  const textEntries: TranscriptEntry[] = text
    ? [{ timestamp, role, text }]
    : [];
  const toolEntries = parts.flatMap((part) =>
    toolEntriesFromPart(part, timestamp),
  );
  return [...textEntries, ...toolEntries];
}

function opencodeMessageRole(data: string): "user" | "assistant" | null {
  try {
    const parsed = JSON.parse(data) as { role?: unknown };
    return parsed.role === "user"
      ? "user"
      : parsed.role === "assistant"
        ? "assistant"
        : null;
  } catch {
    return null;
  }
}

function textFromPart(part: OpencodePartRow): string[] {
  try {
    const parsed = JSON.parse(part.data) as { type?: unknown; text?: unknown };
    return parsed.type === "text" && typeof parsed.text === "string"
      ? [parsed.text]
      : [];
  } catch {
    return [];
  }
}

function toolEntriesFromPart(
  part: OpencodePartRow,
  timestamp: string,
): TranscriptEntry[] {
  try {
    const parsed = JSON.parse(part.data) as {
      type?: unknown;
      tool?: unknown;
      state?: { input?: unknown; output?: unknown };
    };
    if (parsed.type !== "tool") return [];

    const toolName =
      typeof parsed.tool === "string" ? parsed.tool : "unknown_tool";
    const output = parsed.state?.output;
    return [
      {
        timestamp,
        role: "tool_call",
        text: JSON.stringify(parsed.state?.input ?? {}, null, 2),
        toolName,
      },
      ...(typeof output === "string" && output
        ? [
            {
              timestamp,
              role: "tool_result",
              text: output,
            } satisfies TranscriptEntry,
          ]
        : []),
    ];
  } catch {
    return [];
  }
}
