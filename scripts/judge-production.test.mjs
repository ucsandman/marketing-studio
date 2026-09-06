import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {encodePng} from './lib/png.mjs';
import {
  createProductionReview,
  evidenceQuality,
  inventoryPublicSource,
  loadProductionBundle,
  measurePng,
  perceptualReview,
  sha256File,
  sha256Json,
  shotGrammar,
  sourceBundleDigest,
} from './lib/production-quality.mjs';
import {evaluateProduction} from './judge-production.mjs';
import {resolveWorkspace} from './lib/workspace.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'production-quality-'));
const keepFixture = process.env.KEEP_PRODUCTION_FIXTURE === '1';
after(() => { if (!keepFixture) rmSync(tmp, {recursive: true, force: true}); });

function patternedPng(path, black = false) {
  const width = 64;
  const height = 36;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const light = black ? 0 : ((x >> 3) + (y >> 3)) % 2 ? 230 : 24;
    rgba[i] = light;
    rgba[i + 1] = black ? 0 : Math.max(0, light - 40);
    rgba[i + 2] = black ? 0 : Math.min(255, light + 15);
    rgba[i + 3] = 255;
  }
  writeFileSync(path, encodePng(width, height, rgba));
}

const shot = (id, overrides = {}) => ({
  id,
  purpose: 'proof',
  from: 0,
  len: 15,
  durationFrames: 15,
  scale: 'close',
  camera: {cadence: 'locked'},
  transition: {kind: 'cut', frames: 0},
  onScreenText: {maxChars: 42, minHoldFrames: 12},
  readability: {safeArea: true, minContrast: 4.5},
  hero: false,
  endingHoldFrames: 0,
  references: ['ref-1'],
  ...overrides,
});

test('shot grammar permits a restrained locked/cut direction but rejects a structurally invariant timeline', () => {
  const restrained = shotGrammar({shots: [
    shot('a', {purpose: 'establish', scale: 'wide', hero: true}),
    shot('b', {from: 15, purpose: 'proof', scale: 'close', endingHoldFrames: 8}),
  ]});
  assert.equal(restrained.counts.shots, 2);
  assert.equal(restrained.findings.some((item) => item.level === 'FAIL'), false);
  assert.ok(restrained.findings.some((item) => item.category === 'repetition' && item.level === 'WARN'));

  const invariant = shotGrammar({shots: [
    shot('a', {hero: true}),
    shot('b', {from: 15}),
    shot('c', {from: 30, endingHoldFrames: 8}),
  ]});
  assert.ok(invariant.findings.some((item) => item.level === 'FAIL' && /invariant/.test(item.message)));
});

test('render measurements distinguish a patterned frame from a blank black frame', () => {
  const good = join(tmp, 'pattern.png');
  const black = join(tmp, 'black.png');
  patternedPng(good);
  patternedPng(black, true);
  const goodMetrics = measurePng(good);
  const blackMetrics = measurePng(black);
  assert.ok(goodMetrics.edgeOccupancy > 0);
  assert.ok(goodMetrics.contrastSpan > 100);
  assert.equal(blackMetrics.blackFraction, 1);
  assert.equal(blackMetrics.edgeOccupancy, 0);
});

