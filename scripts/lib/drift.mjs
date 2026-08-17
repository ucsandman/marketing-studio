// Cross-asset brand-drift descriptors.
//
// Every other judge in this repo scores ONE asset. This scores a SET, because
// the failure it looks for is invisible per asset: 200 individually on-brand
// renders can fragment into three or four visually distinct brands, and a
// per-file gate structurally cannot see that. The unit of judgement here is the
// whole out/<brand>/ directory.
//
// Two complementary numbers per asset, because they fail independently:
//
//   tokenShare  the share of COLOURFUL pixels that sit near one of the brand's
//               own palette tokens. An absolute, interpretable "is this on
//               palette at all" measure. A hero render using an off-brand accent
//               drops here even if every sibling drifted the same way.
//   driftZ      distance from the set's centroid, in standard deviations. A
//               RELATIVE measure: it finds the asset that does not belong with
//               its siblings, whatever the siblings agreed on.
//
// On thresholds: no published number maps an image-distance to "a human would
// call this a different brand" — Chromatic, Playwright, Arize and pHash all
// answer the same way, which is to calibrate against your own labelled data.
// So driftZ deliberately has NO absolute threshold: it is scored against the
// set's own dispersion, and the judge reports the calibration basis (n, mean,
// stdev) alongside every verdict so the number is never quoted bare.
//
// ponytail: histogram descriptors, not learned embeddings. A DINOv2/CLIP
// embedding clusters visual STRUCTURE and would catch layout/composition drift
// this cannot (a correct palette arranged wrongly). That needs a torch runtime
// and a model download; upgrade path is to swap describe() for an embedding
// call and keep centroid/driftZ exactly as they are — the set math is agnostic
// to where the vector came from.
import {colorDistance, quantize, rgbToHsv} from './png.mjs';

// Two resolutions, deliberately, because the two measurements want opposite
// things and sharing one grid breaks the finer of them.
//
// The histogram VECTOR wants coarse bins: an 8x8x8 = 512-bin vector is mostly
// empty for a brand comp, and sparse bins make centroid distance jumpy on small
// sets. So the vector folds down to 4x4x4 = 64 bins.
//
// tokenShare wants FINE bins: measured on the coarse grid, a bucket's reported
// centre colour can sit within TOKEN_RADIUS of a brand token when the actual
// pixels do not. That is not hypothetical — a flat #ff1493 probe against the
// noban palette lands 92 RGB units from its magenta token (correctly off) but
// its 64-wide bucket centre lands 70 units away (wrongly on), so a deliberately
// off-brand asset scored as fully on-palette. tokenShare therefore measures on
// the same 32 grid judge-palette's TOKEN_RADIUS was calibrated against, and the
// coarse vector is FOLDED from it in the same pass.
export const SAMPLE_BUCKET = 32;
export const PALETTE_BUCKET = 64;
export const FOLD = PALETTE_BUCKET / SAMPLE_BUCKET; // 2 sample bins per palette bin per axis
export const PALETTE_BINS = Math.ceil(256 / PALETTE_BUCKET) ** 3; // 64

/** Luminance histogram bins — catches grade/exposure drift that hue misses. */
export const LUMA_BINS = 16;

// Colour identity carries more brand signal than tonal distribution, so the
// palette half of the vector is weighted above the luma half. Both halves are
// individually normalised to sum 1 before weighting, so neither can dominate by
// having more bins.
export const PALETTE_WEIGHT = 0.75;
export const LUMA_WEIGHT = 0.25;

/** Ignore near-grey pixels when measuring token adherence: a neutral background
 * is not evidence either way about a brand's accent discipline. Matches
 * judge-palette's SAT_THRESHOLD so the two judges agree on "colourful". */
export const SAT_THRESHOLD = 0.35;
/** Ignore near-black pixels for the same reason. */
export const MIN_VALUE = 0.15;
/** RGB euclidean radius counted as "sitting on" a brand token. Matches
 * judge-palette's DIST_THRESHOLD so a colour one judge calls on-token the other
 * cannot call off-token. */
export const TOKEN_RADIUS = 90;

/**
 * Feature vector for one decoded image. Size-invariant (histograms, not pixels),
 * so stills of different resolutions are directly comparable.
 *
 * @param img decoded PNG ({width, height, data} RGBA) from png.mjs
 * @param tokens array of {r,g,b} brand palette colours
 * @returns {{vector: number[], tokenShare: number, colourfulFraction: number}}
 */
