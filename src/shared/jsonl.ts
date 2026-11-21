import { readFile } from "node:fs/promises";

export async function readJsonlObjects<T>(
  filePath: string,
  parse: (value: unknown) => T | null,
): Promise<T[]> {
  let data: string;
  try {
    data = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  return data
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const parsed = parse(JSON.parse(line));
        return parsed === null ? [] : [parsed];
      } catch {
        return [];
      }
    });
}
