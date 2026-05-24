import { renderSearchResults } from "../output/human";
import { searchSessions } from "../services/search";
import { getSessionSources } from "../services/source-registry";
import { tildify } from "../shared/paths";
import { sessionCutoff } from "./shared";

export interface SearchOpts {
  cwd?: boolean;
  days?: number;
}

export async function cmdSearch(term: string, opts: SearchOpts = {}) {
  const cutoff = opts.days !== undefined ? sessionCutoff(opts.days) : undefined;
  const cwdFilter = opts.cwd ? tildify(process.cwd()) : undefined;
  const matches = await searchSessions(getSessionSources(), term);

  let filtered = matches;
  if (cwdFilter) {
    filtered = filtered.filter(
      (match) => match.session.projectDir === cwdFilter,
    );
  }
  if (cutoff) {
    filtered = filtered.filter(
      (match) =>
        (match.session.lastActiveAt || match.session.startedAt) >= cutoff,
    );
  }

  if (filtered.length === 0) {
    console.log(`No sessions found matching "${term}"`);
    return;
  }

  console.log(renderSearchResults(term, filtered));
}
