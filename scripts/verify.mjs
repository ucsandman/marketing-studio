// One verify runner: the four suites this repo's Definition of Done requires
// (root tests, studio vitest, studio lint, smoke render), run sequentially,
// each one's full output quarantined to a log instead of the terminal, one
// row per suite. Exists so "did it pass" never has to be inferred from 50 KB
// of scrolled-past output — the row carries the count and the exit code does
// the deciding (never "no output printed" == pass).
//
// Usage: node scripts/verify.mjs [--no-smoke] [--only root,studio-test,studio-lint,smoke]
// Logs: out/verify/<suite>.log (out/ is gitignored)
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');
export const SUITE_NAMES = ['root', 'studio-test', 'studio-lint', 'smoke'];

function runNode(args, {cwd}) {
  const start = Date.now();
  let stdout = '';
  let stderr = '';
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  } catch (err) {
    stdout = typeof err.stdout === 'string' ? err.stdout : '';
    stderr = typeof err.stderr === 'string' ? err.stderr : String(err.message ?? err);
    status = typeof err.status === 'number' ? err.status : 1;
  }
  return {stdout, stderr, status, seconds: Number(((Date.now() - start) / 1000).toFixed(1))};
}

// npm.cmd is a Windows shell script; execFileSync(npm.cmd, ..., {shell:false})
// throws EINVAL on this Node/Windows combination (same failure mode as the
// npx shim documented in lib/remotion.mjs). shell:true is the escape hatch
// for exactly this one call — never used anywhere else in this runner.
function runNpm(args, {cwd}) {
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const start = Date.now();
  const opts = {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']};
  try {
    const stdout = execFileSync(bin, args, {...opts, shell: false});
    return {stdout, stderr: '', status: 0, seconds: Number(((Date.now() - start) / 1000).toFixed(1))};
  } catch (err) {
    if (err.code === 'EINVAL' && process.platform === 'win32') {
      try {
        const stdout = execFileSync(bin, args, {...opts, shell: true});
        return {stdout, stderr: '', status: 0, seconds: Number(((Date.now() - start) / 1000).toFixed(1))};
      } catch (err2) {
        return {
          stdout: typeof err2.stdout === 'string' ? err2.stdout : '',
          stderr: typeof err2.stderr === 'string' ? err2.stderr : String(err2.message ?? err2),
          status: typeof err2.status === 'number' ? err2.status : 1,
          seconds: Number(((Date.now() - start) / 1000).toFixed(1)),
        };
      }
    }
    return {
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : String(err.message ?? err),
      status: typeof err.status === 'number' ? err.status : 1,
      seconds: Number(((Date.now() - start) / 1000).toFixed(1)),
    };
  }
}

// Pure: node --test's own tap summary (`# tests N` / `# pass N` / `# fail N`).
export function parseTapCounts(text) {
  const num = (name) => Number((text.match(new RegExp(`^# ${name} (\\d+)`, 'm')) || [])[1] ?? NaN);
  return {tests: num('tests'), pass: num('pass'), fail: num('fail')};
}

// Pure: vitest's "     Tests  N failed | N passed (N)" summary line.
export function parseVitestCounts(text) {
  const line = (text.match(/^\s*Tests\s+(.+)$/m) || [])[1];
  if (!line) return null;
  const failed = Number((line.match(/(\d+) failed/) || [])[1] ?? 0);
  const passed = Number((line.match(/(\d+) passed/) || [])[1] ?? 0);
  const total = Number((line.match(/\((\d+)\)/) || [])[1] ?? passed + failed);
  return {tests: total, pass: passed, fail: failed};
}

// Pure: eslint's "N problems (N errors, N warnings)" summary line, if any.
export function parseLintCounts(text) {
  const m = text.match(/(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
  if (!m) return null;
  return {problems: Number(m[1]), errors: Number(m[2]), warnings: Number(m[3])};
}

// Pure: smoke.mjs's own final line, either side of success.
export function parseSmokeCounts(text) {
  const ok = text.match(/smoke OK: (\d+) compositions rendered/);
  if (ok) return {compositions: Number(ok[1]), summary: `${ok[1]} compositions rendered`};
  const failed = text.match(/^smoke FAILED: .*$/m);
  return {compositions: 0, summary: failed ? failed[0] : 'smoke did not report a result'};
}

// One row per suite: {name, pass, summary, seconds, logPath}. `run` executes
// the suite and returns {stdout, stderr, status, seconds}; the count-and-
// summary logic is per suite because each tool's own output shape differs
// (verified against a real run of each, not guessed).
function suite(name, run, toRow) {
  const {stdout, stderr, status, seconds} = run();
  const combined = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
  const logPath = join(root, 'out', 'verify', `${name}.log`);
  mkdirSync(dirname(logPath), {recursive: true});
  writeFileSync(logPath, combined);
  const {pass, summary} = toRow(combined, status);
  return {name, pass, summary, seconds, logPath};
}

function runRoot() {
  return suite(
    'root',
    () =>
      runNode(
        [
          '--test',
          '--test-reporter=tap',
          'scripts/*.test.mjs',
          'scripts/lib/*.test.mjs',
          'feeders/capture/*.test.mjs',
          'feeders/audio/*.test.mjs',
          'feeders/comfy/*.test.mjs',
        ],
        {cwd: root},
      ),
    (combined, status) => {
      const {tests, pass: passed, fail} = parseTapCounts(combined);
      // L2: a verdict on zero work is not a verdict — 0 tests is a FAIL.
      if (!Number.isFinite(tests) || tests === 0) return {pass: false, summary: '0 tests'};
      return {pass: status === 0 && fail === 0, summary: `${passed} passed, ${fail} failed`};
    },
  );
}

function runStudioTest() {
  return suite(
    'studio-test',
    () => runNpm(['test', '--', '--run'], {cwd: studio}),
    (combined, status) => {
      const counts = parseVitestCounts(combined);
      if (!counts || counts.tests === 0) return {pass: false, summary: '0 tests'};
      return {pass: status === 0 && counts.fail === 0, summary: `${counts.pass} passed, ${counts.fail} failed`};
    },
  );
}

function runStudioLint() {
  return suite(
    'studio-lint',
    () => runNpm(['run', 'lint'], {cwd: studio}),
    (combined, status) => {
      const counts = parseLintCounts(combined);
      if (status === 0) return {pass: true, summary: counts ? `${counts.errors} errors, ${counts.warnings} warnings` : '0 problems'};
      return {pass: false, summary: counts ? `${counts.errors} errors, ${counts.warnings} warnings` : `see log (exit ${status})`};
    },
  );
}

function runSmoke() {
  const outDir = mkdtempSync(join(tmpdir(), 'animations-verify-smoke-'));
  return suite(
    'smoke',
    () => runNode([join(root, 'scripts', 'smoke.mjs'), '--out-dir', outDir], {cwd: root}),
    (combined, status) => {
      const {compositions, summary} = parseSmokeCounts(combined);
      if (compositions === 0) return {pass: false, summary};
      return {pass: status === 0, summary};
    },
  );
}

const RUNNERS = {root: runRoot, 'studio-test': runStudioTest, 'studio-lint': runStudioLint, smoke: runSmoke};

export function formatRow(row) {
  return `${row.name.padEnd(11)} ${(row.pass ? 'PASS' : 'FAIL').padEnd(4)} ${row.summary} ${row.seconds}s ${join('out', 'verify', `${row.name}.log`)}`;
}

// Pure: which suites to run, in the fixed order — --only picks a subset (in
// SUITE_NAMES order, not the order named on the CLI); otherwise --no-smoke
// drops the render for a docs-only change.
export function selectSuites({only, noSmoke} = {}) {
  if (only?.length) return SUITE_NAMES.filter((n) => only.includes(n));
  return noSmoke ? SUITE_NAMES.filter((n) => n !== 'smoke') : SUITE_NAMES;
}

// Pure: overall exit code from the rows this run produced.
export function decideExit(rows) {
  return rows.some((r) => !r.pass) ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  const noSmoke = argv.includes('--no-smoke');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;

  const rows = selectSuites({only, noSmoke}).map((name) => {
    const row = RUNNERS[name]();
    console.log(formatRow(row));
    return row;
  });
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`verify: ${rows.length} suites, ${failed} failed`);
  process.exit(decideExit(rows));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
