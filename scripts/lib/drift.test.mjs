import {test} from 'node:test';
import assert from 'node:assert/strict';
import {solidImage, hexToRgb} from './png.mjs';
import {
  describe as describeImage,
  centroid,
  distance,
  scoreSet,
  MIN_SET,
  PALETTE_BINS,
  LUMA_BINS,
  PALETTE_WEIGHT,
  LUMA_WEIGHT,
} from './drift.mjs';

const NOBAN = ['#8847ff', '#d6c23c', '#3fd08c', '#0b0a0f'].map(hexToRgb);

// A flat field of one colour: the simplest image whose descriptor is predictable.
const flat = (hex) => solidImage(8, 8, hexToRgb(hex));

test('a descriptor has the declared shape and its halves carry the declared weight', () => {
  const d = describeImage(flat('#8847ff'), NOBAN);
  assert.equal(d.vector.length, PALETTE_BINS + LUMA_BINS);
  const paletteSum = d.vector.slice(0, PALETTE_BINS).reduce((a, v) => a + v, 0);
  const lumaSum = d.vector.slice(PALETTE_BINS).reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(paletteSum - PALETTE_WEIGHT) < 1e-9, `palette half summed to ${paletteSum}`);
  assert.ok(Math.abs(lumaSum - LUMA_WEIGHT) < 1e-9, `luma half summed to ${lumaSum}`);
});

test('the same colour at two resolutions produces an identical descriptor', () => {
  // Size invariance is the whole reason this uses histograms: stills of
  // different dimensions have to be directly comparable.
  const small = describeImage(solidImage(4, 4, hexToRgb('#8847ff')), NOBAN);
  const large = describeImage(solidImage(64, 40, hexToRgb('#8847ff')), NOBAN);
  assert.equal(distance(small.vector, large.vector), 0);
});

test('tokenShare is 1 on a brand colour and 0 on an off-brand one', () => {
  assert.equal(describeImage(flat('#8847ff'), NOBAN).tokenShare, 1);
  // Hot pink: colourful, and far from every noban token.
  assert.equal(describeImage(flat('#ff1493'), NOBAN).tokenShare, 0);
});

test('a near-miss colour is NOT absorbed into a neighbouring token by coarse binning', () => {
  // Regression: hot pink sits 92 RGB units from noban's magenta `rare` token —
  // correctly off-palette — but its 64-wide bucket CENTRE sits only 70 units
  // away. Measuring tokenShare on the coarse palette grid scored a deliberately
  // off-brand probe as 100% on-brand, which silently disabled the FAIL verdict.
  assert.equal(describeImage(flat('#ff1493'), NOBAN).tokenShare, 0);
  // The real magenta token must still read as fully on-brand.
  assert.equal(describeImage(flat('#df3ce0'), NOBAN).tokenShare, 1);
});

test('a greyscale image has no opinion about token adherence', () => {
  // Reporting 0 here would read as "totally off brand" when the honest answer is
  // "there is no colour to judge".
  assert.equal(describeImage(flat('#808080'), NOBAN).tokenShare, null);
  assert.equal(describeImage(flat('#000000'), NOBAN).tokenShare, null);
});

test('distance grows with visual difference', () => {
  const brand = describeImage(flat('#8847ff'), NOBAN).vector;
  const near = describeImage(flat('#8a4bff'), NOBAN).vector; // same palette bin
  const far = describeImage(flat('#d6c23c'), NOBAN).vector; // different hue entirely
  assert.ok(distance(brand, near) < distance(brand, far));
});

test('centroid is the component-wise mean and rejects ragged input', () => {
  assert.deepEqual(centroid([[0, 2], [2, 4]]), [1, 3]);
  assert.throws(() => centroid([[0, 1], [0]]), /length mismatch/);
  assert.throws(() => centroid([]), /no vectors/);
});

test('scoreSet ranks the outlier first', () => {
  // Four purple siblings and one gold intruder.
  const items = ['#8847ff', '#8847ff', '#8847ff', '#8847ff', '#d6c23c'].map((hex, i) => ({
    id: `a${i}`,
    vector: describeImage(flat(hex), NOBAN).vector,
  }));
  const {scored, trustworthy, n} = scoreSet(items);
  assert.equal(n, 5);
  assert.equal(trustworthy, true);
  assert.equal(scored[0].id, 'a4', 'the gold asset should sort to the top');
  assert.ok(scored[0].driftZ > scored[1].driftZ);
});

test('a uniform set produces zero dispersion and refuses to invent z-scores', () => {
  // Every asset identical: stdev is 0, so "how many stdevs from the mean" has no
  // answer. Reporting 0 would imply "measured, and normal".
  const items = Array.from({length: 6}, (_, i) => ({
    id: `a${i}`,
    vector: describeImage(flat('#8847ff'), NOBAN).vector,
  }));
  const res = scoreSet(items);
  assert.equal(res.stdev, 0);
  assert.equal(res.trustworthy, false);
  assert.ok(res.scored.every((s) => s.driftZ === null));
});

test('a set below MIN_SET reports distances but no z-scores', () => {
  const items = ['#8847ff', '#d6c23c'].map((hex, i) => ({
    id: `a${i}`,
    vector: describeImage(flat(hex), NOBAN).vector,
  }));
  assert.ok(items.length < MIN_SET);
  const res = scoreSet(items);
  assert.equal(res.trustworthy, false);
  assert.ok(res.scored.every((s) => s.driftZ === null));
  assert.ok(res.scored.every((s) => s.distance > 0));
});

test('a reference centroid overrides the set’s own centre', () => {
  const goldRef = centroid([describeImage(flat('#d6c23c'), NOBAN).vector]);
  const items = ['#8847ff', '#8847ff', '#8847ff', '#d6c23c'].map((hex) => ({
    id: hex,
    vector: describeImage(flat(hex), NOBAN).vector,
  }));
  // Against the set's own centre the gold is the outlier; against a gold
  // reference the purples are.
  assert.equal(scoreSet(items).scored[0].id, '#d6c23c');
  assert.equal(scoreSet(items, goldRef).scored[0].id, '#8847ff');
});
