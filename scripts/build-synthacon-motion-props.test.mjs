import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {motionVariants, writeCanonicalProps} from "./build-synthacon-motion-props.mjs";

test("defines one canonical props entry for every direction and format", () => {
  assert.equal(motionVariants.length, 4);
  assert.deepEqual(
    motionVariants.map(({direction, formatWidth, formatHeight}) => `${direction}-${formatWidth}x${formatHeight}`),
    [
      "A-1080x1920",
      "A-1080x1080",
      "C-1080x1920",
      "C-1080x1080",
    ],
  );
});

test("writeCanonicalProps writes the direction A 1080x1080 variant", () => {
  const dir = mkdtempSync(join(tmpdir(), "synthacon-motion-"));
  const outPath = join(dir, "synthacon-motion.json");
  const returned = writeCanonicalProps(outPath);
  assert.equal(returned, outPath);
  const written = JSON.parse(readFileSync(outPath, "utf8"));
  const expected = motionVariants.find((p) => p.direction === "A" && p.formatWidth === 1080 && p.formatHeight === 1080);
  assert.deepEqual(written, expected);
  assert.equal(written.formatWidth, 1080);
  assert.equal(written.formatHeight, 1080);
  assert.equal(written.direction, "A");
  rmSync(dir, {recursive: true, force: true});
});
