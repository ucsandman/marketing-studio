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
//
// Brand token bands (brands/*.json `motion` block, WARN):
//   exuberance > 0.85  bounce far past the subtle band (mapping crosses
//                      critical damping ~0.55; 1.0 is toy-like).
//   tempo outside [0.5, 2]  entrance speed drifts too far from act timing.
//
// Advisor like the other judges: exit 0; `--strict` exits 1 on a FAIL verdict.
//
// Usage: node scripts/judge-motion.mjs [brand] [--strict] [--json]
// Output: out/<brand>/marketing/judge-motion.json (or out/judge-motion.json without a brand)
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
    re: /\btransition\s*:/,
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
  const brand = argv.find((a) => !a.startsWith('--')) ?? null;

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
  }

  const verdict = findings.some((f) => f.level === 'ERROR') ? 'FAIL' : 'PASS';
  const report = {
    judge: 'motion',
    brand,
    generatedAt: new Date().toISOString(),
    verdict,
    input: {sourceFiles: files.length, brands: brandsChecked},
    bands: {EXUBERANCE_MAX, TEMPO_MIN, TEMPO_MAX},
    findings,
  };

  const outDir = brand ? join(root, 'out', brand, 'marketing') : join(root, 'out');
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
