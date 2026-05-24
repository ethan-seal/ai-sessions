import type { SessionSummary } from "../domain/session";
import type { SessionSource } from "../sources/session-source";

export async function discoverSessions(
  sources: readonly SessionSource[],
): Promise<SessionSummary[]> {
  const settled = await Promise.allSettled(
    sources.map((source) => source.discoverSessions()),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? [...result.value] : [],
  );
}

export function findSessionById(
  sessions: readonly SessionSummary[],
  sessionId: string,
): SessionSummary | null {
  return (
    sessions.find(
      (session) => session.id === sessionId || session.id.startsWith(sessionId),
    ) ?? null
  );
}
