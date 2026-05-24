import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResumeTarget } from "../../domain/resume";
import type { ParsedSearchTerm, SearchResult } from "../../domain/search";
import { matchesTerm } from "../../domain/search";
import type { SessionSummary } from "../../domain/session";
import type { Transcript, TranscriptEntry } from "../../domain/transcript";
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

interface OpencodeSearchRow {
  id: string;
  directory: string;
  title: string | null;
  time_created: number;
  time_updated: number;
  match_role: string;
  match_text: string;
}

interface OpencodeMessageRow {
  id: string;
  data: string;
  time_created: number;
}

interface OpencodePartRow {
  data: string;
}

export const opencodeSource: SessionSource = {
  source: "opencode",
  async discoverSessions() {
    return discoverOpencodeSessions();
  },
  async search(term) {
    return searchOpencodeSessions(term);
  },
  async loadTranscript(sessionId) {
    return loadOpencodeTranscript(sessionId);
  },
  async getResumeTarget(sessionId) {
    return getOpencodeResumeTarget(sessionId);
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

      const matchedText = row.match_text.replace(/\n/g, " ").trim();
      return [
        {
          session: sessionFromSearchRow(row),
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

export function loadOpencodeTranscript(sessionId: string): Transcript {
  const db = openOpencodeDb();
  if (!db) throw new Error("Could not open OpenCode database");

  try {
    const session = discoverOpencodeSessions().find(
      (candidate) =>
        candidate.id === sessionId || candidate.id.startsWith(sessionId),
    );
    if (!session) throw new Error(`OpenCode session not found: ${sessionId}`);

    const messages = db
      .query(`
      SELECT m.id, m.data, m.time_created
      FROM message m
      WHERE m.session_id = $sessionId
      ORDER BY m.time_created ASC
    `)
      .all({ $sessionId: session.id }) as OpencodeMessageRow[];

    return {
      session,
      entries: messages.flatMap((message) =>
        transcriptEntriesForMessage(db, message),
      ),
    };
  } finally {
    db.close();
  }
}

export function getOpencodeResumeTarget(sessionId: string): ResumeTarget {
  const session = discoverOpencodeSessions().find(
    (candidate) =>
      candidate.id === sessionId || candidate.id.startsWith(sessionId),
  );

  return {
    source: "opencode",
    executable: "opencode",
    args: ["--session", sessionId],
    cwd: session?.cwd || session?.projectDir || "",
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
    firstMessage: (row.first_message || "").replace(/\n/g, " ").trim(),
    startedAt: new Date(row.time_created).toISOString(),
    lastActiveAt: new Date(row.time_updated).toISOString(),
    backingRef: "",
  };
}

function sessionFromSearchRow(row: OpencodeSearchRow): SessionSummary {
  return {
    id: row.id,
    source: "opencode",
    projectDir: tildify(row.directory),
    cwd: row.directory,
    title: row.title || "",
    firstMessage: row.match_text.replace(/\n/g, " ").trim(),
    startedAt: new Date(row.time_created).toISOString(),
    lastActiveAt: new Date(row.time_updated).toISOString(),
    backingRef: "",
  };
}

function transcriptEntriesForMessage(
  db: Database,
  message: OpencodeMessageRow,
): TranscriptEntry[] {
  const role = opencodeMessageRole(message.data);
  if (!role) return [];

  const parts = db
    .query(`
    SELECT data FROM part
    WHERE message_id = $messageId
    ORDER BY time_created ASC
  `)
    .all({ $messageId: message.id }) as OpencodePartRow[];

  const text = parts.flatMap(textFromPart).join("\n").trim();
  if (!text) return [];

  return [
    {
      timestamp: new Date(message.time_created).toISOString(),
      role,
      text,
    },
  ];
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
