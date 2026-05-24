import type { SessionSummary } from "./session";

export type TranscriptRole =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "system"
  | "unknown";

export interface TranscriptEntry {
  readonly timestamp: string;
  readonly role: TranscriptRole;
  readonly text: string;
  readonly toolName?: string;
  readonly command?: string;
  readonly fileRefs?: readonly string[];
  readonly rawSourceRef?: string;
}

export interface Transcript {
  readonly session: SessionSummary;
  readonly entries: readonly TranscriptEntry[];
}
