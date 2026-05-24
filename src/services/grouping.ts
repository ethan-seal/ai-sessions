import type { ProjectGroup, SessionSummary } from "../domain/session";

export function groupByProject(
  sessions: readonly SessionSummary[],
): ProjectGroup[] {
  const groups = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const existing = groups.get(session.projectDir) ?? [];
    existing.push(session);
    groups.set(session.projectDir, existing);
  }

  return Array.from(groups.entries())
    .map(([projectDir, projectSessions]) => {
      projectSessions.sort((a, b) => sessionTime(b) - sessionTime(a));
      const first = projectSessions[0];
      return {
        projectDir,
        sessions: projectSessions,
        lastActiveAt: first?.lastActiveAt || first?.startedAt || "",
      };
    })
    .sort(
      (a, b) =>
        new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
    );
}

function sessionTime(session: SessionSummary): number {
  return new Date(session.lastActiveAt || session.startedAt).getTime();
}
