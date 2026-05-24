import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { discoverSessions, findSessionById } from "../services/discovery";
import { getResumeTarget } from "../services/resume";
import { getSessionSources } from "../services/source-registry";
import { untildify } from "../shared/paths";
import { shortId } from "./shared";

export async function cmdResume(sessionId: string) {
  const sources = getSessionSources();
  const sessions = await discoverSessions(sources);
  const session = findSessionById(sessions, sessionId);

  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const target = await getResumeTarget(sources, session);

  if (target.unavailableReason) {
    console.error(target.unavailableReason);
    process.exit(1);
  }

  const cwd = target.cwd || session.cwd || untildify(session.projectDir);

  if (!existsSync(cwd)) {
    console.error(`Working directory no longer exists: ${cwd}`);
    process.exit(1);
  }

  console.log(
    `Resuming ${session.source} session ${shortId(session.id)} in ${session.projectDir}...`,
  );
  try {
    spawnSync(target.executable, [...target.args], { cwd, stdio: "inherit" });
  } catch {
    // tool exiting is normal
  }
}
