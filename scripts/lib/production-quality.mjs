import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {decodePng, meanAbsDelta, quantize} from './png.mjs';
import {resolveWorkspacePath} from './workspace.mjs';

export const REVIEW_SCORE_KEYS = [
  'storyClarity',
  'visualHierarchy',
  'motionIntent',
  'productReadability',
  'endingConfidence',
];

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const validSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const portable = (path) => path.replaceAll('\\', '/');
const samePath = (left, right) =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;

export function inventoryPublicSource(projectRoot, publicRoot) {
  const root = resolveInside(projectRoot, publicRoot);
  if (!root || !existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error('Public source root is missing, not a directory, or outside the product repository.');
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) {
        throw new Error(`Public source inventory does not allow symbolic links: ${portable(relative(projectRoot, path))}`);
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({path: portable(relative(projectRoot, path)), bytes: statSync(path).size, sha256: sha256File(path)});
    }
  };
  visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {root: portable(relative(projectRoot, root)), files, sha256: sha256Json(files)};
}

export function sourceBundleDigest({directionSha256, shotPlanSha256, propsSha256, publicSha256}) {
  return sha256Json({version: 1, directionSha256, shotPlanSha256, propsSha256, publicSha256});
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sourceRecord(manifest, key, fallback) {
  const dashed = key === 'shotPlan' ? 'shot-plan' : key;
  const value = manifest?.[key] ?? manifest?.sources?.[key] ?? manifest?.inputs?.[key];
  const rawPath = manifest?.[`${key}Path`] ?? value?.path ?? value?.file ?? (typeof value === 'string' ? value : null) ?? fallback;
  const recordedSha256 = manifest?.[`${key}Sha256`] ?? value?.sha256 ?? manifest?.hashes?.[key] ?? manifest?.hashes?.[dashed] ?? null;
  return {rawPath, recordedSha256};
}

export function loadProductionBundle(root, brand, manifestPath, defaults = {}) {
  const findings = [];
  const resolvedManifest = resolveInside(root, manifestPath);
  if (!resolvedManifest || !existsSync(resolvedManifest)) {
    return {findings: [finding('INCOMPLETE', 'source', 'production-plan.json is missing or outside the repository.')]};
  }
  let manifest;
  try {
    manifest = readJson(resolvedManifest);
  } catch (err) {
    return {findings: [finding('FAIL', 'source', `Production plan is unreadable: ${err.message}`)]};
  }
  const productionPlanSha256 = sha256File(resolvedManifest);
  if (manifest?.version !== 1) findings.push(finding('FAIL', 'source', 'Production plan must declare version 1.'));
  if (typeof manifest?.selectedComposition !== 'string' || !manifest.selectedComposition.trim()) {
    findings.push(finding('FAIL', 'source', 'Production plan has no selectedComposition.'));
  }
  const launchRoute = manifest?.exports?.launch;
  if (!launchRoute || typeof launchRoute.composition !== 'string' || !launchRoute.composition.trim()) {
    findings.push(finding('FAIL', 'source', 'Production plan has no explicit exports.launch composition.'));
  } else if (launchRoute.composition !== manifest.selectedComposition) {
    findings.push(finding('FAIL', 'source', 'Production plan selectedComposition does not match exports.launch.composition.'));
  }
  const directionRef = sourceRecord(manifest, 'direction', defaults.directionPath ?? `marketing/assets/${brand}/marketing/direction.json`);
  const shotPlanRef = sourceRecord(manifest, 'shotPlan', defaults.shotPlanPath ?? `marketing/assets/${brand}/marketing/shot-plan.json`);
  const loadSource = (label, ref) => {
    const path = resolveInside(root, ref.rawPath);
    if (!path || !existsSync(path)) {
      findings.push(finding('INCOMPLETE', 'source', `${label} source is missing or outside the repository.`));
      return null;
    }
    try {
      const sha256 = sha256File(path);
      if (!validSha256(ref.recordedSha256)) findings.push(finding('INCOMPLETE', 'source', `${label} source has no valid recorded SHA-256 hash.`));
      else if (ref.recordedSha256 !== sha256) findings.push(finding('FAIL', 'source', `${label} hash in production plan is stale.`));
      return {path, sha256, value: readJson(path)};
    } catch (err) {
      findings.push(finding('FAIL', 'source', `${label} source is unreadable: ${err.message}`));
      return null;
    }
  };
  const direction = loadSource('Direction', directionRef);
  const shotPlan = loadSource('Shot plan', shotPlanRef);
  const propsRef = manifest?.sourceBundle?.props ?? {path: launchRoute?.props ?? manifest?.props, sha256: null};
  const props = loadSource('Props', {rawPath: propsRef.path, recordedSha256: propsRef.sha256});
  if (props) {
    const routeProps = [];
    if (typeof manifest?.props === 'string') routeProps.push(['props', manifest.props]);
    for (const [family, route] of Object.entries(manifest?.exports ?? {})) {
      if (!route || typeof route !== 'object') continue;
      if (typeof route.props === 'string') routeProps.push([`exports.${family}.props`, route.props]);
      if (route.captioned && typeof route.captioned === 'object') {
        routeProps.push([`exports.${family}.captioned.props`, route.captioned.props ?? route.props]);
      }
    }
    for (const [label, rawPath] of routeProps) {
      const path = resolveInside(root, rawPath);
      if (!path || !samePath(path, props.path)) {
        findings.push(finding('FAIL', 'source', `Production plan ${label} must use the hashed sourceBundle.props path.`));
      }
    }
  }
  const publicRef = manifest?.sourceBundle?.public;
  let publicInventory = null;
  if (!publicRef || !text(publicRef.root) || !Array.isArray(publicRef.files) || !validSha256(publicRef.sha256)) {
    findings.push(finding('INCOMPLETE', 'source', 'Public source inventory is missing or has no valid recorded SHA-256 hash.'));
  } else {
    try {
      const expectedPublicRoot = resolveInside(root, defaults.publicDir ?? `marketing/assets/${brand}/public`);
      const declaredPublicRoot = resolveInside(root, publicRef.root);
      if (!expectedPublicRoot || !declaredPublicRoot || !samePath(expectedPublicRoot, declaredPublicRoot)) {
        findings.push(finding('FAIL', 'source', 'Public source inventory root must match the product workspace publicDir.'));
      }
      const current = inventoryPublicSource(root, publicRef.root);
      publicInventory = current;
      if (current.sha256 !== publicRef.sha256 || JSON.stringify(current.files) !== JSON.stringify(publicRef.files)) {
        findings.push(finding('FAIL', 'source', 'Public source inventory is stale; staged media was added, removed, or changed.'));
      }
    } catch (err) {
      findings.push(finding('FAIL', 'source', `Public source inventory cannot be verified: ${err.message}`));
    }
  }
  const recordedBundleSha256 = manifest?.sourceBundle?.sha256;
  let sourceBundleSha256 = null;
  if (!validSha256(recordedBundleSha256)) {
    findings.push(finding('INCOMPLETE', 'source', 'Source bundle has no valid recorded SHA-256 hash.'));
  } else if (direction && shotPlan && props && publicInventory) {
    sourceBundleSha256 = sourceBundleDigest({
      directionSha256: direction.sha256,
      shotPlanSha256: shotPlan.sha256,
      propsSha256: props.sha256,
      publicSha256: publicInventory.sha256,
    });
    if (sourceBundleSha256 !== recordedBundleSha256) findings.push(finding('FAIL', 'source', 'Source bundle hash in production plan is stale.'));
  }
  return {manifestPath: resolvedManifest, manifest, productionPlanSha256, direction, shotPlan, props, publicInventory, sourceBundleSha256, findings};
}

export function resolveInside(root, raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return resolveWorkspacePath({projectRoot: resolve(root)}, raw);
  } catch {
    return null;
  }
}

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const finitePositive = (value) => Number.isFinite(value) && value > 0;

