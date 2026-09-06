import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import test from 'node:test';
import {createProductionReview, inventoryPublicSource, loadProductionBundle, sha256File, sourceBundleDigest} from './lib/production-quality.mjs';
import {withBoundCaptions} from './lib/matrix-props.mjs';
import {publicationApproval} from './publish-bluesky.mjs';
import {resolveWorkspace} from './lib/workspace.mjs';

const root = join(import.meta.dirname, '..');
const portable = (base, path) => relative(base, path).replaceAll('\\', '/');

function fixture() {
  const project = join(tmpdir(), `matrix-production-${process.pid}-${Date.now()}`);
  mkdirSync(join(project, '.git'), {recursive: true});
  const workspace = resolveWorkspace(root, {brand: 'acme', project});
  mkdirSync(workspace.propsDir, {recursive: true});
  mkdirSync(workspace.publicDir, {recursive: true});
  mkdirSync(workspace.matrixDir, {recursive: true});
  const propsPath = join(workspace.propsDir, 'acme-launch.json');
  writeFileSync(propsPath, '{"brandId":"acme"}\n');
  writeFileSync(join(workspace.publicDir, 'source.txt'), 'bound source');
  const launch = join(workspace.matrixDir, 'launch-16x9.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', launch]);
  copyFileSync(launch, join(workspace.matrixDir, 'social-16x9.mp4'));
  const style = join(workspace.marketingDir, 'style.png');
  mkdirSync(workspace.marketingDir, {recursive: true});
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', launch, '-frames:v', '1', style]);
  const approval = (artifact, name) => {
    const path = join(workspace.marketingDir, `${name}-approval.json`);
    writeFileSync(path, JSON.stringify({action: 'approved', artifactSha256: sha256File(artifact), reviewer: {name: 'Director D', role: 'director'}}));
    return path;
  };
  const directionPath = join(workspace.marketingDir, 'direction.json');
  writeFileSync(directionPath, JSON.stringify({
    preset: 'precision', reason: 'Show the proof clearly.',
    references: [{id: 'ref-1', pathOrUrl: 'product://proof', intendedAttributes: ['hierarchy'], provenance: {kind: 'product', source: 'local capture', capturedAt: null}}],
    styleFrame: {artifact: portable(project, style), review: portable(project, approval(style, 'style'))},
    animatic: {artifact: portable(project, launch), review: portable(project, approval(launch, 'animatic'))},
  }));
  const shotPlanPath = join(workspace.marketingDir, 'shot-plan.json');
  const shot = (id, from, scale, extra = {}) => ({id, from, len: 15, durationFrames: 15, purpose: id, scale, camera: {cadence: 'locked'}, transition: {kind: 'cut', frames: 0}, onScreenText: {maxChars: 30, minHoldFrames: 12}, readability: {safeArea: true, minContrast: 4.5}, references: ['ref-1'], ...extra});
  writeFileSync(shotPlanPath, JSON.stringify({version: 1, fps: 30, total: 30, shots: [shot('establish', 0, 'wide', {hero: true}), shot('proof', 15, 'close', {endingHoldFrames: 8})]}));
  const publicSource = inventoryPublicSource(project, portable(project, workspace.publicDir));
  const directionSha256 = sha256File(directionPath);
  const shotPlanSha256 = sha256File(shotPlanPath);
  const propsSha256 = sha256File(propsPath);
  const sourceSha = sourceBundleDigest({directionSha256, shotPlanSha256, propsSha256, publicSha256: publicSource.sha256});
  const planPath = join(workspace.marketingDir, 'production-plan.json');
  writeFileSync(planPath, JSON.stringify({version: 1, selectedComposition: 'LaunchVideo', direction: {path: portable(project, directionPath), sha256: directionSha256}, shotPlan: {path: portable(project, shotPlanPath), sha256: shotPlanSha256}, sourceBundle: {version: 1, props: {path: portable(project, propsPath), sha256: propsSha256}, public: publicSource, sha256: sourceSha}, exports: {launch: {composition: 'LaunchVideo', props: portable(project, propsPath)}, social: {composition: 'SocialClip', props: portable(project, propsPath)}}}));
  return {project, workspace, planPath, propsPath};
}

