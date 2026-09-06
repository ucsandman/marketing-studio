#!/usr/bin/env node
// Quality judge #4 — motion craft.
//
// Static gate over the studio's motion conventions, adapted from Emil
// Kowalski's animation review standards (github.com/emilkowalski/skills,
// review-animations/STANDARDS.md, MIT) for a Remotion pipeline. The repo
// already routes choreography through lib/motion.ts + brand motion tokens;
// this judge keeps future template work from regressing that.
//
// Source rules (studio/src, ERROR unless noted):
//   ease-in        Easing.in( on anything — an entrance easing-in delays the
//                  exact moment the viewer is watching; use Easing.out.
//   scale-zero     scale(0) / scale: 0 start states — nothing in the real
//                  world appears from nothing; start at 0.9-0.97 + opacity.
//   css-transition transition: in a Remotion component — CSS transitions do
//                  not advance with rendered frames; dead code or a bug.
//   css-keyframes  @keyframes / animation: — same reason.
//   raw-spring     spring( outside lib/motion.ts (WARN) — bypasses the brand
//                  motion personality; use brandSpring/entrance instead.
//   entry-scale    a literal scale start below the ENTRY_SCALE floor (WARN) —
//                  scale(0) is an ERROR above, but scale(0.6) still reads as a
//                  different object growing rather than the same object
//                  arriving; entrances belong in 0.9-0.97 (lib/motion.ts
//                  entryScale()).
//
// Brand token bands (brands/*.json, WARN):
//   exuberance > 0.85  bounce far past the subtle band (mapping crosses
//                      critical damping ~0.55; 1.0 is toy-like).
//   tempo outside [0.5, 2]  entrance speed drifts too far from act timing.
//   stagger    whose effective group gap falls outside STAGGER_MS — too tight
//              reads as one simultaneous (mechanical) event, too wide stops
//              reading as a group at all.
//   grade.grain > GRAIN_CEILING  grain should be felt, not seen; past the
//              ceiling the overlay reads as video noise instead of film stock.
//
// The numeric bands are IMPORTED from studio/src/lib/motion.ts, never
// re-declared here — PLAYBOOK: duration math lives in ONE pure lib.
//
// Advisor like the other judges: exit 0; `--strict` exits 1 on a FAIL verdict.
//
// Usage: node scripts/judge-motion.mjs [brand] [--strict] [--json]
// Output: <product-repo>/marketing/assets/<brand>/marketing/judge-motion.json
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative} from 'node:path';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The single source of truth for every number below. Node's native TS type
// stripping loads this directly (same mechanism contact-sheet.mjs uses for
// launchTiming.ts), so the judge and the templates can never disagree.
const {
  ENTRY_SCALE,
  STAGGER_MS,
  DEFAULT_MOTION,
  staggerEffectiveMs,
} = await import('../studio/src/lib/motion.ts');

// The cadence the band check probes with: the studio's typical "2 base frames
// between items in a group at 30fps". stagger is a MULTIPLIER, so it only has a
// millisecond meaning against a reference cadence — this is that reference,
// stated once rather than guessed per call site.
const STAGGER_PROBE_FRAMES = 2;
const STAGGER_PROBE_FPS = 30;

// "Felt rather than seen" — a working colorist's ceiling for a film-grain
// overlay. Above this the grain stops reading as stock and starts reading as
// compression noise. (Frame.io Insider, "How a pro colorist uses film grain".)
const GRAIN_CEILING = 0.4;

// Halation is the knob most likely to turn a comp into the generic AI-glow look:
// past this it stops reading as light scattering off a film base and starts
// reading as a CSS glow filter. Rendered proof for the band: at 0.55 the noban
// wordmark grew a pronounced halo that read as esports-neon, which its voice
// explicitly forbids; 0.22 kept the mark instrument-sharp.
const HALATION_CEILING = 0.35;

