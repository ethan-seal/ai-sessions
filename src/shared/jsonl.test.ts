import { expect, test } from "bun:test";
import {
  bufferLines,
  readJsonlObjects,
  readJsonlTail,
  streamJsonlObjects,
} from "./jsonl";

test("bufferLines decodes multi-byte text that straddles a chunk boundary", async () => {
  // Pad so a 3-byte character crosses the 64 KiB chunk boundary.
  const padding = "x".repeat(64 * 1024 - 1);
  const bytes = new TextEncoder().encode(`${padding}€\nsecond\n`);
  expect(await bufferLines(bytes).toArray()).toEqual([`${padding}€`, "second"]);
});

test("bufferLines stops decoding once the consumer has its match", async () => {
  const bytes = new TextEncoder().encode(
    `first\n${"y".repeat(10 * 1024 * 1024)}\n`,
  );
  expect(await bufferLines(bytes).find((line) => line === "first")).toBe(
    "first",
  );
});

test("readJsonlObjects skips blank, malformed and rejected lines and tolerates a missing file", async () => {
  const path = `${import.meta.dir}/jsonl-fixture.jsonl`;
  await Bun.write(
    path,
    ['{"n":1}', "", "not json", '{"n":"skip"}', '{"n":2}'].join("\n"),
  );
  try {
    const numbers = await readJsonlObjects(path, (value) => {
      const n = (value as { n: unknown }).n;
      return typeof n === "number" ? n : null;
    });
    expect(numbers).toEqual([1, 2]);
    expect(await readJsonlObjects(`${path}.missing`, () => 1)).toEqual([]);
  } finally {
    await Bun.file(path).delete();
  }
});

test("readJsonlTail keeps only the complete lines inside its window", async () => {
  const path = `${import.meta.dir}/jsonl-tail-fixture.jsonl`;
  await Bun.write(
    path,
    ['{"n":1}', '{"n":2}', '{"n":3}', '{"n":4}'].join("\n"),
  );
  try {
    const asNumber = (value: unknown) => (value as { n: number }).n;
    // 12 bytes covers line 4 and part of line 3.
    expect(await readJsonlTail(path, 12, asNumber)).toEqual([4]);
    // A window with no complete line yields nothing.
    expect(await readJsonlTail(path, 5, asNumber)).toEqual([]);
    // A window covering the file yields every line.
    expect(await readJsonlTail(path, 1024, asNumber)).toEqual([1, 2, 3, 4]);
    expect(await readJsonlTail(`${path}.missing`, 1024, asNumber)).toEqual([]);
  } finally {
    await Bun.file(path).delete();
  }
});

test("streamJsonlObjects skips unparseable lines and stops reading when the consumer does", async () => {
  const path = `${import.meta.dir}/jsonl-stream-fixture.jsonl`;
  await Bun.write(
    path,
    ['{"n":1}', "not json", '{"n":2}', "x".repeat(1024 * 1024)].join("\n"),
  );
  try {
    const asNumber = (value: unknown) => (value as { n: number }).n;
    expect(await streamJsonlObjects(path, asNumber).find((n) => n === 2)).toBe(
      2,
    );
    expect(await streamJsonlObjects(path, asNumber).toArray()).toEqual([1, 2]);
  } finally {
    await Bun.file(path).delete();
  }
});
