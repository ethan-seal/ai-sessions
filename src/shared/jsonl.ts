import { createReadStream } from "node:fs";
import { type FileHandle, open, readFile } from "node:fs/promises";
import { lines, type Seq } from "functools";

const DECODE_CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

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
  return parseJsonlBytes(bytes, parse);
}

/**
 * The parseable records of a file, read and parsed as they are consumed, so a
 * consumer that stops early never reads the rest. Rejects if the file cannot be read.
 */
export function streamJsonlObjects<T>(
  filePath: string,
  parse: (value: unknown) => T | null,
): Seq<T> {
  return lines(
    createReadStream(filePath, { highWaterMark: DECODE_CHUNK_BYTES }),
  )
    .map((line) => parseJsonLine(line, parse))
    .filter((record): record is T => record !== null);
}

/**
 * The parseable records on the complete lines within the last `length` bytes
 * of a file, or none if it cannot be read.
 */
export async function readJsonlTail<T>(
  filePath: string,
  length: number,
  parse: (value: unknown) => T | null,
): Promise<T[]> {
  let file: FileHandle;
  try {
    file = await open(filePath);
  } catch {
    return [];
  }
  try {
    const { size } = await file.stat();
    const start = Math.max(size - length, 0);
    const bytes = await readRange(file, start, size - start);
    if (start === 0) return parseJsonlBytes(bytes, parse);

    // A window that starts mid-file may cut its first line, so skip past the first newline.
    const newline = bytes.indexOf(NEWLINE);
    return newline === -1
      ? []
      : parseJsonlBytes(bytes.subarray(newline + 1), parse);
  } finally {
    await file.close();
  }
}

function parseJsonlBytes<T>(
  bytes: Buffer,
  parse: (value: unknown) => T | null,
): T[] {
  return bytes
    .toString("utf-8")
    .split("\n")
    .flatMap((line) => {
      const parsed = parseJsonLine(line, parse);
      return parsed === null ? [] : [parsed];
    });
}

async function readRange(
  file: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

function* chunksOf(bytes: Uint8Array): Generator<Uint8Array> {
  for (let start = 0; start < bytes.length; start += DECODE_CHUNK_BYTES) {
    yield bytes.subarray(start, start + DECODE_CHUNK_BYTES);
  }
}
