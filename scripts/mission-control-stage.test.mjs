import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyStageReview} from './mission-control.mjs';

const payload = {
  action: 'approved',
  reviewerName: 'Director D',
  reviewerRole: 'director',
  observations: 'The visual system and timing intent are clear enough to proceed.',
};

test('both declared stage artifacts receive named, hash-bound approval sidecars', (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'mission-stage-'));
  t.after(() => rmSync(projectRoot, {recursive: true, force: true}));
  const marketingDir = join(projectRoot, 'marketing', 'assets', 'acme', 'marketing');
  const proofDir = join(marketingDir, 'proof');
  const reviewsDir = join(marketingDir, 'reviews');
  mkdirSync(proofDir, {recursive: true});
  writeFileSync(join(proofDir, 'style.png'), 'style-frame');
  writeFileSync(join(proofDir, 'animatic.mp4'), 'audio-bearing-animatic');
  const directionPath = join(marketingDir, 'direction.json');
  writeFileSync(directionPath, JSON.stringify({
    styleFrame: {
      artifact: 'marketing/assets/acme/marketing/proof/style.png',
      review: 'marketing/assets/acme/marketing/reviews/style.json',
    },
    animatic: {
      artifact: 'marketing/assets/acme/marketing/proof/animatic.mp4',
      review: 'marketing/assets/acme/marketing/reviews/animatic.json',
    },
  }));

  const style = applyStageReview({projectRoot, directionPath, stageName: 'styleFrame', payload});
  const revise = applyStageReview({
    projectRoot,
    directionPath,
    stageName: 'animatic',
    payload: {...payload, action: 'revise', observations: 'The final hold needs another timing pass.'},
  });
  assert.equal(style.status, 200);
  assert.equal(revise.status, 200);
  assert.equal(JSON.parse(readFileSync(join(reviewsDir, 'animatic.json'), 'utf8')).action, 'revise');
  const animatic = applyStageReview({projectRoot, directionPath, stageName: 'animatic', payload});
  assert.equal(animatic.status, 200);
  for (const [file, result] of [['style.json', style], ['animatic.json', animatic]]) {
    const review = JSON.parse(readFileSync(join(reviewsDir, file), 'utf8'));
    assert.equal(review.action, 'approved');
    assert.equal(review.reviewer.name, 'Director D');
    assert.equal(review.observations, payload.observations);
    assert.equal(review.artifactSha256, result.body.artifactSha256);
  }
});

test('escaping paths and stale declared hashes cannot write a stage review', (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'mission-stage-invalid-'));
  t.after(() => rmSync(projectRoot, {recursive: true, force: true}));
  const dir = join(projectRoot, 'marketing', 'assets', 'acme', 'marketing');
  mkdirSync(join(dir, 'proof'), {recursive: true});
  writeFileSync(join(dir, 'proof', 'style.png'), 'current');

  const escaping = join(dir, 'escaping.json');
  writeFileSync(escaping, JSON.stringify({styleFrame: {artifact: '../outside.png', review: '../review.json'}}));
  const escaped = applyStageReview({projectRoot, directionPath: escaping, stageName: 'styleFrame', payload});
  assert.equal(escaped.status, 400);
  assert.equal(existsSync(join(projectRoot, 'review.json')), false);

  const stale = join(dir, 'stale.json');
  const review = 'marketing/assets/acme/marketing/reviews/stale.json';
  writeFileSync(stale, JSON.stringify({styleFrame: {
    artifact: 'marketing/assets/acme/marketing/proof/style.png',
    review,
    sha256: '0'.repeat(64),
  }}));
  const mismatch = applyStageReview({projectRoot, directionPath: stale, stageName: 'styleFrame', payload});
  assert.equal(mismatch.status, 409);
  assert.match(mismatch.body.error, /hash does not match/);
  assert.equal(existsSync(join(projectRoot, review)), false);
});
