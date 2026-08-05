import assert from "node:assert/strict";
import test from "node:test";
import {motionVariants} from "./build-synthacon-motion-props.mjs";

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
