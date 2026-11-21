import { expect, test } from "bun:test";
import {
  AmbiguousSessionIdError,
  findSessionById,
  type SessionSummary,
} from "./session";

function session(id: string): SessionSummary {
  return {
    id,
    source: "claude",
    projectDir: "~/p",
    cwd: "/p",
    title: "",
    firstMessage: "hi",
    startedAt: "",
    lastActiveAt: "",
    backingRef: "",
    skillEval: false,
  };
}

const sessions = [session("abc123"), session("abc1234"), session("def456")];

test("an exact id wins over longer ids that share its prefix", () => {
  expect(findSessionById(sessions, "abc123")?.id).toBe("abc123");
});

test("a unique prefix resolves to its session", () => {
  expect(findSessionById(sessions, "de")?.id).toBe("def456");
});

test("an ambiguous prefix throws instead of picking one", () => {
  expect(() => findSessionById(sessions, "abc")).toThrow(
    AmbiguousSessionIdError,
  );
});

test("an unknown id is null", () => {
  expect(findSessionById(sessions, "zzz")).toBeNull();
});