export function describe(img, tokens) {
  const {buckets, total} = quantize(img, {bucket: SAMPLE_BUCKET});
  const levels = Math.ceil(256 / PALETTE_BUCKET);

  const palette = new Array(PALETTE_BINS).fill(0);
  const luma = new Array(LUMA_BINS).fill(0);
  let colourful = 0;
  let onToken = 0;

  for (const b of buckets) {
    // Fold the fine sample bin down to the coarse palette bin. quantize() maps a
    // channel to floor(v/bucket) and reports the centre q*bucket + bucket/2, so
    // the same floor recovers the fine index; dividing by FOLD collapses each
    // pair of fine bins into one coarse bin.
    const qr = Math.min(levels - 1, Math.floor(Math.floor(b.r / SAMPLE_BUCKET) / FOLD));
    const qg = Math.min(levels - 1, Math.floor(Math.floor(b.g / SAMPLE_BUCKET) / FOLD));
    const qb = Math.min(levels - 1, Math.floor(Math.floor(b.b / SAMPLE_BUCKET) / FOLD));
    palette[(qr * levels + qg) * levels + qb] += b.fraction;

    // Rec. 601 luma — matches how the eye weights the channels, so a green and a
    // blue of equal RGB magnitude do not land in the same tonal bin.
    const y = (0.299 * b.r + 0.587 * b.g + 0.114 * b.b) / 255;
    luma[Math.min(LUMA_BINS - 1, Math.floor(y * LUMA_BINS))] += b.fraction;

    const {s, v} = rgbToHsv(b.r, b.g, b.b);
    if (s >= SAT_THRESHOLD && v >= MIN_VALUE) {
      colourful += b.fraction;
      if (tokens.length > 0 && Math.min(...tokens.map((t) => colorDistance(b, t))) <= TOKEN_RADIUS) {
        onToken += b.fraction;
      }
    }
  }

  const norm = (arr, weight) => {
    const sum = arr.reduce((a, v) => a + v, 0);
    return sum > 0 ? arr.map((v) => (v / sum) * weight) : arr.map(() => 0);
  };

  return {
    vector: [...norm(palette, PALETTE_WEIGHT), ...norm(luma, LUMA_WEIGHT)],
    // An image with no colourful pixels at all (a pure greyscale still) has no
    // opinion about token adherence; report null rather than a misleading 0.
    tokenShare: colourful > 0 ? onToken / colourful : null,
    colourfulFraction: total > 0 ? colourful : 0,
  };
}

/** Component-wise mean of equal-length vectors. */
export function centroid(vectors) {
  if (vectors.length === 0) throw new Error('centroid: no vectors');
  const n = vectors[0].length;
  const out = new Array(n).fill(0);
  for (const v of vectors) {
    if (v.length !== n) throw new Error(`centroid: vector length mismatch ${v.length} vs ${n}`);
    for (let i = 0; i < n; i++) out[i] += v[i];
  }
  return out.map((s) => s / vectors.length);
}

/** Euclidean distance between two equal-length vectors. */
export function distance(a, b) {
  if (a.length !== b.length) throw new Error(`distance: length mismatch ${a.length} vs ${b.length}`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Score a set against its own centre (or against a curated reference centroid).
 *
 * Returns the calibration basis alongside the scores, because a z-score on a
 * tiny set is not trustworthy and the caller has to be able to say so: with
 * n < MIN_SET the dispersion is not meaningful and every z is reported as null.
 *
 * @param items [{id, vector}]
 * @param refCentroid optional centroid to measure against instead of the set's own
 */
export const MIN_SET = 4;

export function scoreSet(items, refCentroid = null) {
  if (items.length === 0) return {centroid: null, mean: 0, stdev: 0, n: 0, scored: []};
  const centre = refCentroid ?? centroid(items.map((i) => i.vector));
  const distances = items.map((i) => distance(i.vector, centre));
  const mean = distances.reduce((a, v) => a + v, 0) / distances.length;
  // Population stdev: this is the whole set, not a sample from a larger one.
  const variance = distances.reduce((a, v) => a + (v - mean) ** 2, 0) / distances.length;
  const stdev = Math.sqrt(variance);
  const trustworthy = items.length >= MIN_SET && stdev > 0;

  const scored = items.map((item, i) => ({
    ...item,
    distance: distances[i],
    driftZ: trustworthy ? (distances[i] - mean) / stdev : null,
  }));
  scored.sort((a, b) => b.distance - a.distance);

  return {centroid: centre, mean, stdev, n: items.length, trustworthy, scored};
}
