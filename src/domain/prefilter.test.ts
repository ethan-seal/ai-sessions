import { expect, test } from "bun:test";
import { buildPrefilter, matchesTerm, parseTerm } from "./search";

/** The prefilter may say "maybe" too often, but must never reject a line that really matches. */
function rejectsOnlyNonMatches(termText: string, content: string) {
  const term = parseTerm(termText);
  const line = JSON.stringify({ type: "user", message: { content } });
  if (matchesTerm(content, term)) expect(buildPrefilter(term)(line)).toBe(true);
}

test("rejects text that lacks the term, ignoring case", () => {
  const mayMatch = buildPrefilter(parseTerm("DirName"));
  expect(mayMatch('{"text":"call dirname here"}')).toBe(true);
  expect(mayMatch('{"text":"nothing relevant"}')).toBe(false);
});

test("treats regex metacharacters in the term literally", () => {
  const mayMatch = buildPrefilter(parseTerm("a.b(c)"));
  expect(mayMatch("xx a.b(c) xx")).toBe(true);
  expect(mayMatch("xx aXb(c) xx")).toBe(false);
});

test("strips \\b markers before building the check", () => {
  expect(buildPrefilter(parseTerm("\\bjai\\b"))("a jai b")).toBe(true);
});

test("terms JSON would escape or that are not ASCII always say maybe", () => {
  for (const text of ['say "hi"', "back\\slash", "café", "tab\there"]) {
    expect(buildPrefilter(parseTerm(text))("unrelated")).toBe(true);
  }
});

test("never rejects a record whose content matches", () => {
  const contents = [
    "plain Text with MiXeD case",
    "multi\nline with the term\nacross lines",
    'quote " and \\ backslash near term',
    "tab\tseparated term",
    "emoji 🎉 then term",
    "cafés and term",
  ];
  for (const termText of [
    "term",
    "TERM",
    "with the",
    "near term",
    "then term",
    "and term",
  ]) {
    for (const content of contents) rejectsOnlyNonMatches(termText, content);
  }
});
