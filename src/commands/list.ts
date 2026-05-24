import { renderSessionGroups } from "../output/human";
import { discoverSessions } from "../services/discovery";
import { groupByProject } from "../services/grouping";
import { getSessionSources } from "../services/source-registry";
import { tildify } from "../shared/paths";
import { sessionCutoff } from "./shared";

export interface ListOpts {
  cwd?: boolean;
  days?: number;
  limit?: number;
}

export async function cmdList(filter?: string, opts: ListOpts = {}) {
  let sessions = await discoverSessions(getSessionSources());

  if (opts.days !== undefined) {
    const cutoff = sessionCutoff(opts.days);
    sessions = sessions.filter(
      (session) => (session.lastActiveAt || session.startedAt) >= cutoff,
    );
  }

  let groups = groupByProject(sessions);

  if (opts.cwd) {
    const cwdPath = tildify(process.cwd());
    groups = groups.filter((group) => group.projectDir === cwdPath);
  } else if (filter) {
    const lower = filter.toLowerCase();
    groups = groups.filter((group) =>
      group.projectDir.toLowerCase().includes(lower),
    );
  }

  if (groups.length === 0) {
    console.log("No sessions found.");
    return;
  }

  console.log(renderSessionGroups(groups, opts.limit));
}
