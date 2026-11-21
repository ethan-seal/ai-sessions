import { readdir, stat } from "node:fs/promises";

export async function safeReaddir(dirPath: string): Promise<string[]> {
  try {
    return await readdir(dirPath);
  } catch {
    return [];
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** How many files are read at once while scanning session history. */
export const FILE_READ_CONCURRENCY = 16;