const SOURCE_RULES = [
  {
    check: 'ease-in',
    level: 'ERROR',
    re: /\bEasing\.in\(/,
    message: 'Easing.in( delays the moment the viewer is watching; entrances/exits use Easing.out.',
  },
  {
    check: 'scale-zero',
    level: 'ERROR',
    re: /\bscale\(\s*0(\.0+)?\s*[,)]|(?<![\w.])scale:\s*0(\.0+)?\s*[,}]/,
    message: 'scale(0) start state; nothing appears from nothing — start at scale(0.9-0.97) with opacity.',
  },
  {
    check: 'css-transition',
    level: 'ERROR',
    // A CSS transition value names a duration. Plain domain fields such as
    // shot.transition or z.object({transition: ...}) are production grammar,
    // not browser animation and must not false-positive this source judge.
    re: /\btransition\s*:\s*['"`][^'"`]*(?:\d(?:\.\d+)?m?s)\b/,
    message: 'CSS transition in a Remotion component; transitions do not advance with rendered frames.',
  },
  {
    check: 'css-keyframes',
    level: 'ERROR',
    re: /@keyframes|\banimation\s*:/,
    message: 'CSS keyframe animation in a Remotion component; it will not advance with rendered frames.',
  },
  {
    check: 'raw-spring',
    level: 'WARN',
    re: /(?<![A-Za-z])spring\(/,
    message: 'Raw spring( bypasses the brand motion personality; route through brandSpring/entrance (lib/motion.ts).',
    exemptFile: /lib[\\/]motion\.ts$/,
  },
  {
    check: 'entry-scale',
    level: 'WARN',
    // Captures the numeric literal so `predicate` can judge the VALUE. scale(0)
    // is already an ERROR via scale-zero; this catches the band between.
    re: /\bscale\(\s*(\.\d+|0\.\d+)\s*[,)]|(?<![\w.])scale:\s*(\.\d+|0\.\d+)\s*[,}]/,
    predicate: (m) => {
      const v = Number(m[1] ?? m[2]);
      return v > 0 && v < ENTRY_SCALE[0];
    },
    message: `scale start below the ${ENTRY_SCALE[0]}-${ENTRY_SCALE[1]} entrance band; below it the element reads as a different object growing, not this one arriving (lib/motion.ts entryScale()).`,
    exemptFile: /lib[\\/]motion\.ts$/,
  },
];

// Token bands. exuberance's damping-ratio mapping crosses critical (~zeta 1)
// around 0.55 (lib/motion.ts); past 0.85 the entrance is deeply underdamped.
const EXUBERANCE_MAX = 0.85;
const TEMPO_MIN = 0.5;
const TEMPO_MAX = 2;

// Strip comments so a rule name in a docstring never fires. Line-based, with a
// tiny block-comment state machine; string literals containing `/*` would fool
// it, which is acceptable for a lint-grade scan.
export function stripComments(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf('*/');
      if (end === -1) {
        out.push('');
        continue;
      }
      s = s.slice(end + 2);
      inBlock = false;
    }
    let start;
    while ((start = s.indexOf('/*')) !== -1) {
      const end = s.indexOf('*/', start + 2);
      if (end === -1) {
        s = s.slice(0, start);
        inBlock = true;
        break;
      }
      s = s.slice(0, start) + s.slice(end + 2);
    }
    const lineComment = s.indexOf('//');
    if (lineComment !== -1) s = s.slice(0, lineComment);
    out.push(s);
  }
  return out;
}

/** Scan one source file's text. Returns findings with 1-indexed line numbers. */
export function scanSource(text, relPath) {
  const findings = [];
  const lines = stripComments(text);
  lines.forEach((line, i) => {
    for (const rule of SOURCE_RULES) {
      if (rule.exemptFile && rule.exemptFile.test(relPath)) continue;
      const m = rule.re.exec(line);
      if (m) {
        if (rule.predicate && !rule.predicate(m)) continue;
        findings.push({
          check: rule.check,
          level: rule.level,
          file: relPath,
          line: i + 1,
          text: m[0].trim(),
          message: rule.message,
        });
      }
    }
  });
  return findings;
}

/** Validate one brand's motion block against the token bands. */
export function checkMotionTokens(motion, brandId) {
  const findings = [];
  if (!motion || typeof motion !== 'object') return findings; // zod defaults are vetted
  if (typeof motion.exuberance === 'number' && motion.exuberance > EXUBERANCE_MAX) {
    findings.push({
      check: 'exuberance-band',
      level: 'WARN',
      file: `brands/${brandId}.json`,
      line: null,
      text: `exuberance: ${motion.exuberance}`,
      message: `exuberance ${motion.exuberance} > ${EXUBERANCE_MAX}: deeply underdamped, entrances read toy-like.`,
    });
  }
  if (typeof motion.tempo === 'number' && (motion.tempo < TEMPO_MIN || motion.tempo > TEMPO_MAX)) {
    findings.push({
      check: 'tempo-band',
      level: 'WARN',
      file: `brands/${brandId}.json`,
      line: null,
      text: `tempo: ${motion.tempo}`,
      message: `tempo ${motion.tempo} outside [${TEMPO_MIN}, ${TEMPO_MAX}]: entrance speed drifts too far from act timing.`,
    });
  }
  if (typeof motion.stagger === 'number') {
    // staggerEffectiveMs is lib/motion.ts's own formula, not a copy of it, so a
    // change to the stagger multiplier math can never silently desync this band.
    const ms = staggerEffectiveMs(STAGGER_PROBE_FRAMES, STAGGER_PROBE_FPS, {
      ...DEFAULT_MOTION,
      stagger: motion.stagger,
    });
    if (ms < STAGGER_MS[0] || ms > STAGGER_MS[1]) {
      findings.push({
        check: 'stagger-band',
        level: 'WARN',
        file: `brands/${brandId}.json`,
        line: null,
        text: `stagger: ${motion.stagger}`,
        message:
          `stagger ${motion.stagger} gives a ${ms.toFixed(0)}ms group gap at the ` +
          `${STAGGER_PROBE_FRAMES}-frame/${STAGGER_PROBE_FPS}fps reference cadence, outside ` +
          `[${STAGGER_MS[0]}, ${STAGGER_MS[1]}]ms: ` +
          (ms < STAGGER_MS[0]
            ? 'items land together and the group reads mechanical.'
            : 'items land so far apart the group stops reading as one.'),
      });
    }
  }
  return findings;
}