function finding(level, category, message, extra = {}) {
  return {level, category, message, ...extra};
}

export function shotGrammar(plan) {
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  const findings = [];
  const seen = new Set();
  const counts = {shots: shots.length, purposes: 0, scales: 0, cameras: 0, transitions: 0, readable: 0, heroes: 0};
  const values = {purpose: [], scale: [], camera: [], transition: [], duration: []};

  if (!shots.length) findings.push(finding('INCOMPLETE', 'plan', 'Shot plan contains 0 shots.'));
  for (const [index, shot] of shots.entries()) {
    const id = text(shot?.id) ? shot.id : `shot-${index + 1}`;
    if (!text(shot?.id)) findings.push(finding('FAIL', 'plan', `Shot ${index + 1} has no stable id.`, {shotId: id}));
    else if (seen.has(id)) findings.push(finding('FAIL', 'plan', `Duplicate shot id "${id}".`, {shotId: id}));
    seen.add(id);

    const duration = shot?.durationFrames ?? shot?.len;
    if (!finitePositive(duration)) findings.push(finding('FAIL', 'duration', `${id} has no positive duration.`, {shotId: id}));
    else values.duration.push(duration);
    if (!text(shot?.purpose)) findings.push(finding('FAIL', 'purpose', `${id} has no stated purpose.`, {shotId: id}));
    else values.purpose.push(shot.purpose);
    if (!text(shot?.scale)) findings.push(finding('FAIL', 'scale', `${id} has no shot scale.`, {shotId: id}));
    else values.scale.push(shot.scale);
    if (!text(shot?.camera?.cadence)) findings.push(finding('FAIL', 'camera', `${id} has no camera cadence.`, {shotId: id}));
    else values.camera.push(shot.camera.cadence);
    if (!text(shot?.transition?.kind)) findings.push(finding('FAIL', 'transition', `${id} has no transition grammar.`, {shotId: id}));
    else values.transition.push(shot.transition.kind);

    const copy = shot?.onScreenText;
    const readability = shot?.readability;
    if (!copy || !Number.isFinite(copy.maxChars) || !finitePositive(copy.minHoldFrames)) {
      findings.push(finding('FAIL', 'readability', `${id} lacks measurable on-screen text limits.`, {shotId: id}));
    } else if (!readability || typeof readability.safeArea !== 'boolean' || !finitePositive(readability.minContrast)) {
      findings.push(finding('FAIL', 'readability', `${id} lacks safe-area or contrast intent.`, {shotId: id}));
    } else counts.readable++;
    if (shot?.hero === true) counts.heroes++;
  }

  for (const key of Object.keys(values)) counts[`${key}s`] = new Set(values[key]).size;
  if (shots.length > 1) {
    for (const [key, list] of Object.entries(values)) {
      if (list.length === shots.length && new Set(list).size === 1) {
        findings.push(finding('WARN', 'repetition', `Every shot repeats the same ${key} (${list[0]}). This is a perceptual review trigger, not an empirical quality threshold.`));
      }
      for (let i = 2; i < list.length; i++) {
        if (list[i] === list[i - 1] && list[i] === list[i - 2]) {
          findings.push(finding('WARN', 'repetition', `Three consecutive shots repeat ${key} (${list[i]}). Review the run perceptually.`, {shotId: shots[i]?.id}));
          break;
        }
      }
    }
    if (shots.length >= 3 && counts.purposes === 1 && counts.scales === 1 && counts.durations === 1) {
      findings.push(finding('FAIL', 'repetition', 'Purpose, scale, and duration are all invariant across the plan; the timeline has no measurable shot grammar variation.'));
    }
  }
  if (shots.length && counts.heroes < 1) findings.push(finding('FAIL', 'hero', 'Shot plan contains no designated hero shot.'));
  const ending = shots.at(-1);
  if (ending && !finitePositive(ending.endingHoldFrames)) {
    findings.push(finding('FAIL', 'ending', `${ending.id ?? 'Final shot'} has no positive ending hold.`, {shotId: ending.id}));
  }
  return {shots, counts, findings};
}

