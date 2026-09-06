// Fail-closed production gate. Unlike the advisory craft judges, PASS requires
// the canonical source plan, samples extracted from the exact final render,
// approved style-frame/animatic evidence, and a hash-bound perceptual review.
// Usage: node scripts/judge-production.mjs <brand> --plan <production-plan.json> --render <final.mp4> [--strict]

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  artifactApproval,
  evidenceQuality,
  loadProductionBundle,
  perceptualReview,
  readJson,
  referenceQuality,
  resolveInside,
  sha256File,
  shotGrammar,
  verdictFor,
} from './lib/production-quality.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function argValue(argv, name) {
  const i = argv.indexOf(name);
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return i >= 0 ? argv[i + 1] : inline?.slice(name.length + 1) ?? null;
}

function parseRate(value) {
  const [a, b = '1'] = String(value ?? '').split('/').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && b ? a / b : null;
}

export function probeRender(path) {
  const raw = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_frames:format=duration,size', '-of', 'json', path],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']},
  );
  const parsed = JSON.parse(raw);
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error('no video stream');
  const durationSec = Number(parsed.format?.duration);
  const fps = parseRate(stream.avg_frame_rate);
  const frames = Number(stream.nb_frames) || (Number.isFinite(durationSec) && fps ? Math.round(durationSec * fps) : null);
  return {
    codec: stream.codec_name,
    width: Number(stream.width),
    height: Number(stream.height),
    fps,
    frames,
    durationSec,
    bytes: Number(parsed.format?.size) || statSync(path).size,
  };
}

function rel(base, path) {
  return relative(base, path).replaceAll('\\', '/');
}

