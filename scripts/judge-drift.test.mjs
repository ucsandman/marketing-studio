// Tests for judge-drift.mjs's CLI-level behaviour. The descriptor and set math
// live in scripts/lib/drift.test.mjs; this covers what the judge itself decides.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isToolingArtifact} from './judge-drift.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cli = join(here, 'judge-drift.mjs');

test('another judge’s diagnostic output is not scored as a brand asset', () => {
  // Measured: judge-audio's waveform PNG scored 11.2 sd from the dashclaw
  // centroid. Worse than a spurious warning — it inflated the set's stdev enough
  // to MASK three real outliers, because driftZ is measured in stdevs.
  assert.equal(isToolingArtifact('judge-audio.png'), true);
  assert.equal(isToolingArtifact('judge-palette.png'), true);
  assert.equal(isToolingArtifact('mc-proof-run-view.png'), true);
});

test('real brand assets are never mistaken for tooling output', () => {
  for (const name of [
    'LaunchVideo-logo.png',
    'og.png',
    'readme.gif',
    'thumb-16x9.jpg',
    'social-linkedin-final-045.png',
    'ProductDemo-beat4-decisions.png',
  ]) {
    assert.equal(isToolingArtifact(name), false, `${name} should be scored`);
  }
});

// The CLI tests need rendered assets, which a clean clone does not have (out/ is
// a gitignored build product). Skip rather than fail when there is nothing to
// score — same philosophy as the rest of the repo's optional-dependency gates.
const noban = join(root, 'out', 'noban');
const haveAssets = existsSync(noban);

test('CLI scores the real noban set and writes both artifacts', {skip: !haveAssets}, () => {
  execFileSync('node', [cli, 'noban', '--no-video'], {cwd: root, encoding: 'utf8'});
  const reportPath = join(root, 'out', 'noban', 'marketing', 'judge-drift.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));

  assert.equal(report.judge, 'drift');
  assert.ok(['PASS', 'FAIL'].includes(report.verdict));
  assert.ok(report.assets.length > 0);
  // The calibration basis must always be stated so a z-score is never quoted bare.
  assert.ok(Object.hasOwn(report.calibration, 'trustworthy'));
  assert.ok(Object.hasOwn(report.calibration, 'basis'));
  // Worst-first ordering is what makes the review grid usable.
  const distances = report.assets.map((a) => a.distance);
  assert.deepEqual(distances, [...distances].sort((a, b) => b - a));
  assert.ok(existsSync(join(root, 'out', 'noban', 'marketing', 'drift-sheet.html')));
});

test('CLI exits non-zero for an unknown brand', () => {
  assert.throws(() => execFileSync('node', [cli, 'definitely-not-a-brand'], {cwd: root, stdio: 'pipe'}));
});

test('CLI requires a brand argument', () => {
  assert.throws(() => execFileSync('node', [cli], {cwd: root, stdio: 'pipe'}));
});
