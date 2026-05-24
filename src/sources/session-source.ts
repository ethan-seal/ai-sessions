import type { ResumeTarget } from "../domain/resume";
import type { ParsedSearchTerm, SearchResult } from "../domain/search";
import type { SessionSummary } from "../domain/session";
import type { Source } from "../domain/source";
import type { Transcript } from "../domain/transcript";

export interface SessionSource {
  readonly source: Source;

  discoverSessions(): Promise<readonly SessionSummary[]>;
  search(term: ParsedSearchTerm): Promise<readonly SearchResult[]>;
  loadTranscript(sessionId: string): Promise<Transcript>;
  getResumeTarget(sessionId: string): Promise<ResumeTarget | null>;
}
