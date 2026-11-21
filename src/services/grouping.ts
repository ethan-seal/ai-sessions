import type { ProjectGroup, SessionSummary } from "../domain/session";

export function groupByProject(
  sessions: readonly SessionSummary[],
): ProjectGroup[] {
  return Array.from(
    Map.groupBy(sessions, (session) => session.projectDir),
    ([projectDir, projectSessions]) => {
      const sorted = projectSessions.toSorted(
        (a, b) => sessionTime(b) - sessionTime(a),
      );
      return {
        projectDir,
        sessions: sorted,
        lastActiveAt: sessionActivity(sorted[0]),
      };
    },
  ).sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  );
}

function sessionActivity(session: SessionSummary | undefined): string {
  return session?.lastActiveAt || session?.startedAt || "";
}

function sessionTime(session: SessionSummary): number {
  return new Date(sessionActivity(session)).getTime();
}
