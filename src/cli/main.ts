import { cmdList } from "../commands/list";
import { cmdResume } from "../commands/resume";
import { cmdSearch } from "../commands/search";
import { cmdShow } from "../commands/show";
import { type CliCommand, parseCliArgs } from "./args";
import { helpText } from "./help";

export async function runCli(argv: readonly string[]): Promise<void> {
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
    case "help":
      console.log(helpText());
      return;
  }
}
