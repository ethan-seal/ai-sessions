import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseClaudeSession } from "./index";

const FIXTURES = join(import.meta.dir, "fixtures");

function parseFixture(name: string) {
  const session = parseClaudeSession(join(FIXTURES, `${name}.jsonl`));
  if (!session) throw new Error(`fixture ${name} did not parse`);
  return session;
}

test("flags claude -p sessions with temporary eval commands as skill evals", () => {
  const session = parseFixture("headless-eval");
  expect(session.id).toBe("11111111-1111-4111-8111-111111111111");
  expect(session.skillEval).toBe(true);
});

test("does not flag claude -p sessions without eval commands", () => {
  expect(parseFixture("headless-no-eval").skillEval).toBe(false);
});

test("does not flag interactive sessions that picked up eval commands", () => {
  expect(parseFixture("interactive-eval").skillEval).toBe(false);
});

test("does not flag names that only resemble eval commands", () => {
  expect(parseFixture("headless-lookalike-names").skillEval).toBe(false);
});