export function referenceQuality(direction, shots) {
  const references = Array.isArray(direction?.references) ? direction.references : [];
  const findings = [];
  const ids = new Set();
  if (!references.length) findings.push(finding('INCOMPLETE', 'references', 'Direction contains 0 references.'));
  for (const [i, ref] of references.entries()) {
    const id = text(ref?.id) ? ref.id : `reference-${i + 1}`;
    if (!text(ref?.id)) findings.push(finding('FAIL', 'references', `${id} has no id.`));
    if (ids.has(ref?.id)) findings.push(finding('FAIL', 'references', `Duplicate reference id "${ref?.id}".`));
    ids.add(ref?.id);
    if (!text(ref?.pathOrUrl)) findings.push(finding('FAIL', 'references', `${id} has no source path or URL.`));
    const attrs = ref?.intendedAttributes ?? ref?.attributes;
    if (!Array.isArray(attrs) || !attrs.some(text)) findings.push(finding('FAIL', 'references', `${id} has no intended attributes.`));
    if (!['capture', 'product', 'brand', 'reference', 'generated'].includes(ref?.provenance?.kind) || !text(ref?.provenance?.source)) {
      findings.push(finding('FAIL', 'references', `${id} has no provenance.`));
    }
  }
  for (const shot of shots) {
    for (const refId of Array.isArray(shot?.references) ? shot.references : []) {
      const key = typeof refId === 'string' ? refId : refId?.id;
      if (!ids.has(key)) findings.push(finding('FAIL', 'references', `${shot.id} cites unknown reference "${key}".`, {shotId: shot.id}));
    }
  }
  return {references, findings};
}

