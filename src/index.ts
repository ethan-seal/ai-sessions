#!/usr/bin/env bun

export {
  findTermIndex,
  matchesTerm,
  parseTerm,
  snippetAround,
} from "./domain/search";

import { runCli } from "./cli/main";

if (import.meta.main) {
  await runCli(process.argv.slice(2));
}
