import type { SessionSummary } from "./session";

export type SearchMatchRole =
  | "user"
  | "assistant"
  | "tool"
  | "metadata"
  | "unknown";

export interface SearchResult {
  readonly session: SessionSummary;
  readonly matchRole: SearchMatchRole;
  readonly preview: string;
  readonly matchedText: string;
}

export interface ParsedSearchTerm {
  readonly raw: string;
  readonly text: string;
  readonly lower: string;
  readonly wordStart: boolean;
  readonly wordEnd: boolean;
}

const WORD_CHAR = /\w/;

export function parseTerm(term: string): ParsedSearchTerm {
  let t = term;
  const wordStart = t.startsWith("\\b");
  const wordEnd = t.endsWith("\\b");
  if (wordStart) t = t.slice(2);
  if (wordEnd) t = t.slice(0, -2);
  return { raw: term, text: t, lower: t.toLowerCase(), wordStart, wordEnd };
}

export function findTermIndex(haystack: string, pt: ParsedSearchTerm): number {
  const h = haystack.toLowerCase();
  let start = 0;
  while (true) {
    const idx = h.indexOf(pt.lower, start);
    if (idx === -1) return -1;
    if (pt.wordStart && idx > 0 && WORD_CHAR.test(h[idx - 1] ?? "")) {
      start = idx + 1;
      continue;
    }
    const after = idx + pt.lower.length;
    if (pt.wordEnd && after < h.length && WORD_CHAR.test(h[after] ?? "")) {
      start = idx + 1;
      continue;
    }
    return idx;
  }
}

export function matchesTerm(haystack: string, pt: ParsedSearchTerm): boolean {
  return findTermIndex(haystack, pt) !== -1;
}

export function snippetAround(
  text: string,
  pt: ParsedSearchTerm,
  maxLen: number,
): string {
  const idx = findTermIndex(text, pt);
  if (idx === -1) return truncate(text, maxLen);
  const contextLen = Math.floor((maxLen - pt.text.length) / 2);
  let start = idx - contextLen;
  let end = idx + pt.text.length + contextLen;
  let prefix = "";
  let suffix = "";
  if (start <= 0) {
    start = 0;
  } else {
    prefix = "...";
    start += 3;
  }
  if (end >= text.length) {
    end = text.length;
  } else {
    suffix = "...";
    end -= 3;
  }
  return prefix + text.slice(start, end) + suffix;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}