/**
 * Validate one brand's grade block. Separate from checkMotionTokens so that
 * function's tested (motion, brandId) signature stays intact.
 */
export function checkGradeTokens(grade, brandId) {
  const findings = [];
  if (!grade || typeof grade !== 'object') return findings; // zod defaults are vetted
  if (typeof grade.grain === 'number' && grade.grain > GRAIN_CEILING) {
    findings.push({
      check: 'grain-ceiling',
      level: 'WARN',
      file: `brands/${brandId}.json`,
      line: null,
      text: `grade.grain: ${grade.grain}`,
      message: `grain ${grade.grain} > ${GRAIN_CEILING}: grain should be felt, not seen — past the ceiling the overlay reads as compression noise rather than film stock.`,
    });
  }
  if (typeof grade.halation === 'number' && grade.halation > HALATION_CEILING) {
    findings.push({
      check: 'halation-ceiling',
      level: 'WARN',
      file: `brands/${brandId}.json`,
      line: null,
      text: `grade.halation: ${grade.halation}`,
      message: `halation ${grade.halation} > ${HALATION_CEILING}: past the ceiling highlight bloom stops reading as light scattering off film and starts reading as a CSS glow.`,
    });
  }
  return findings;
}

function collectSourceFiles(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        walk(join(d, e.name));
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) {
        files.push(join(d, e.name));
      }
    }
  };
  walk(dir);
  return files;
}

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const brand = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project') ?? null;
  const outputBrand = brand ?? 'all';
  let ws;
  try {
    ws = resolveWorkspace(root, {brand: outputBrand, project: projectArg(argv)});
  } catch (err) {
    console.error(`judge-motion: ${err.message}`);
    process.exit(1);
  }

  const srcDir = join(root, 'studio', 'src');
  if (!existsSync(srcDir)) {
    console.error('judge-motion: studio/src not found');
    process.exit(1);
  }

  const findings = [];
  const files = collectSourceFiles(srcDir);
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/');
    findings.push(...scanSource(readFileSync(f, 'utf8'), rel));
  }

  const brandFiles = brand
    ? [`${brand}.json`]
    : readdirSync(join(root, 'brands')).filter((f) => f.endsWith('.json'));
  const brandsChecked = [];
  for (const bf of brandFiles) {
    const p = join(root, 'brands', bf);
    if (!existsSync(p)) {
      console.error(`judge-motion: missing ${p}`);
      process.exit(1);
    }
    const id = bf.replace(/\.json$/, '');
    brandsChecked.push(id);
    let def;
    try {
      def = JSON.parse(readFileSync(p, 'utf8'));
    } catch (err) {
      console.error(`judge-motion: brands/${bf} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
    findings.push(...checkMotionTokens(def.motion, id));
    findings.push(...checkGradeTokens(def.grade, id));
  }

  const verdict = findings.some((f) => f.level === 'ERROR') ? 'FAIL' : 'PASS';
  const report = {
    judge: 'motion',
    brand,
    generatedAt: new Date().toISOString(),
    verdict,
    input: {sourceFiles: files.length, brands: brandsChecked},
    bands: {
      EXUBERANCE_MAX,
      TEMPO_MIN,
      TEMPO_MAX,
      ENTRY_SCALE,
      STAGGER_MS,
      GRAIN_CEILING,
      HALATION_CEILING,
      staggerProbe: {frames: STAGGER_PROBE_FRAMES, fps: STAGGER_PROBE_FPS},
    },
    findings,
  };

  const outDir = ws.marketingDir;
  mkdirSync(outDir, {recursive: true});
  const outPath = join(outDir, 'judge-motion.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `judge-motion${brand ? ` [${brand}]` : ''}: ${verdict} — ${files.length} source file(s), ${brandsChecked.length} brand(s)`,
    );
    for (const f of findings) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      console.log(`  [${f.level}] ${f.check} ${where}: "${f.text}" - ${f.message}`);
    }
    if (findings.length === 0) console.log('  no motion findings');
    console.log(`  report -> ${relative(root, outPath).replace(/\\/g, '/')}`);
  }

  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
