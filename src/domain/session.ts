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
}

export interface ProjectGroup {
  readonly projectDir: string;
  readonly sessions: readonly SessionSummary[];
  readonly lastActiveAt: string;
}
