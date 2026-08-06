// node --test scripts/check-budgets.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchBudget, checkFiles, BUDGETS} from './check-budgets.mjs';

// --- matchBudget: which budget applies to which path -----------------------

test('readme.gif matches the readme-gif budget', () => {
  assert.equal(matchBudget('out/synthacon/readme.gif'), BUDGETS['readme-gif']);
  assert.equal(matchBudget('README.GIF'), BUDGETS['readme-gif']); // case-insensitive
});

test('og.mp4 matches the web-hero-og-mp4 budget', () => {
  assert.equal(matchBudget('out/synthacon/og.mp4'), BUDGETS['web-hero-og-mp4']);
});

test('launch-*.mp4 matrix rows match the web-hero-og-mp4 budget', () => {
  assert.equal(matchBudget('out/synthacon/matrix/launch-16x9.mp4'), BUDGETS['web-hero-og-mp4']);
  assert.equal(matchBudget('out/synthacon/matrix/launch-9x16-captioned.mp4'), BUDGETS['web-hero-og-mp4']);
});

test('social-*.mp4 matrix rows match the social-mp4 budget', () => {
  assert.equal(matchBudget('out/synthacon/matrix/social-1x1.mp4'), BUDGETS['social-mp4']);
  assert.equal(matchBudget('out/synthacon/matrix/social-9x16-captioned.mp4'), BUDGETS['social-mp4']);
});

test('the launch-/social- rule also applies inside postkit/<platform>/', () => {
  assert.equal(matchBudget('out/synthacon/postkit/linkedin/launch-16x9.mp4'), BUDGETS['web-hero-og-mp4']);
  assert.equal(matchBudget('out/synthacon/postkit/x/social-16x9.mp4'), BUDGETS['social-mp4']);
});

test('.webm files match the webm budget regardless of launch-/social- prefix', () => {
  assert.equal(matchBudget('out/synthacon/matrix/launch-16x9.webm'), BUDGETS.webm);
  assert.equal(matchBudget('out/synthacon/matrix/social-1x1.webm'), BUDGETS.webm);
});

test('thumb-<aspect>.jpg matches the thumb-jpg budget', () => {
  assert.equal(matchBudget('out/synthacon/thumbs/thumb-16x9.jpg'), BUDGETS['thumb-jpg']);
  assert.equal(matchBudget('out/synthacon/thumbs/thumb-1x1.jpeg'), BUDGETS['thumb-jpg']);
});

test('thumb png fallback has no matching budget (not in the table)', () => {
  assert.equal(matchBudget('out/synthacon/thumbs/thumb-16x9.png'), null);
});

test('og.gif has no matching budget (deliberately not covered by the table)', () => {
  assert.equal(matchBudget('out/synthacon/og.gif'), null);
});

test('non-media files (props json, caption/alt text, POST.md) have no matching budget', () => {
  assert.equal(matchBudget('out/synthacon/matrix/.props/launch-16x9.json'), null);
  assert.equal(matchBudget('out/synthacon/postkit/x/caption.txt'), null);
  assert.equal(matchBudget('out/synthacon/postkit/x/alt.txt'), null);
  assert.equal(matchBudget('out/synthacon/postkit/youtube/POST.md'), null);
  assert.equal(matchBudget('out/synthacon/captions/launch.srt'), null);
});

test('an mp4 with neither launch- nor social- prefix has no matching budget', () => {
  assert.equal(matchBudget('out/synthacon/demo.mp4'), null);
  assert.equal(matchBudget('out/synthacon/logo-reveal.mp4'), null);
});

// --- checkFiles: PASS/OVER against real file sizes --------------------------
// Uses temp fixture files so the sizing math is exercised end to end, not just the
// path-matching rule above.

import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function tmpFile(name, bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'check-budgets-test-'));
  const p = join(dir, name);
  writeFileSync(p, Buffer.alloc(bytes));
  return {dir, p};
}

test('checkFiles: a file under its budget is PASS', () => {
  const {dir, p} = tmpFile('og.mp4', 1024);
  try {
    const [result] = checkFiles([p]);
    assert.equal(result.status, 'PASS');
    assert.equal(result.budget, 'web hero/og mp4');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('checkFiles: a file over its budget is OVER', () => {
  const {dir, p} = tmpFile('thumb-1x1.jpg', 500 * 1024); // budget is 400KB
  try {
    const [result] = checkFiles([p]);
    assert.equal(result.status, 'OVER');
    assert.equal(result.budget, 'thumbs jpg');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('checkFiles: a file exactly at the budget is PASS (not OVER)', () => {
  const {dir, p} = tmpFile('readme.gif', 5 * 1024 * 1024);
  try {
    const [result] = checkFiles([p]);
    assert.equal(result.status, 'PASS');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('checkFiles: files with no matching budget are excluded from the results', () => {
  const {dir, p} = tmpFile('og.gif', 1024);
  try {
    assert.deepEqual(checkFiles([p]), []);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
