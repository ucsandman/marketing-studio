// One gate runner: the seven mechanical gates (CLAUDE.md) in one canonical
// order, each isolated in its own child process, quiet by default.
//
// Exists because the seven gates used to be run by hand, one at a time, with
// inherited stdio: every invocation dumped a judge's full console output into
// whichever agent ran it, and nothing enforced drift-last or the hard-gate
// exit policy. This runs all seven, writes each one's full output to a log
// (never to the terminal), and prints one row per gate.
//
// Never forwards --strict to the child gates: a judge that receives --strict
// calls process.exit(1) on its own FAIL, which would make "exited non-zero"
// indistinguishable from "the script crashed". Instead every gate always runs
// plain + --json, this runner parses the verdict out of the JSON itself, and
// --strict here only changes THIS runner's own exit code. Hard gates
// (check-budgets, check-audio) exit non-zero on a real FAIL regardless of any
// flag — that is their contract — so ERROR below is reserved for "no JSON
// came back at all" (a crash or a usage error), not for a legitimate FAIL.
//
// Usage: node scripts/gates.mjs <brand> --project <product-repo> [--strict] [--only a,b] [--skip a,b]
// Output: <workspace>/marketing/reports/gates/<gate>.log + <gate>.json per gate.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative} from 'node:path';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Canonical order — drift LAST because it scores the whole asset set, so
// running it before everything else has rendered scores an incomplete set.
export const GATE_NAMES = ['av-sync', 'demo-pacing', 'palette', 'motion', 'budgets', 'audio', 'drift'];
export const HARD_GATES = new Set(['budgets', 'audio']);
const NAME_WIDTH = Math.max(...GATE_NAMES.map((n) => n.length));

const SCRIPT_FILE = {
  'av-sync': 'judge-av-sync.mjs',
  'demo-pacing': 'judge-demo-pacing.mjs',
  palette: 'judge-palette.mjs',
  motion: 'judge-motion.mjs',
  budgets: 'check-budgets.mjs',
  audio: 'check-audio.mjs',
  drift: 'judge-drift.mjs',
};

// judge-palette needs a second positional <video-or-png>: prefer the picture-
// locked hero, then the working lock, then a still, so the gate never blocks
// on the absence of a variant a given workspace never produced.
export function pickPaletteInput(brandOut) {
  if (existsSync(join(brandOut, 'launch-final.mp4'))) return 'launch-final.mp4';
  if (existsSync(join(brandOut, 'launch.mp4'))) return 'launch.mp4';
  return 'og.png';
}

// Pure: the ordered list of {name, scriptPath, args, hard} to run.
// scriptOverrides lets tests substitute fake scripts without touching order,
// arg-building, or hard/judge classification.
export function buildPlan({brand, project, only, skip, brandOut, scriptOverrides = {}}) {
  let names = GATE_NAMES;
  if (only?.length) names = names.filter((n) => only.includes(n));
  if (skip?.length) names = names.filter((n) => !skip.includes(n));
  return names.map((name) => {
    const args = [brand];
    if (name === 'palette') args.push(join(brandOut, pickPaletteInput(brandOut)));
    args.push('--project', project, '--json');
    return {name, scriptPath: scriptOverrides[name] ?? join(root, 'scripts', SCRIPT_FILE[name]), args, hard: HARD_GATES.has(name)};
  });
}

// Pure: pull the first balanced {...} JSON object out of text, tolerating
// trailing lines after it — check-audio prints its per-file lines AFTER its
// JSON blob even with --json (verified against its main()), so this cannot
// assume the whole stdout is the report. Returns null rather than throwing.
export function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Pure: {verdict, counts} from a gate's own report JSON. Field names are
// per-script (VERIFIED against each script's own report shape, never
// guessed): the five judges share {verdict, findings[]}; check-budgets has
// no verdict field at all (derived from overCount); check-audio's verdict
// is implicit in failed/checked/skipped, plus a WARN for a recorded
// music-only film.
export function summarize(name, json) {
  if (name === 'budgets') {
    const over = json.overCount ?? 0;
    return {verdict: over > 0 ? 'FAIL' : 'PASS', counts: `${json.checked ?? 0} checked, ${over} over budget`};
  }
  if (name === 'audio') {
    const failed = json.failed ?? 0;
    const warn = !failed && json.film?.verdict === 'WARN';
    return {
      verdict: failed > 0 ? 'FAIL' : warn ? 'WARN' : 'PASS',
      counts: `checked=${json.checked ?? 0} failed=${failed} skipped=${json.skipped ?? 0}`,
    };
  }
  const findings = Array.isArray(json.findings) ? json.findings : [];
  const fails = findings.filter((f) => f.level === 'FAIL').length;
  const verdict = json.verdict === 'FAIL' || fails > 0 ? 'FAIL' : findings.length > 0 ? 'WARN' : 'PASS';
  const counts = `${findings.length} findings, ${fails} FAIL`;
  // judge-palette picks its own input file; report which one landed in the
  // gate's own report (input.path) so a reader never has to guess.
  // The row shows the file name only. Split on either separator: the judge writes the
  // path as the OS gave it, and a Windows path read on Linux CI has no '/' for basename.
  const inputName = json.input?.path ? String(json.input.path).split(/[\\/]/).pop() : null;
  return name === 'palette' && inputName ? {verdict, counts: `${counts}, input=${inputName}`} : {verdict, counts};
}

