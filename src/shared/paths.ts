import { homedir } from "node:os";

export const HOME = homedir();

export function tildify(path: string): string {
  return path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path;
}

export function untildify(path: string): string {
  return path.startsWith("~") ? HOME + path.slice(1) : path;
}
