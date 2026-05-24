import type { SearchResult } from "../domain/search";
import { parseTerm } from "../domain/search";
import type { SessionSource } from "../sources/session-source";

export async function searchSessions(
  sources: readonly SessionSource[],
  term: string,
): Promise<SearchResult[]> {
  const parsed = parseTerm(term);
  const settled = await Promise.allSettled(
    sources.map((source) => source.search(parsed)),
  );
  return settled.flatMap((result) =>
    result.status === "fulfilled" ? [...result.value] : [],
  );
}
