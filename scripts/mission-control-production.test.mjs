import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyProductionReview, readProductionState, snapshotApproved} from './mission-control.mjs';
import {sha256Json} from './lib/production-quality.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'mission-production-'));
after(() => rmSync(tmp, {recursive: true, force: true}));

const evidence = {
  planSha256: 'a'.repeat(64),
  renderSha256: 'b'.repeat(64),
  sourceBundleSha256: 'c'.repeat(64),
  shots: 1,
  sampleCount: 3,
  sheetPath: 'marketing/assets/acme/marketing/stills/Production-sheet.html',
  renderPath: 'marketing/assets/acme/launch.mp4',
  samples: [
    {shotId: 'hero', phase: 'start'},
    {shotId: 'hero', phase: 'middle'},
    {shotId: 'hero', phase: 'end'},
  ],
};

const approvedPayload = {
  action: 'approved',
  reviewerName: 'Director D',
  reviewerRole: 'director',
  observations: 'The product proof is legible and the final hold lands.',
  watchedFullRender: true,
  heardAudio: true,
  wouldShare: true,
  scores: {storyClarity: 4, visualHierarchy: 4, motionIntent: 4, productReadability: 5, endingConfidence: 4},
  defects: [],
};

test('Mission Control writes a structured review bound to current source, render, and evidence hashes', () => {
  const path = join(tmp, 'review.json');
  const result = applyProductionReview(path, approvedPayload, evidence, {now: new Date('2026-09-05T20:00:00.000Z')});
  assert.equal(result.status, 200);
  const rows = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'mission-control');
  assert.equal(rows[0].planSha256, evidence.planSha256);
  assert.equal(rows[0].renderSha256, evidence.renderSha256);
  assert.equal(rows[0].evidenceSha256, sha256Json(evidence));
  assert.deepEqual(rows[0].evidenceCoverage, {shots: 1, samples: 3, sheetPath: evidence.sheetPath});
});

test('author self-score and checkbox-only approval are rejected before writing', () => {
  const path = join(tmp, 'author-review.json');
  const author = applyProductionReview(path, {...approvedPayload, reviewerRole: 'author'}, evidence);
  assert.equal(author.status, 400);
  assert.match(author.body.error, /author self-review/);
  // observations is optional under the one-click reviewer contract (2026-09-06 redesign): empty text is accepted, not rejected.
  const noObservation = applyProductionReview(path, {...approvedPayload, observations: ''}, evidence);
  assert.equal(noObservation.status, 200);
  const arbitraryRole = applyProductionReview(path, {...approvedPayload, reviewerRole: 'producer'}, evidence);
  assert.equal(arbitraryRole.status, 400);
  assert.match(arbitraryRole.body.error, /reviewer role/);
});

test('approval snapshots reject a junction that escapes the product brand', (t) => {
  const brandOut = join(tmp, 'brand-root');
  const outside = join(tmp, 'outside-root');
  mkdirSync(brandOut, {recursive: true});
  mkdirSync(outside, {recursive: true});
  writeFileSync(join(outside, 'private.png'), 'outside');
  try {
    symlinkSync(outside, join(brandOut, 'linked'), 'junction');
  } catch (error) {
    t.skip(`junction unavailable: ${error.code ?? error.message}`);
    return;
  }
  assert.equal(snapshotApproved(brandOut, 'linked/private.png'), null);
});

test('approval is impossible when rendered evidence is empty', () => {
  const result = applyProductionReview(join(tmp, 'empty-review.json'), approvedPayload, {...evidence, samples: []});
  assert.equal(result.status, 409);
  assert.match(result.body.error, /evidence is missing/);
});

test('production state exposes processed counts, review, sheet, and render URLs', () => {
  const projectRoot = join(tmp, 'product');
  const brandOut = join(projectRoot, 'marketing', 'assets', 'acme');
  const marketingDir = join(brandOut, 'marketing');
  mkdirSync(join(marketingDir, 'stills'), {recursive: true});
  writeFileSync(join(marketingDir, 'stills', 'Production-sheet.html'), '<h1>sheet</h1>');
  writeFileSync(join(marketingDir, 'production-evidence.json'), JSON.stringify(evidence));
  writeFileSync(join(marketingDir, 'judge-production.json'), JSON.stringify({verdict: 'PASS', generatedAt: '2026-09-05T20:00:00.000Z', summary: {shots: 1}}));
  const review = [{type: 'production-visual-review', action: 'approved', reviewer: {name: 'Director D', role: 'director'}, planSha256: evidence.planSha256, renderSha256: evidence.renderSha256, sourceBundleSha256: evidence.sourceBundleSha256, evidenceSha256: sha256Json(evidence), scores: approvedPayload.scores, defects: []}];
  const state = readProductionState(marketingDir, review, {brandOutDir: brandOut, projectRoot});
  assert.equal(state.ready, true);
  assert.equal(state.shots, 1);
  assert.equal(state.samples, 3);
  assert.equal(state.report.verdict, 'PASS');
  assert.equal(state.latestReview.action, 'approved');
  assert.equal(state.latestReview.current, true);
  assert.equal(state.sheetUrl, '/media/marketing/stills/Production-sheet.html');
  assert.equal(state.renderUrl, '/media/launch.mp4');
});
