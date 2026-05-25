import { expect, test } from "bun:test";
import { parseCliArgs } from "./args";

test("parses default list command", () => {
  expect(parseCliArgs([])).toEqual({ kind: "list", opts: {} });
});

test("parses list filters and flags", () => {
  expect(
    parseCliArgs([
      "list",
      "ai-sessions",
      "--cwd",
      "--days",
      "7",
      "--limit",
      "2",
    ]),
  ).toEqual({
    kind: "list",
    filter: "ai-sessions",
    opts: { cwd: true, days: 7, limit: 2 },
  });
});

test("parses multi-word search terms", () => {
  expect(parseCliArgs(["search", "target", "architecture", "--cwd"])).toEqual({
    kind: "search",
    term: "target architecture",
    opts: { cwd: true },
  });
});

test("parses version flag", () => {
  expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
});

test("rejects missing search term", () => {
  expect(() => parseCliArgs(["search"])).toThrow(
    "Usage: ai-sessions search <term>",
  );
});