export function artifactApproval(name, artifact, root) {
  const findings = [];
  if (!artifact || typeof artifact !== 'object') return {findings: [finding('INCOMPLETE', name, `${name} evidence is missing.`)]};
  const rawPath = artifact.path ?? artifact.artifactPath ?? artifact.file ?? artifact.artifact;
  const path = resolveInside(root, rawPath);
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    findings.push(finding('INCOMPLETE', name, `${name} artifact is missing or outside the repository.`));
    return {findings};
  }
  const hash = sha256File(path);
  let review = typeof artifact.review === 'object' ? artifact.review : null;
  if (typeof artifact.review === 'string') {
    const reviewPath = resolveInside(root, artifact.review);
    if (!reviewPath || !existsSync(reviewPath)) {
      findings.push(finding('INCOMPLETE', name, `${name} review record is missing or outside the repository.`));
    } else {
      try {
        review = readJson(reviewPath);
      } catch (err) {
        findings.push(finding('INCOMPLETE', name, `${name} review record is unreadable: ${err.message}`));
      }
    }
  }
  const approved = review?.approved === true || review?.action === 'approved' || review?.verdict === 'PASS';
  const recordedHash = artifact.sha256 ?? review?.artifactSha256 ?? review?.sha256;
  if (!approved) findings.push(finding('INCOMPLETE', name, `${name} is not explicitly approved.`));
  if (!text(review?.reviewer?.name) || !['director', 'operator', 'independent'].includes(review?.reviewer?.role)) {
    findings.push(finding('INCOMPLETE', name, `${name} approval requires a named director, operator, or independent reviewer.`));
  }
  if (!recordedHash || recordedHash !== hash) findings.push(finding('INCOMPLETE', name, `${name} approval is not bound to the current artifact hash.`));
  return {path, hash, bytes: statSync(path).size, review, findings};
}

