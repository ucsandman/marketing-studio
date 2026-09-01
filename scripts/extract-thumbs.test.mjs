// node --test scripts/extract-thumbs.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pickFeatureFrame, FEATURE_SETTLE_FRAMES} from './extract-thumbs.mjs';

// Hand-built timing fixtures (no dependency on launchTiming.ts internals), same
// convention scripts/judge-av-sync.test.mjs uses for its own timing-consuming
// pure functions.
const OLD_CONSTANT = 220; // LOGO_LEN (150) + 70, the fixed guess this replaces

test('pickFeatureFrame: two-feature brand lands on the first feature act, not the old constant', () => {
  // logo(150) + hook(186) + demo(240) = 576 -> first feature act starts at 576.
  const timing = {
    logo: {from: 0, len: 150},
    hook: {from: 150, len: 186},
    demo: {from: 336, len: 240},
    features: [
      {from: 576, len: 180},
      {from: 756, len: 180},
    ],
    end: {from: 936, len: 150},
  };
  const frame = pickFeatureFrame(timing);
  assert.equal(frame, 576 + FEATURE_SETTLE_FRAMES);
  assert.notEqual(frame, OLD_CONSTANT);
});

test('pickFeatureFrame: a brand with a longer logo/hook/demo run still lands in the feature act, not the old constant', () => {
  // A brand whose act table runs long enough that OLD_CONSTANT (220) would still
  // land inside the demo act, not any feature act — exactly the drift the fixed
  // guess produced per-brand.
  const timing = {
    logo: {from: 0, len: 150},
    hook: {from: 150, len: 225},
    demo: {from: 375, len: 400},
    features: [{from: 775, len: 230}],
    end: {from: 1005, len: 190},
  };
  const frame = pickFeatureFrame(timing);
  assert.equal(frame, 775 + FEATURE_SETTLE_FRAMES);
  assert.ok(frame > timing.demo.from + timing.demo.len, 'must land past the demo act, not inside it');
});

test('pickFeatureFrame: no feature acts -> null (caller falls back to the constant)', () => {
  const timing = {
    logo: {from: 0, len: 150},
    hook: {from: 150, len: 186},
    demo: {from: 336, len: 240},
    features: [],
    end: {from: 576, len: 150},
  };
  assert.equal(pickFeatureFrame(timing), null);
});

test('pickFeatureFrame: missing/malformed timing -> null, never throws', () => {
  assert.equal(pickFeatureFrame(null), null);
  assert.equal(pickFeatureFrame({}), null);
  assert.equal(pickFeatureFrame({features: [{}]}), null); // from is not finite
});

test('pickFeatureFrame: settle offset is overridable', () => {
  const timing = {features: [{from: 500, len: 180}]};
  assert.equal(pickFeatureFrame(timing, 10), 510);
});
