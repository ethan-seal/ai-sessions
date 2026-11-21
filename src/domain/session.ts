import type { Source } from "./source";

export interface SessionSummary {
  readonly id: string;
  readonly source: Source;
  readonly projectDir: string;
  readonly cwd: string;
  readonly title: string;
  readonly firstMessage: string;
  readonly startedAt: string;
  readonly lastActiveAt: string;
  readonly backingRef: string;
  readonly skillEval: boolean;
}

export interface ProjectGroup {
  readonly projectDir: string;
  readonly sessions: readonly SessionSummary[];
  readonly lastActiveAt: string;
}

const MAX_LISTED_MATCHES = 5;

export class AmbiguousSessionIdError extends Error {
  constructor(
    readonly query: string,
    readonly matches: readonly SessionSummary[],
  ) {
    super(
      `Session id "${query}" is ambiguous; it matches ${matches.length} sessions, e.g. ${matches
        .slice(0, MAX_LISTED_MATCHES)
        .map((session) => session.id.slice(0, 12))
        .join(", ")}`,
    );
    this.name = "AmbiguousSessionIdError";
  }
}

/** Finds a session by full id or unique id prefix. An exact id wins; several prefix matches throw. */
export function findSessionById(
  sessions: readonly SessionSummary[],
  query: string,
): SessionSummary | null {
  const exact = sessions.find((session) => session.id === query);
  if (exact) return exact;

  const matches = sessions.filter((session) => session.id.startsWith(query));
  if (matches.length > 1) throw new AmbiguousSessionIdError(query, matches);
  return matches[0] ?? null;
}
