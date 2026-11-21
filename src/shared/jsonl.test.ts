import { expect, test } from "bun:test";
import { bufferLines, readJsonlObjects } from "./jsonl";

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
