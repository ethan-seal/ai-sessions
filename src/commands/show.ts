import { renderTranscript } from "../output/human";
import { outputViaPager } from "../output/pager";
import { discoverSessions, findSessionById } from "../services/discovery";
import { getSessionSources } from "../services/source-registry";
import { loadTranscript } from "../services/transcript";

export async function cmdShow(sessionId: string, short: boolean) {
  const sources = getSessionSources();
  const sessions = await discoverSessions(sources);
  const session = findSessionById(sessions, sessionId);

  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const transcript = await loadTranscript(sources, session);
  outputViaPager(renderTranscript(session, transcript.entries, short));
}
