import assert from "node:assert/strict";
import test from "node:test";
import {renderPlan} from "./render-synthacon-motion.mjs";

test("renders and faststart-remuxes the canonical four variants to committed filenames", () => {
  const plan = renderPlan("/tmp/props", "/tmp/rendered");
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map(({name}) => name), [
    "A-1080x1920",
    "A-1080x1080",
    "C-1080x1920",
    "C-1080x1080",
  ]);
  assert.equal(plan[0].finalPath, "/tmp/rendered/A-1080x1920.mp4");
  assert.equal(plan[0].rawPath, "/tmp/rendered/A-1080x1920.raw.mp4");
});