function run(project, id) {
  return spawnSync(process.execPath, [join(root, 'scripts', 'render-matrix.mjs'), 'acme', '--project', project, '--production', '--verify-production', '--only', id], {cwd: root, encoding: 'utf8'});
}

function approve(workspace) {
  const evidence = JSON.parse(readFileSync(join(workspace.marketingDir, 'production-evidence.json'), 'utf8'));
  const result = createProductionReview({action: 'approved', reviewerName: 'Director D', reviewerRole: 'director', observations: 'The proof reads cleanly.', watchedFullRender: true, heardAudio: true, wouldShare: true, scores: {storyClarity: 4, visualHierarchy: 4, motionIntent: 4, productReadability: 4, endingConfidence: 4}, defects: []}, evidence);
  assert.equal(result.status, 200);
  writeFileSync(join(workspace.marketingDir, 'review.json'), JSON.stringify([result.entry]));
}

test('verification preserves current row samples and earlier row artifacts', () => {
  const f = fixture();
  try {
    const first = run(f.project, 'launch-16x9');
    assert.equal(first.status, 1);
    assert.match(first.stderr, /production judge rejected/);
    const launchEvidence = join(f.workspace.marketingDir, 'production-reports', 'launch-16x9', 'evidence.json');
    const evidenceHash = sha256File(launchEvidence);
    const evidenceTime = statSync(launchEvidence).mtimeMs;
    approve(f.workspace);
    const verified = run(f.project, 'launch-16x9');
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(sha256File(launchEvidence), evidenceHash);
    assert.equal(statSync(launchEvidence).mtimeMs, evidenceTime);
    const prior = ['evidence.json', 'review.json', 'report.json'].map((name) => sha256File(join(f.workspace.marketingDir, 'production-reports', 'launch-16x9', name)));
    assert.equal(run(f.project, 'social-16x9').status, 1);
    approve(f.workspace);
    assert.equal(run(f.project, 'social-16x9').status, 0);
    assert.deepEqual(['evidence.json', 'review.json', 'report.json'].map((name) => sha256File(join(f.workspace.marketingDir, 'production-reports', 'launch-16x9', name))), prior);
    const approved = publicationApproval(f.workspace, 'acme', 'launch-16x9', join(f.workspace.matrixDir, 'launch-16x9.mp4'));
    assert.equal(approved.approved, true, approved.reason);
    writeFileSync(join(f.workspace.publicDir, 'source.txt'), 'changed after approval');
    assert.match(publicationApproval(f.workspace, 'acme', 'launch-16x9', join(f.workspace.matrixDir, 'launch-16x9.mp4')).reason, /stale|hash|inventory/i);
  } finally {
    rmSync(f.project, {recursive: true, force: true});
  }
});

test('production captions reject missing audio and audio tampering invalidates the source bundle', () => {
  const f = fixture();
  try {
    const props = JSON.parse(readFileSync(f.propsPath, 'utf8'));
    assert.throws(() => withBoundCaptions('LaunchVideo', props, props.audio), /audio\.lines inside the selected props/);
    props.audio = {lines: [{act: 'hook', text: 'tampered', durationMs: 1000}]};
    writeFileSync(f.propsPath, JSON.stringify(props));
    const bundle = loadProductionBundle(f.project, 'acme', f.planPath);
    assert.ok(bundle.findings.some((item) => item.level === 'FAIL' && /Props hash/.test(item.message)));
  } finally {
    rmSync(f.project, {recursive: true, force: true});
  }
});

test('layout-proof registration is structurally excluded from the run manifest path', () => {
  const source = readFileSync(join(root, 'scripts', 'render-matrix.mjs'), 'utf8');
  assert.match(source, /if \(!stillsOnly && existsSync\(runJson\)\)/);
  assert.doesNotMatch(source, /-> out\/\$\{brand\}/);
});
