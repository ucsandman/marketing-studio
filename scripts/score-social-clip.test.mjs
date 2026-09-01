import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreFilter, voFits, VO_LEAD_MS} from './score-social-clip.mjs';

test('voFits needs the lead plus the line inside the clip', () => {
  assert.equal(voFits(10048, 9740), true); // postflop hook under the 10.048s X clip
  assert.equal(voFits(10048, 9800), false); // 300 + 9800 > 10048
  assert.equal(voFits(10048, 10048 - VO_LEAD_MS), true);
});

test('scoreFilter trims the bed to the clip, fades it under the end card, delays the VO', () => {
  const f = scoreFilter(10.048);
  assert.match(f, /atrim=0:10\.048/);
  assert.match(f, /afade=t=out:st=9\.248:d=0\.8/);
  assert.match(f, /acompressor=[^,]+,adelay=300\|300/);
  assert.match(f, /amix=inputs=2:duration=first:normalize=0\[mix\]$/);
});

test('scoreFilter never produces a negative fade start on a clip shorter than the fade', () => {
  assert.match(scoreFilter(0.5), /afade=t=out:st=0\.000:d=0\.8/);
});
