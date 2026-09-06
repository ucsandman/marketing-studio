// node --test scripts/extract-thumbs-timing.test.mjs
// Regression (skeptic finding, 2026-09-01): the poster frame must derive from the
// demo duration EMBEDDED in <brand>-launch.json, which is what Root.tsx and
// judge-av-sync render from, never from a standalone <brand>-demo.json (tenwords
// carried 55177ms there against 31400ms embedded: 714 frames of drift).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pickFeatureFrame, resolveTimingFrame} from './extract-thumbs.mjs';

test('resolveTimingFrame: uses the launch-embedded demo duration, not props/<brand>-demo.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thumbs-timing-'));
  try {
    mkdirSync(join(dir, 'props'));
    const embedded = 31400;
    const standalone = 55177;
    writeFileSync(
      join(dir, 'props', 'fx-launch.json'),
      JSON.stringify({brandId: 'fx', demo: {telemetry: {durationMs: embedded}}, features: [{heading: 'a'}, {heading: 'b'}]}),
    );
    writeFileSync(join(dir, 'props', 'fx-demo.json'), JSON.stringify({telemetry: {durationMs: standalone}}));
    const mod = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
    const expect = pickFeatureFrame(mod.launchTiming(embedded, 2, null, mod.voTimingFrom([], 2, {force: null})));
    const wrong = pickFeatureFrame(mod.launchTiming(standalone, 2, null, mod.voTimingFrom([], 2, {force: null})));
    assert.notEqual(expect, wrong, 'fixture must discriminate the two sources');
    const got = await resolveTimingFrame('fx', {propsDir: join(dir, 'props')});
    assert.equal(got.frame, expect);
    assert.match(got.source, /timing lookup/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