export function evidenceQuality(evidence, {planSha256, renderSha256, sourceBundleSha256, shotIds, root}) {
  const findings = [];
  const samples = Array.isArray(evidence?.samples) ? evidence.samples : [];
  if (evidence?.planSha256 !== planSha256) findings.push(finding('INCOMPLETE', 'evidence', 'Evidence plan hash is missing or stale.'));
  if (evidence?.renderSha256 !== renderSha256) findings.push(finding('INCOMPLETE', 'evidence', 'Evidence render hash is missing or stale.'));
  if (evidence?.sourceBundleSha256 !== sourceBundleSha256) findings.push(finding('INCOMPLETE', 'evidence', 'Evidence source-bundle hash is missing or stale.'));
  const byShot = new Map(shotIds.map((id) => [id, new Set()]));
  const measured = [];
  for (const sample of samples) {
    const phases = byShot.get(sample?.shotId);
    if (!phases) {
      findings.push(finding('FAIL', 'evidence', `Evidence cites unknown shot "${sample?.shotId}".`));
      continue;
    }
    const path = resolveInside(root, sample.imagePath);
    if (!path || !existsSync(path) || sha256File(path) !== sample.imageSha256) {
      findings.push(finding('INCOMPLETE', 'evidence', `Sample ${sample.shotId}/${sample.phase ?? '?'} is missing or hash-stale.`, {shotId: sample.shotId}));
      continue;
    }
    phases.add(sample.phase);
    try {
      measured.push({...sample, path, metrics: measurePng(path)});
    } catch (err) {
      findings.push(finding('FAIL', 'evidence', `Sample ${sample.shotId}/${sample.phase ?? '?'} is not a readable PNG: ${err.message}`, {shotId: sample.shotId}));
    }
  }
  for (const [shotId, phases] of byShot) {
    for (const phase of ['start', 'middle', 'end']) {
      if (!phases.has(phase)) findings.push(finding('INCOMPLETE', 'evidence', `${shotId} lacks a rendered ${phase} motion sample.`, {shotId}));
    }
  }
  for (const sample of measured) {
    if (sample.metrics.blackFraction >= 0.985) {
      findings.push(finding('FAIL', 'render-integrity', `${sample.shotId}/${sample.phase} is effectively black (${(sample.metrics.blackFraction * 100).toFixed(1)}% near-black pixels).`, {shotId: sample.shotId, frame: sample.frame}));
    } else if (sample.metrics.lumaStdDev < 0.5 && sample.metrics.edgeOccupancy < 0.001) {
      findings.push(finding('FAIL', 'render-integrity', `${sample.shotId}/${sample.phase} is effectively blank (flat luminance and no edges).`, {shotId: sample.shotId, frame: sample.frame}));
    } else if (sample.metrics.contrastSpan < 12 || sample.metrics.edgeOccupancy < 0.002) {
      findings.push(finding('WARN', 'render-measurement', `${sample.shotId}/${sample.phase} has unusually low measured contrast or edge occupancy; perceptual review must decide whether it is intentional.`, {shotId: sample.shotId, frame: sample.frame}));
    }
  }
  const motion = [];
  for (const shotId of shotIds) {
    const shotSamples = measured.filter((s) => s.shotId === shotId);
    const start = shotSamples.find((s) => s.phase === 'start');
    const end = shotSamples.find((s) => s.phase === 'end');
    if (!start || !end) continue;
    try {
      const delta = meanAbsDelta(decodePng(readFileSync(start.path)), decodePng(readFileSync(end.path)));
      motion.push({shotId, startFrame: start.frame, endFrame: end.frame, meanAbsDelta: Number(delta.toFixed(4))});
      if (delta < 0.35) findings.push(finding('WARN', 'motion-measurement', `${shotId} start/end samples are nearly identical (${delta.toFixed(3)} mean RGB delta).`, {shotId}));
    } catch (err) {
      findings.push(finding('FAIL', 'motion-measurement', `${shotId} motion sample comparison failed: ${err.message}`, {shotId}));
    }
  }
  return {samples, measured, motion, evidenceSha256: evidence ? sha256Json(evidence) : null, findings};
}

