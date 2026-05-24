import type { ListOpts } from "../commands/list";
import type { SearchOpts } from "../commands/search";
import { BIN_NAME } from "./help";

export type CliCommand =
  | { readonly kind: "list"; readonly filter?: string; readonly opts: ListOpts }
  | {
      readonly kind: "search";
      readonly term: string;
      readonly opts: SearchOpts;
    }
  | {
      readonly kind: "show";
      readonly sessionId: string;
      readonly short: boolean;
    }
  | { readonly kind: "resume"; readonly sessionId: string }
  | { readonly kind: "help" };

export function parseCliArgs(args: readonly string[]): CliCommand {
  const command = args[0];

  if (!command || command === "list") {
    return parseListArgs(args.slice(1));
  }
  if (command === "search") {
    return parseSearchArgs(args.slice(1));
  }
  if (command === "show") {
    return parseShowArgs(args.slice(1));
  }
  if (command === "resume") {
    return parseResumeArgs(args.slice(1));
  }
  if (command === "help" || command === "--help" || command === "-h") {
    return { kind: "help" };
  }

  throw new Error(
    `Unknown command: ${command}. Run "${BIN_NAME} help" for usage.`,
  );
}

function parseListArgs(args: readonly string[]): CliCommand {
  let filter: string | undefined;
  const opts: ListOpts = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cwd") {
      opts.cwd = true;
    } else if (arg === "--days" && args[i + 1]) {
      opts.days = parsePositiveInt(args[++i] ?? "", "--days");
    } else if (arg === "--limit" && args[i + 1]) {
      opts.limit = parsePositiveInt(args[++i] ?? "", "--limit");
    } else if (arg && !arg.startsWith("--")) {
      filter = arg;
    }
  }

  return { kind: "list", filter, opts };
}

function parseSearchArgs(args: readonly string[]): CliCommand {
  const termParts: string[] = [];
  const opts: SearchOpts = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cwd") {
      opts.cwd = true;
    } else if (arg === "--days" && args[i + 1]) {
      opts.days = parsePositiveInt(args[++i] ?? "", "--days");
    } else if (arg) {
      termParts.push(arg);
    }
  }

  if (termParts.length === 0) {
    throw new Error(`Usage: ${BIN_NAME} search <term> [--cwd] [--days <n>]`);
  }

  return { kind: "search", term: termParts.join(" "), opts };
}

function parseShowArgs(args: readonly string[]): CliCommand {
  const short = args.includes("--short");
  const sessionId = args.find((arg) => !arg.startsWith("--"));
  if (!sessionId) {
    throw new Error(`Usage: ${BIN_NAME} show <session-id> [--short]`);
  }

  return { kind: "show", sessionId, short };
}

function parseResumeArgs(args: readonly string[]): CliCommand {
  const sessionId = args[0];
  if (!sessionId) {
    throw new Error(`Usage: ${BIN_NAME} resume <session-id>`);
  }

  return { kind: "resume", sessionId };
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new Error(`Error: ${flag} must be a positive integer.`);
  }
  return parsed;
}
