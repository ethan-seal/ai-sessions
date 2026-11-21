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
