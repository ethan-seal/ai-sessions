import { readFile } from "node:fs/promises";
import { lines, type Seq } from "functools";

const DECODE_CHUNK_BYTES = 64 * 1024;

/** The raw bytes of a file, or null if it cannot be read. */
export async function readFileBytes(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * The lines of a buffer, decoded lazily a chunk at a time, so a consumer that
 * stops early (`find`) never decodes the rest.
 */
export function bufferLines(bytes: Uint8Array): Seq<string> {
  return lines(chunksOf(bytes));
}

/** Parses one JSONL line with `parse`, or null if the line is blank, malformed or rejected. */
export function parseJsonLine<T>(
  line: string,
  parse: (value: unknown) => T | null,
): T | null {
  if (!line.trim()) return null;
  try {
    return parse(JSON.parse(line));
  } catch {
    return null;
  }
}

/** Every parseable record in a file. Reads and splits in one pass, which beats a lazy pipeline when all lines are needed. */
export async function readJsonlObjects<T>(
  filePath: string,
  parse: (value: unknown) => T | null,
): Promise<T[]> {
  const bytes = await readFileBytes(filePath);
  if (!bytes) return [];

  return bytes
    .toString("utf-8")
    .split("\n")
    .flatMap((line) => {
      const parsed = parseJsonLine(line, parse);
      return parsed === null ? [] : [parsed];
    });
}

function* chunksOf(bytes: Uint8Array): Generator<Uint8Array> {
  for (let start = 0; start < bytes.length; start += DECODE_CHUNK_BYTES) {
    yield bytes.subarray(start, start + DECODE_CHUNK_BYTES);
  }
}