// Runs one gate as an isolated child process; never throws. Full stdout+
// stderr (in that order) goes to <logDir>/<name>.log; the parsed JSON (or an
// error record) goes to <logDir>/<name>.json. A gate whose stdout carries no
// parseable JSON is reported as ERROR with its last 3 lines and the runner
// moves on — one bad gate must not hide the other six.
export function runGate(plan, logDir) {
  const start = Date.now();
  let stdout = '';
  let stderr = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [plan.scriptPath, ...plan.args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    stdout = typeof err.stdout === 'string' ? err.stdout : '';
    stderr = typeof err.stderr === 'string' ? err.stderr : String(err.message ?? err);
    status = typeof err.status === 'number' ? err.status : 1;
  }
  const seconds = Number(((Date.now() - start) / 1000).toFixed(1));
  const combined = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
  mkdirSync(logDir, {recursive: true});
  const logPath = join(logDir, `${plan.name}.log`);
  writeFileSync(logPath, combined);

  const json = extractJson(stdout);
  if (!json) {
    const lines = combined.trim().split('\n').filter(Boolean);
    const lastLines = lines.slice(-3).join(' | ') || '(no output)';
    writeFileSync(join(logDir, `${plan.name}.json`), JSON.stringify({error: true, status, lastLines}, null, 2));
    return {name: plan.name, hard: plan.hard, verdict: 'ERROR', counts: lastLines, seconds, logPath};
  }
  writeFileSync(join(logDir, `${plan.name}.json`), JSON.stringify(json, null, 2));
  const {verdict, counts} = summarize(plan.name, json);
  return {name: plan.name, hard: plan.hard, verdict, counts, seconds, logPath};
}

export function formatRow(row, relLogPath) {
  return `${row.name.padEnd(NAME_WIDTH)} ${row.verdict.padEnd(5)} ${row.counts} ${row.seconds}s ${relLogPath}`;
}

// Exit follows a hard gate FAILing or ERRORing outright, or, with --strict,
// any gate FAILing or ERRORing. WARN never fails the run, strict or not —
// that mirrors every judge's own --strict contract (findings.some(FAIL)).
export function decideExit(rows, strict) {
  const bad = (r) => r.verdict === 'FAIL' || r.verdict === 'ERROR';
  const hardBad = rows.some((r) => r.hard && bad(r));
  const judgeBad = strict && rows.some((r) => !r.hard && bad(r));
  return hardBad || judgeBad ? 1 : 0;
}

const FLAGS_WITH_VALUE = new Set(['--project', '--only', '--skip']);
function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
function csv(value) {
  return value ? value.split(',').map((s) => s.trim()).filter(Boolean) : null;
}

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const only = csv(argValue(argv, '--only'));
  const skip = csv(argValue(argv, '--skip'));
  const brand = argv.find((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUE.has(argv[i - 1]));
  if (!brand) {
    console.error('usage: node scripts/gates.mjs <brand> --project <product-repo> [--strict] [--only a,b] [--skip a,b]');
    process.exit(1);
  }
  let ws;
  try {
    ws = resolveWorkspace(root, {brand, project: projectArg(argv)});
  } catch (err) {
    console.error(`gates: ${err.message}`);
    process.exit(1);
  }

  const reportsDir = join(ws.marketingDir, 'reports', 'gates');
  const plan = buildPlan({brand, project: ws.projectRoot, only, skip, brandOut: ws.brandOut});
  const rel = (p) => relative(ws.projectRoot, p).replace(/\\/g, '/');

  console.log(`gates [${brand}]: running ${plan.map((p) => p.name).join(', ')}${strict ? ' (--strict)' : ''}`);
  const rows = plan.map((item) => {
    const row = runGate(item, reportsDir);
    console.log(formatRow(row, rel(row.logPath)));
    return row;
  });

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  console.log(
    `gates: ${rows.length} run, ${count('PASS')} pass, ${count('WARN')} warn, ${count('FAIL')} fail, ${count('ERROR')} error (logs: ${rel(reportsDir)})`,
  );
  process.exit(decideExit(rows, strict));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