export function measurePng(path) {
  const image = decodePng(readFileSync(path));
  const lumas = [];
  let sum = 0;
  let sumSq = 0;
  let black = 0;
  let edges = 0;
  let comparisons = 0;
  const at = (x, y) => {
    const i = (y * image.width + x) * 4;
    return 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
  };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const luma = at(x, y);
      lumas.push(luma);
      sum += luma;
      sumSq += luma * luma;
      if (luma < 5) black++;
      if (x && Math.abs(luma - at(x - 1, y)) >= 24) edges++;
      if (y && Math.abs(luma - at(x, y - 1)) >= 24) edges++;
      comparisons += (x ? 1 : 0) + (y ? 1 : 0);
    }
  }
  lumas.sort((a, b) => a - b);
  const pixels = lumas.length;
  const mean = pixels ? sum / pixels : 0;
  const p05 = lumas[Math.floor(Math.max(0, pixels - 1) * 0.05)] ?? 0;
  const p95 = lumas[Math.floor(Math.max(0, pixels - 1) * 0.95)] ?? 0;
  return {
    width: image.width,
    height: image.height,
    pixels,
    meanLuma: Number(mean.toFixed(3)),
    lumaStdDev: Number(Math.sqrt(Math.max(0, sumSq / Math.max(1, pixels) - mean * mean)).toFixed(3)),
    contrastSpan: Number((p95 - p05).toFixed(3)),
    blackFraction: Number((black / Math.max(1, pixels)).toFixed(6)),
    edgeOccupancy: Number((edges / Math.max(1, comparisons)).toFixed(6)),
    dominantColorFraction: Number((quantize(image, {bucket: 32}).buckets[0]?.fraction ?? 0).toFixed(6)),
  };
}

export function perceptualReview(entries, expected) {
  const reviews = (Array.isArray(entries) ? entries : []).filter((r) => r?.type === 'production-visual-review');
  const review = reviews.at(-1) ?? null;
  const findings = [];
  if (!review) return {review: null, findings: [finding('INCOMPLETE', 'perceptual-review', 'No structured perceptual review has been recorded in Mission Control.')]};
  if (review.planSha256 !== expected.planSha256 || review.renderSha256 !== expected.renderSha256 || review.sourceBundleSha256 !== expected.sourceBundleSha256 || review.evidenceSha256 !== expected.evidenceSha256) {
    findings.push(finding('INCOMPLETE', 'perceptual-review', 'Latest review is bound to stale source, render, or sample evidence.'));
  }
  if (review?.source !== 'mission-control') findings.push(finding('INCOMPLETE', 'perceptual-review', 'Review was not recorded through Mission Control.'));
  if (!text(review?.reviewer?.name) || !['director', 'operator', 'independent'].includes(review?.reviewer?.role)) findings.push(finding('INCOMPLETE', 'perceptual-review', 'Review requires a named trusted local director, operator, or independent reviewer.'));
  if (!text(review?.observations)) findings.push(finding('INCOMPLETE', 'perceptual-review', 'Review contains no perceptual observations.'));
  if (review?.attestations?.watchedFullRender !== true) findings.push(finding('INCOMPLETE', 'perceptual-review', 'Reviewer did not attest to watching the full render.'));
  if (review?.attestations?.heardAudio !== true) findings.push(finding('INCOMPLETE', 'perceptual-review', 'Reviewer did not attest to hearing the full soundtrack.'));
  if (review?.wouldShare !== true) findings.push(finding('FAIL', 'perceptual-review', 'Reviewer did not answer yes to “would I share this?”.'));
  const missingScores = REVIEW_SCORE_KEYS.filter((key) => !Number.isInteger(review?.scores?.[key]) || review.scores[key] < 1 || review.scores[key] > 5);
  if (missingScores.length) findings.push(finding('INCOMPLETE', 'perceptual-review', `Review is missing 1–5 ratings for: ${missingScores.join(', ')}.`));
  const belowFloor = REVIEW_SCORE_KEYS.filter((key) => Number.isInteger(review?.scores?.[key]) && review.scores[key] < 4);
  if (belowFloor.length) findings.push(finding('FAIL', 'perceptual-review', `Approval requires every quality score to be at least 4/5; below floor: ${belowFloor.join(', ')}.`));
  const defects = Array.isArray(review?.defects) ? review.defects : [];
  if (defects.some((d) => d?.severity === 'blocking' || d?.severity === 'major')) findings.push(finding('FAIL', 'perceptual-review', 'Reviewer recorded one or more major or blocking defects.'));
  if (review.action !== 'approved') findings.push(finding('FAIL', 'perceptual-review', 'Latest perceptual verdict is revise, not approved.'));
  return {review, reviews: reviews.length, defects, findings};
}

