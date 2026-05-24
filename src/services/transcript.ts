import type { SessionSummary } from "../domain/session";
import type { Transcript } from "../domain/transcript";
import type { SessionSource } from "../sources/session-source";

export async function loadTranscript(
  sources: readonly SessionSource[],
  session: SessionSummary,
): Promise<Transcript> {
  const source = sources.find(
    (candidate) => candidate.source === session.source,
  );
  if (!source) throw new Error(`No source registered for ${session.source}`);
  return source.loadTranscript(session.id);
}
