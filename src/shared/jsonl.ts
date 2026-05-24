import { readFileSync } from "node:fs";

export function readJsonlObjects<T>(
  filePath: string,
  parse: (value: unknown) => T | null,
): T[] {
  let data: string;
  try {
    data = readFileSync(filePath, "utf-8");
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
