import { claudeSource } from "../sources/claude";
import { codexSource } from "../sources/codex";
import { opencodeSource } from "../sources/opencode";
import type { SessionSource } from "../sources/session-source";

export function getSessionSources(): readonly SessionSource[] {
  return [claudeSource, opencodeSource, codexSource];
}
