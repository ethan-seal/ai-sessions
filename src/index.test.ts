import { expect, test } from "bun:test";
import { findTermIndex, parseTerm, snippetAround } from "./index";

test("word-boundary previews center on the accepted match", () => {
  const text = "jail " + "x".repeat(80) + " jai";
  const term = parseTerm("\\bjai\\b");

  expect(findTermIndex(text, term)).toBe(text.lastIndexOf("jai"));
  expect(snippetAround(text, term, 30)).toEndWith(" jai");
  expect(snippetAround(text, term, 30)).not.toStartWith("jail");
});

test("plain substring previews still use the first substring match", () => {
  const text = "jail " + "x".repeat(80) + " jai";
  const term = parseTerm("jai");

  expect(findTermIndex(text, term)).toBe(0);
  expect(snippetAround(text, term, 30)).toStartWith("jail");
});
