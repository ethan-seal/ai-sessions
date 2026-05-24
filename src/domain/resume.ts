import type { Source } from "./source";

export interface ResumeTarget {
  readonly source: Source;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly unavailableReason?: string;
}
