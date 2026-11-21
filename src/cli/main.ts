import { cmdList } from "../commands/list";
import { cmdResume } from "../commands/resume";
import { cmdSearch } from "../commands/search";
import { cmdShow } from "../commands/show";
import { AmbiguousSessionIdError } from "../domain/session";
import { type CliCommand, parseCliArgs } from "./args";
import { helpText } from "./help";
import { versionText } from "./version";

export async function runCli(argv: readonly string[]): Promise<void> {
  try {
    await dispatch(argv);
  } catch (error) {
    if (!(error instanceof AmbiguousSessionIdError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

async function dispatch(argv: readonly string[]): Promise<void> {
  let command: CliCommand;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  switch (command.kind) {
    case "list":
      await cmdList(command.filter, command.opts);
      return;
    case "search":
      await cmdSearch(command.term, command.opts);
      return;
    case "show":
      await cmdShow(command.sessionId, command.short);
      return;
    case "resume":
      await cmdResume(command.sessionId);
      return;
    case "version":
      console.log(versionText());
      return;
    case "help":
      console.log(helpText());
      return;
  }
}