export function createProductionReview(payload, evidence, {now = new Date()} = {}) {
  if (!evidence?.planSha256 || !evidence?.renderSha256 || !evidence?.sourceBundleSha256 || !Array.isArray(evidence.samples) || !evidence.samples.length) {
    return {status: 409, body: {error: 'rendered production evidence is missing; generate the contact sheet first'}};
  }
  const name = typeof payload?.reviewerName === 'string' ? payload.reviewerName.trim() : '';
  const role = payload?.reviewerRole;
  if (!name) return {status: 400, body: {error: 'reviewer name is required'}};
  if (!['director', 'operator', 'independent'].includes(role)) {
    return {status: 400, body: {error: 'reviewer role must be director, operator, or independent'}};
  }
  const action = payload?.action;
  if (!['approved', 'revise'].includes(action)) return {status: 400, body: {error: 'action must be approved or revise'}};
  const observations = typeof payload?.observations === 'string' ? payload.observations.trim() : '';
  if (!observations) return {status: 400, body: {error: 'perceptual observations are required'}};
  const scores = {};
  for (const key of REVIEW_SCORE_KEYS) {
    const score = Number(payload?.scores?.[key]);
    if (!Number.isInteger(score) || score < 1 || score > 5) return {status: 400, body: {error: `${key} score must be an integer from 1 to 5`}};
    scores[key] = score;
  }
  if (action === 'approved' && REVIEW_SCORE_KEYS.some((key) => scores[key] < 4)) {
    return {status: 400, body: {error: 'approval requires every quality score to be at least 4/5'}};
  }
  const defects = Array.isArray(payload?.defects)
    ? payload.defects.filter((item) => item && text(item.description)).map((item) => ({
        shotId: text(item.shotId) ? item.shotId : null,
        severity: ['blocking', 'major', 'minor'].includes(item.severity) ? item.severity : 'major',
        category: text(item.category) ? item.category : 'perceptual',
        description: item.description.trim(),
      }))
    : [];
  if (action === 'approved' && defects.some((item) => item.severity === 'blocking' || item.severity === 'major')) {
    return {status: 400, body: {error: 'an approved review cannot contain major or blocking defects'}};
  }
  if (action === 'approved' && (payload.watchedFullRender !== true || payload.heardAudio !== true || payload.wouldShare !== true)) {
    return {status: 400, body: {error: 'approval requires full-render, soundtrack, and would-share attestations'}};
  }
  const entry = {
    type: 'production-visual-review',
    assetId: 'production-film',
    source: 'mission-control',
    action,
    at: now.toISOString(),
    reviewer: {name, role},
    planSha256: evidence.planSha256,
    renderSha256: evidence.renderSha256,
    sourceBundleSha256: evidence.sourceBundleSha256,
    evidenceSha256: sha256Json(evidence),
    evidenceCoverage: {
      shots: new Set(evidence.samples.map((sample) => sample.shotId)).size,
      samples: evidence.samples.length,
      sheetPath: evidence.sheetPath ?? null,
    },
    attestations: {watchedFullRender: payload.watchedFullRender === true, heardAudio: payload.heardAudio === true},
    wouldShare: payload.wouldShare === true,
    scores,
    observations,
    defects,
  };
  return {status: 200, body: {ok: true, action}, entry};
}

export function verdictFor(findings) {
  if (findings.some((f) => f.level === 'FAIL')) return 'FAIL';
  if (findings.some((f) => f.level === 'INCOMPLETE')) return 'INCOMPLETE';
  return 'PASS';
}