function fixture() {
  const projectRoot = join(tmp, `product-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(projectRoot, '.git'), {recursive: true});
  const workspace = resolveWorkspace(null, {brand: 'acme', project: projectRoot});
  mkdirSync(join(workspace.marketingDir, 'stills'), {recursive: true});
  mkdirSync(workspace.propsDir, {recursive: true});
  mkdirSync(workspace.publicDir, {recursive: true});
  const propsPath = join(workspace.propsDir, 'acme-launch.json');
  writeFileSync(propsPath, JSON.stringify({brandId: 'acme'}));
  patternedPng(join(workspace.publicDir, 'product.png'));
  const renderPath = join(workspace.brandOut, 'launch.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    renderPath,
  ]);
  const stylePath = join(workspace.marketingDir, 'style-frame.png');
  patternedPng(stylePath);
  const stageReview = (artifactPath, name) => {
    const path = join(workspace.marketingDir, `${name}-review.json`);
    writeFileSync(path, JSON.stringify({action: 'approved', artifactSha256: sha256File(artifactPath), reviewer: {name: 'Director D', role: 'director'}}));
    return path;
  };
  const directionPath = join(workspace.marketingDir, 'direction.json');
  const direction = {
    preset: 'precision',
    reason: 'Show the proof without decorative camera movement.',
    references: [{id: 'ref-1', pathOrUrl: 'product://dashboard', intendedAttributes: ['information hierarchy'], provenance: {kind: 'product', source: 'local product capture', capturedAt: null}}],
    styleFrame: {artifact: relative(projectRoot, stylePath), review: relative(projectRoot, stageReview(stylePath, 'style'))},
    animatic: {artifact: relative(projectRoot, renderPath), review: relative(projectRoot, stageReview(renderPath, 'animatic'))},
  };
  writeFileSync(directionPath, JSON.stringify(direction));
  const shotPlanPath = join(workspace.marketingDir, 'shot-plan.json');
  const plan = {version: 1, shots: [shot('a', {purpose: 'establish', scale: 'wide', hero: true}), shot('b', {from: 15, purpose: 'proof', scale: 'close', endingHoldFrames: 8})], total: 30};
  writeFileSync(shotPlanPath, JSON.stringify(plan));
  const publicSource = inventoryPublicSource(projectRoot, relative(projectRoot, workspace.publicDir));
  const directionSha256 = sha256File(directionPath);
  const shotPlanSha256 = sha256File(shotPlanPath);
  const propsSha256 = sha256File(propsPath);
  const sourceBundleSha256 = sourceBundleDigest({directionSha256, shotPlanSha256, propsSha256, publicSha256: publicSource.sha256});
  const productionPlanPath = join(workspace.marketingDir, 'production-plan.json');
  writeFileSync(productionPlanPath, JSON.stringify({version: 1, selectedComposition: 'LaunchVideo', direction: {path: relative(projectRoot, directionPath), sha256: directionSha256}, shotPlan: {path: relative(projectRoot, shotPlanPath), sha256: shotPlanSha256}, sourceBundle: {version: 1, props: {path: relative(projectRoot, propsPath), sha256: propsSha256}, public: publicSource, sha256: sourceBundleSha256}, exports: {launch: {composition: 'LaunchVideo', props: relative(projectRoot, propsPath)}, social: {composition: 'LaunchVideo', props: relative(projectRoot, propsPath)}}}));
  const samples = [];
  for (const planShot of plan.shots) for (const [phase, offset] of [['start', 1], ['middle', 7], ['end', 13]]) {
    const imagePath = join(workspace.marketingDir, 'stills', `${planShot.id}-${phase}.png`);
    patternedPng(imagePath);
    samples.push({shotId: planShot.id, phase, frame: planShot.from + offset, imagePath: relative(projectRoot, imagePath), imageSha256: sha256File(imagePath)});
  }
  const evidencePath = join(workspace.marketingDir, 'production-evidence.json');
  const evidence = {planSha256: sha256File(productionPlanPath), sourceBundleSha256, renderPath: relative(projectRoot, renderPath), renderSha256: sha256File(renderPath), sheetPath: relative(projectRoot, join(workspace.marketingDir, 'stills', 'Production-sheet.html')), shots: 2, sampleCount: 6, samples};
  writeFileSync(evidencePath, JSON.stringify(evidence));
  const reviewPath = join(workspace.marketingDir, 'review.json');
  writeFileSync(reviewPath, JSON.stringify([{type: 'production-visual-review', source: 'mission-control', action: 'approved', at: new Date().toISOString(), reviewer: {name: 'Director D', role: 'director'}, planSha256: evidence.planSha256, sourceBundleSha256: evidence.sourceBundleSha256, renderSha256: evidence.renderSha256, evidenceSha256: sha256Json(evidence), attestations: {watchedFullRender: true, heardAudio: true}, wouldShare: true, scores: {storyClarity: 4, visualHierarchy: 4, motionIntent: 4, productReadability: 4, endingConfidence: 4}, observations: 'The proof reads cleanly and the ending holds.', defects: []}]));
  return {workspace, productionPlanPath, renderPath, evidencePath, reviewPath, evidence, propsPath};
}

test('complete rendered fixture passes with explicit processed counts', () => {
  const f = fixture();
  const report = evaluateProduction({workspace: f.workspace, brand: 'acme', productionPlanPath: f.productionPlanPath, renderPath: f.renderPath, evidencePath: f.evidencePath, reviewPath: f.reviewPath});
  assert.equal(report.verdict, 'PASS', JSON.stringify(report.findings));
  assert.equal(report.input.shots, 2);
  assert.equal(report.input.reviewedFrames, 6);
  assert.equal(report.summary.perceptualReviews, 1);
  assert.equal(report.input.frames, 30);
});

// Hero-inheritance (2026-09-06): a matrix row rendered from the same approved plan and
// source bundle as the hero master inherits the hero's human perceptual review, so long
// as the hero itself has a recorded strict PASS binding it to those same hashes.
test('a matrix row inherits the hero master review when the hero report on disk is a strict PASS for the same plan and bundle', () => {
  const f = fixture();
  const heroReportPath = join(f.workspace.marketingDir, 'judge-production.json');
  const heroReport = evaluateProduction({workspace: f.workspace, brand: 'acme', productionPlanPath: f.productionPlanPath, renderPath: f.renderPath, evidencePath: f.evidencePath, reviewPath: f.reviewPath});
  assert.equal(heroReport.verdict, 'PASS', JSON.stringify(heroReport.findings));
  writeFileSync(heroReportPath, JSON.stringify(heroReport));

  mkdirSync(f.workspace.matrixDir, {recursive: true});
  const rowRenderPath = join(f.workspace.matrixDir, 'row.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
    '-t', '1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    rowRenderPath,
  ]);
  assert.notEqual(sha256File(rowRenderPath), sha256File(f.renderPath));

  const rowEvidencePath = join(f.workspace.marketingDir, 'row-evidence.json');
  writeFileSync(rowEvidencePath, JSON.stringify({...f.evidence, renderSha256: sha256File(rowRenderPath)}));

  // Reuses the hero-bound review.json unchanged: the row never gets its own perceptual pass.
  const rowReport = evaluateProduction({workspace: f.workspace, brand: 'acme', productionPlanPath: f.productionPlanPath, renderPath: rowRenderPath, evidencePath: rowEvidencePath, reviewPath: f.reviewPath});
  assert.equal(rowReport.verdict, 'PASS', JSON.stringify(rowReport.findings));
  assert.deepEqual(rowReport.perceptual.inherited, {
    inherited: true,
    from: heroReport.input.renderSha256,
    heroReport: relative(f.workspace.projectRoot, heroReportPath).replaceAll('\\', '/'),
  });

  // Judging the hero itself never treats its own report as a foreign hero to inherit from.
  const rejudgedHero = evaluateProduction({workspace: f.workspace, brand: 'acme', productionPlanPath: f.productionPlanPath, renderPath: f.renderPath, evidencePath: f.evidencePath, reviewPath: f.reviewPath});
  assert.equal(rejudgedHero.verdict, 'PASS');
  assert.equal(rejudgedHero.perceptual.inherited, null);
});

const hash = (label) => sha256Json({label});

test('perceptualReview inherits an approved hero review when plan and source bundle match and the hero report is a strict PASS', () => {
  const planSha256 = hash('plan');
  const sourceBundleSha256 = hash('bundle');
  const heroRenderSha256 = hash('hero-render');
  const review = {
    type: 'production-visual-review', source: 'mission-control', action: 'approved',
    reviewer: {name: 'Director D', role: 'director'},
    planSha256, sourceBundleSha256, renderSha256: heroRenderSha256, evidenceSha256: hash('hero-evidence'),
    attestations: {watchedFullRender: true, heardAudio: true}, wouldShare: true, scores: {}, defects: [],
  };
  const expected = {
    planSha256, sourceBundleSha256, renderSha256: hash('row-render'), evidenceSha256: hash('row-evidence'),
    hero: {renderSha256: heroRenderSha256, planSha256, sourceBundleSha256, verdict: 'PASS', path: 'marketing/assets/acme/marketing/judge-production.json'},
  };
  const result = perceptualReview([review], expected);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.inherited, {inherited: true, from: heroRenderSha256, heroReport: expected.hero.path});
});

test('perceptualReview refuses to inherit when the row plan hash differs from the hero-bound review', () => {
  const sourceBundleSha256 = hash('bundle');
  const heroRenderSha256 = hash('hero-render');
  const review = {
    type: 'production-visual-review', source: 'mission-control', action: 'approved',
    reviewer: {name: 'Director D', role: 'director'},
    planSha256: hash('hero-plan'), sourceBundleSha256, renderSha256: heroRenderSha256, evidenceSha256: hash('hero-evidence'),
    attestations: {watchedFullRender: true, heardAudio: true}, wouldShare: true, scores: {}, defects: [],
  };
  const expected = {
    planSha256: hash('row-plan'), sourceBundleSha256, renderSha256: hash('row-render'), evidenceSha256: hash('row-evidence'),
    hero: {renderSha256: heroRenderSha256, planSha256: hash('hero-plan'), sourceBundleSha256, verdict: 'PASS', path: 'marketing/assets/acme/marketing/judge-production.json'},
  };
  const result = perceptualReview([review], expected);
  assert.equal(result.inherited, null);
  assert.ok(result.findings.some((item) => item.level === 'INCOMPLETE' && /stale source, render, or sample evidence/.test(item.message)));
});

test('perceptualReview refuses to inherit when the hero report verdict is not PASS', () => {
  const planSha256 = hash('plan');
  const sourceBundleSha256 = hash('bundle');
  const heroRenderSha256 = hash('hero-render');
  const review = {
    type: 'production-visual-review', source: 'mission-control', action: 'approved',
    reviewer: {name: 'Director D', role: 'director'},
    planSha256, sourceBundleSha256, renderSha256: heroRenderSha256, evidenceSha256: hash('hero-evidence'),
    attestations: {watchedFullRender: true, heardAudio: true}, wouldShare: true, scores: {}, defects: [],
  };
  const expected = {
    planSha256, sourceBundleSha256, renderSha256: hash('row-render'), evidenceSha256: hash('row-evidence'),
    hero: {renderSha256: heroRenderSha256, planSha256, sourceBundleSha256, verdict: 'INCOMPLETE', path: 'marketing/assets/acme/marketing/judge-production.json'},
  };
  const result = perceptualReview([review], expected);
  assert.equal(result.inherited, null);
  assert.ok(result.findings.some((item) => item.level === 'INCOMPLETE' && /stale source, render, or sample evidence/.test(item.message)));
});

test('perceptualReview still passes a review directly bound to the row itself even when an unrelated hero report is present', () => {
  const planSha256 = hash('plan');
  const sourceBundleSha256 = hash('bundle');
  const renderSha256 = hash('row-render');
  const evidenceSha256 = hash('row-evidence');
  const review = {
    type: 'production-visual-review', source: 'mission-control', action: 'approved',
    reviewer: {name: 'Director D', role: 'director'},
    planSha256, sourceBundleSha256, renderSha256, evidenceSha256,
    attestations: {watchedFullRender: true, heardAudio: true}, wouldShare: true, scores: {}, defects: [],
  };
  const expected = {
    planSha256, sourceBundleSha256, renderSha256, evidenceSha256,
    hero: {renderSha256: hash('unrelated-hero-render'), planSha256, sourceBundleSha256, verdict: 'PASS', path: 'marketing/assets/acme/marketing/judge-production.json'},
  };
  const result = perceptualReview([review], expected);
  assert.deepEqual(result.findings, []);
  assert.equal(result.inherited, null);
});

test('a row with no review and no hero report still reports INCOMPLETE', () => {
  const result = perceptualReview([], {planSha256: hash('plan'), sourceBundleSha256: hash('bundle'), renderSha256: hash('row-render'), evidenceSha256: hash('row-evidence')});
  assert.equal(result.review, null);
  assert.ok(result.findings.some((item) => item.level === 'INCOMPLETE' && /No structured perceptual review/.test(item.message)));
});

test('a hand-authored or arbitrary-role perceptual score cannot pass', () => {
  const expected = {planSha256: 'a', sourceBundleSha256: 's', renderSha256: 'b', evidenceSha256: 'c'};
  const base = {
    type: 'production-visual-review', action: 'approved', reviewer: {name: 'Pat', role: 'producer'},
    ...expected, attestations: {watchedFullRender: true, heardAudio: true}, wouldShare: true,
    scores: {storyClarity: 4, visualHierarchy: 4, motionIntent: 4, productReadability: 4, endingConfidence: 4},
    defects: [],
  };
  const result = perceptualReview([base], expected);
  assert.ok(result.findings.some((item) => /Mission Control/.test(item.message)));
  assert.ok(result.findings.some((item) => /trusted local director/.test(item.message)));
  // observations is no longer required by perceptualReview (one-click contract change, 2026-09-06).
});

// One-click contract (2026-09-06 redesign): reviewer identity plus a single approve click,
// with no note, scores, or checkboxes, is a complete and passing review.
test('a one-click approval with only reviewer identity and action is accepted and satisfies perceptualReview', () => {
  const evidence = {
    planSha256: 'a'.repeat(64), renderSha256: 'b'.repeat(64), sourceBundleSha256: 'c'.repeat(64),
    samples: [{shotId: 'a'}, {shotId: 'b'}],
  };
  const minimal = {reviewerName: 'Operator O', reviewerRole: 'operator', action: 'approved'};
  const result = createProductionReview(minimal, evidence);
  assert.equal(result.status, 200);
  const expected = {
    planSha256: evidence.planSha256, renderSha256: evidence.renderSha256,
    sourceBundleSha256: evidence.sourceBundleSha256, evidenceSha256: sha256Json(evidence),
  };
  const {findings} = perceptualReview([result.entry], expected);
  assert.deepEqual(findings, []);
});

test('production sources require recorded hashes and fail when props or staged media changes', () => {
  const missing = fixture();
  const manifest = JSON.parse(readFileSync(missing.productionPlanPath, 'utf8'));
  delete manifest.direction.sha256;
  writeFileSync(missing.productionPlanPath, JSON.stringify(manifest));
  const incomplete = loadProductionBundle(missing.workspace.projectRoot, 'acme', missing.productionPlanPath);
  assert.ok(incomplete.findings.some((item) => item.level === 'INCOMPLETE' && /Direction source has no valid recorded/.test(item.message)));

  const stale = fixture();
  writeFileSync(stale.propsPath, JSON.stringify({brandId: 'changed'}));
  patternedPng(join(stale.workspace.publicDir, 'added.png'));
  const failed = loadProductionBundle(stale.workspace.projectRoot, 'acme', stale.productionPlanPath);
  assert.ok(failed.findings.some((item) => item.level === 'FAIL' && /Props hash/.test(item.message)));
  assert.ok(failed.findings.some((item) => item.level === 'FAIL' && /Public source inventory is stale/.test(item.message)));
});

test('production routes cannot bypass the hashed props source', () => {
  const f = fixture();
  const alternateProps = join(f.workspace.propsDir, 'alternate.json');
  writeFileSync(alternateProps, JSON.stringify({brandId: 'acme', alternate: true}));
  const manifest = JSON.parse(readFileSync(f.productionPlanPath, 'utf8'));
  manifest.exports.social.props = relative(f.workspace.projectRoot, alternateProps);
  manifest.exports.launch.captioned = {props: relative(f.workspace.projectRoot, alternateProps)};
  writeFileSync(f.productionPlanPath, JSON.stringify(manifest));

  const result = loadProductionBundle(f.workspace.projectRoot, 'acme', f.productionPlanPath);
  assert.ok(result.findings.some((item) => item.level === 'FAIL' && /exports\.social\.props/.test(item.message)));
  assert.ok(result.findings.some((item) => item.level === 'FAIL' && /exports\.launch\.captioned\.props/.test(item.message)));
});

test('an internally consistent source bundle cannot inventory a narrower public root', () => {
  const f = fixture();
  const narrowRoot = join(f.workspace.brandRoot, 'narrow-public');
  mkdirSync(narrowRoot, {recursive: true});
  patternedPng(join(narrowRoot, 'product.png'));
  const manifest = JSON.parse(readFileSync(f.productionPlanPath, 'utf8'));
  const narrow = inventoryPublicSource(f.workspace.projectRoot, relative(f.workspace.projectRoot, narrowRoot));
  manifest.sourceBundle.public = narrow;
  manifest.sourceBundle.sha256 = sourceBundleDigest({
    directionSha256: manifest.direction.sha256,
    shotPlanSha256: manifest.shotPlan.sha256,
    propsSha256: manifest.sourceBundle.props.sha256,
    publicSha256: narrow.sha256,
  });
  writeFileSync(f.productionPlanPath, JSON.stringify(manifest));

  const result = loadProductionBundle(f.workspace.projectRoot, 'acme', f.productionPlanPath);
  assert.ok(result.findings.some((item) => item.level === 'FAIL' && /must match the product workspace publicDir/.test(item.message)));
  assert.equal(result.findings.some((item) => /inventory is stale/.test(item.message)), false);
});

test('approval requires every score at 4 or above and no major defects', () => {
  const evidence = {planSha256: 'a', sourceBundleSha256: 's', renderSha256: 'b', samples: [{shotId: 'a'}]};
  const base = {reviewerName: 'Director D', reviewerRole: 'director', action: 'approved', observations: 'Reviewed.', watchedFullRender: true, heardAudio: true, wouldShare: true, scores: {storyClarity: 4, visualHierarchy: 4, motionIntent: 4, productReadability: 4, endingConfidence: 4}};
  assert.equal(createProductionReview({...base, scores: {...base.scores, motionIntent: 3}}, evidence).status, 400);
  assert.equal(createProductionReview({...base, defects: [{severity: 'major', description: 'Clipped total'}]}, evidence).status, 400);
});

test('blank and wrong-hash rendered samples fail closed with the full sample count visible', () => {
  const f = fixture();
  const first = f.evidence.samples[0];
  patternedPng(join(f.workspace.projectRoot, first.imagePath), true);
  first.imageSha256 = sha256File(join(f.workspace.projectRoot, first.imagePath));
  f.evidence.samples[1].imageSha256 = '0'.repeat(64);
  const result = evidenceQuality(f.evidence, {planSha256: f.evidence.planSha256, sourceBundleSha256: f.evidence.sourceBundleSha256, renderSha256: f.evidence.renderSha256, shotIds: ['a', 'b'], root: f.workspace.projectRoot});
  assert.equal(result.samples.length, 6);
  assert.ok(result.findings.some((item) => item.level === 'FAIL' && /black/.test(item.message)));
  assert.ok(result.findings.some((item) => item.level === 'INCOMPLETE' && /hash-stale/.test(item.message)));
});

test('CLI refuses to run without an explicit product workspace', () => {
  const run = spawnSync(process.execPath, ['scripts/judge-production.mjs', 'acme', '--strict'], {encoding: 'utf8'});
  assert.equal(run.status, 1);
  assert.match(run.stderr, /requires --project/);
});

test('optional operational UI fixture', {skip: !keepFixture}, () => {
  const f = fixture();
  writeFileSync(join(f.workspace.marketingDir, 'run.json'), JSON.stringify({brand: 'acme', startedAt: '2026-09-05T20:00:00.000Z', assets: [{id: 'launch-video', skill: '/launch-video', status: 'rendered', output: 'launch.mp4'}]}, null, 2));
  writeFileSync(join(f.workspace.marketingDir, 'stills', 'Production-sheet.html'), '<!doctype html><title>Production evidence</title><h1>Production evidence</h1><p>2 shots, 6 rendered samples</p>');
  console.log(`UI_FIXTURE=${f.workspace.projectRoot}`);
});