export function evaluateProduction({workspace, brand, productionPlanPath, renderPath, evidencePath, reviewPath, heroReportPath}) {
  const base = workspace.projectRoot;
  const resolvedHeroReportPath = heroReportPath ?? join(workspace.marketingDir, 'judge-production.json');
  const bundle = loadProductionBundle(base, brand, productionPlanPath, {
    directionPath: join(workspace.marketingDir, 'direction.json'),
    shotPlanPath: join(workspace.marketingDir, 'shot-plan.json'),
    publicDir: workspace.publicDir,
  });
  const findings = [...bundle.findings];
  const plan = bundle.shotPlan?.value ?? null;
  const direction = bundle.direction?.value ?? plan?.direction ?? null;
  const grammar = shotGrammar(plan);
  findings.push(...grammar.findings);
  const references = referenceQuality(direction, grammar.shots);
  findings.push(...references.findings);

  const styleFrame = artifactApproval('style-frame', direction?.styleFrame, base);
  const animatic = artifactApproval('animatic', direction?.animatic, base);
  findings.push(...styleFrame.findings, ...animatic.findings);

  const resolvedRender = resolveInside(base, renderPath);
  let render = null;
  if (!resolvedRender || !existsSync(resolvedRender) || !statSync(resolvedRender).isFile()) {
    findings.push({level: 'INCOMPLETE', category: 'render', message: 'Final render is missing or outside the repository.'});
  } else {
    try {
      render = {...probeRender(resolvedRender), path: resolvedRender, sha256: sha256File(resolvedRender)};
      if (!Number.isFinite(render.durationSec) || render.durationSec <= 0 || !render.frames) {
        findings.push({level: 'FAIL', category: 'render', message: 'Final render has no measurable duration or frames.'});
      }
      const total = Number(plan?.total ?? plan?.totalFrames);
      if (Number.isFinite(total) && render.frames && render.frames + 1 < total) {
        findings.push({level: 'FAIL', category: 'render', message: `Final render has ${render.frames} frames but the shot plan requires ${total}.`});
      }
    } catch (err) {
      findings.push({level: 'FAIL', category: 'render', message: `Final render could not be measured: ${err.message}`});
    }
  }

  let evidence = null;
  let evidenceResult = {samples: [], measured: [], motion: [], evidenceSha256: null, findings: []};
  const resolvedEvidence = resolveInside(base, evidencePath);
  if (!resolvedEvidence || !existsSync(resolvedEvidence)) {
    findings.push({level: 'INCOMPLETE', category: 'evidence', message: 'production-evidence.json is missing.'});
  } else if (render && bundle.productionPlanSha256) {
    try {
      evidence = readJson(resolvedEvidence);
      evidenceResult = evidenceQuality(evidence, {
        planSha256: bundle.productionPlanSha256,
        renderSha256: render.sha256,
        sourceBundleSha256: bundle.sourceBundleSha256,
        shotIds: grammar.shots.map((shot) => shot.id),
        root: base,
      });
      findings.push(...evidenceResult.findings);
    } catch (err) {
      findings.push({level: 'FAIL', category: 'evidence', message: `Production evidence is unreadable: ${err.message}`});
    }
  }

  let reviewEntries = [];
  const resolvedReview = resolveInside(base, reviewPath);
  if (resolvedReview && existsSync(resolvedReview)) {
    try {
      const parsed = JSON.parse(readFileSync(resolvedReview, 'utf8'));
      reviewEntries = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      findings.push({level: 'FAIL', category: 'perceptual-review', message: `Review log is unreadable: ${err.message}`});
    }
  }
  // A hero master's own strict PASS lets its human review govern other matrix rows
  // rendered from the same approved plan and source bundle (see docs/production-quality.md).
  // Judging the hero itself never needs this: same renderSha256, so skip it silently.
  let hero = null;
  const resolvedHeroReport = resolveInside(base, resolvedHeroReportPath);
  if (render && resolvedHeroReport && existsSync(resolvedHeroReport)) {
    try {
      const heroReport = JSON.parse(readFileSync(resolvedHeroReport, 'utf8'));
      const heroRenderSha256 = heroReport?.input?.renderSha256 ?? null;
      if (heroRenderSha256 && heroRenderSha256 !== render.sha256) {
        hero = {
          renderSha256: heroRenderSha256,
          planSha256: heroReport?.input?.productionPlanSha256 ?? null,
          sourceBundleSha256: heroReport?.input?.sourceBundleSha256 ?? null,
          verdict: heroReport?.verdict ?? null,
          path: rel(base, resolvedHeroReport),
        };
      }
    } catch {
      // A malformed hero report grants no inheritance; the row falls back to its own review.
    }
  }
  const perceptual = perceptualReview(reviewEntries, {
    planSha256: bundle.productionPlanSha256,
    renderSha256: render?.sha256,
    sourceBundleSha256: bundle.sourceBundleSha256,
    evidenceSha256: evidenceResult.evidenceSha256,
    hero,
  });
  findings.push(...perceptual.findings);

  const verdict = verdictFor(findings);
  return {
    judge: 'production',
    verdict,
    generatedAt: new Date().toISOString(),
    input: {
      brand,
      projectRoot: base,
      productionPlanPath: bundle.manifestPath ? rel(base, bundle.manifestPath) : null,
      productionPlanSha256: bundle.productionPlanSha256 ?? null,
      sourceBundleSha256: bundle.sourceBundleSha256 ?? null,
      sourceBundleFiles: bundle.publicInventory?.files.length ?? 0,
      directionPath: bundle.direction?.path ? rel(base, bundle.direction.path) : null,
      directionSha256: bundle.direction?.sha256 ?? null,
      shotPlanPath: bundle.shotPlan?.path ? rel(base, bundle.shotPlan.path) : null,
      shotPlanSha256: bundle.shotPlan?.sha256 ?? null,
      renderPath: render?.path ? rel(base, render.path) : null,
      renderSha256: render?.sha256 ?? null,
      renderBytes: render?.bytes ?? 0,
      frames: render?.frames ?? 0,
      shots: grammar.shots.length,
      reviewedFrames: evidenceResult.measured.length,
    },
    machine: {
      render: render ? {...render, path: rel(base, render.path)} : null,
      grammar: grammar.counts,
      references: references.references.length,
      stageEvidence: {
        styleFrame: styleFrame.path ? {path: rel(base, styleFrame.path), sha256: styleFrame.hash, bytes: styleFrame.bytes} : null,
        animatic: animatic.path ? {path: rel(base, animatic.path), sha256: animatic.hash, bytes: animatic.bytes} : null,
      },
      samples: evidenceResult.measured.map((sample) => ({shotId: sample.shotId, phase: sample.phase, frame: sample.frame, metrics: sample.metrics})),
      motion: evidenceResult.motion,
    },
    perceptual: {
      reviews: perceptual.reviews ?? 0,
      inherited: perceptual.inherited ?? null,
      latest: perceptual.review ? {
        at: perceptual.review.at,
        reviewer: perceptual.review.reviewer,
        action: perceptual.review.action,
        wouldShare: perceptual.review.wouldShare,
        scores: perceptual.review.scores,
        defects: perceptual.defects?.length ?? 0,
      } : null,
    },
    summary: {
      shots: grammar.shots.length,
      references: references.references.length,
      evidenceSamples: evidenceResult.samples.length,
      measuredSamples: evidenceResult.measured.length,
      perceptualReviews: perceptual.reviews ?? 0,
      fails: findings.filter((item) => item.level === 'FAIL').length,
      incomplete: findings.filter((item) => item.level === 'INCOMPLETE').length,
      warns: findings.filter((item) => item.level === 'WARN').length,
    },
    findings,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const brand = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;
  if (!brand) {
    console.error('usage: node scripts/judge-production.mjs <brand> --project <product-repo> --plan <production-plan.json> --render <final.mp4> [--strict]');
    process.exit(1);
  }
  let workspace;
  try {
    workspace = resolveWorkspace(engineRoot, {brand, project: projectArg(argv)});
  } catch (err) {
    console.error(`judge-production: ${err.message}`);
    process.exit(1);
  }
  const within = (raw) => resolveWorkspacePath(workspace, raw);
  const productionPlanPath = within(argValue(argv, '--plan') ?? join(workspace.marketingDir, 'production-plan.json'));
  const renderPath = within(argValue(argv, '--render') ?? join(workspace.brandOut, 'launch.mp4'));
  const evidencePath = within(argValue(argv, '--evidence') ?? join(workspace.marketingDir, 'production-evidence.json'));
  const reviewPath = within(argValue(argv, '--review') ?? join(workspace.marketingDir, 'review.json'));
  const reportPath = within(argValue(argv, '--report') ?? join(workspace.marketingDir, 'judge-production.json'));
  const heroReportPath = within(argValue(argv, '--hero-report') ?? join(workspace.marketingDir, 'judge-production.json'));
  mkdirSync(dirname(reportPath), {recursive: true});
  const report = evaluateProduction({workspace, brand, productionPlanPath, renderPath, evidencePath, reviewPath, heroReportPath});
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const inherited = report.perceptual.inherited;
  const inheritedSuffix = inherited ? ` (inherited from hero ${inherited.from.slice(0, 8)})` : '';
  console.log(`judge-production ${report.verdict}: shots=${report.input.shots} frames=${report.input.frames} samples=${report.input.reviewedFrames} reviews=${report.summary.perceptualReviews}${inheritedSuffix} fails=${report.summary.fails} incomplete=${report.summary.incomplete} warns=${report.summary.warns}`);
  console.log(`report: ${rel(workspace.projectRoot, reportPath)}`);
  if (argv.includes('--json')) console.log(JSON.stringify(report));
  if (argv.includes('--strict') && report.verdict !== 'PASS') process.exit(1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
