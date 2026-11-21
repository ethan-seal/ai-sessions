import { expect, test } from "bun:test";
import type { SessionSummary } from "../domain/session";
import { groupByProject } from "./grouping";

function session(
  id: string,
  projectDir: string,
  lastActiveAt: string,
): SessionSummary {
  return {
    id,
    source: "claude",
    projectDir,
    cwd: "",
    title: "",
    firstMessage: "hi",
    startedAt: lastActiveAt,
    lastActiveAt,
    backingRef: "",
    skillEval: false,
  };
}

test("groups by project, newest session first, newest project first", () => {
  const groups = groupByProject([
    session("a1", "~/a", "2026-01-01T00:00:00Z"),
    session("b1", "~/b", "2026-03-01T00:00:00Z"),
    session("a2", "~/a", "2026-02-01T00:00:00Z"),
  ]);

  expect(groups.map((group) => group.projectDir)).toEqual(["~/b", "~/a"]);
  expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["a2", "a1"]);
  expect(groups[1]?.lastActiveAt).toBe("2026-02-01T00:00:00Z");
});

test("does not reorder the input array", () => {
  const input = [
    session("old", "~/a", "2026-01-01T00:00:00Z"),
    session("new", "~/a", "2026-02-01T00:00:00Z"),
  ];
  groupByProject(input);
  expect(input.map((s) => s.id)).toEqual(["old", "new"]);
});
