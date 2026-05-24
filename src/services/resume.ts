import type { ResumeTarget } from "../domain/resume";
import type { SessionSummary } from "../domain/session";
import type { SessionSource } from "../sources/session-source";

export async function getResumeTarget(
  sources: readonly SessionSource[],
  session: SessionSummary,
): Promise<ResumeTarget> {
  const source = sources.find(
    (candidate) => candidate.source === session.source,
  );
  if (!source) throw new Error(`No source registered for ${session.source}`);

  const target = await source.getResumeTarget(session.id);
  if (!target) {
    return {
      source: session.source,
      executable: "",
      args: [],
      cwd: session.cwd || session.projectDir,
      unavailableReason: `Resume is unavailable for ${session.source}`,
    };
  }

  return {
    ...target,
    cwd: target.cwd || session.cwd || session.projectDir,
  };
}
