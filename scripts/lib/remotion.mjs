// One quiet Remotion runner. Every script that shells to Remotion goes through
// here, so a 2700-frame render prints one summary line instead of 2700 progress
// lines (measured 2026-09-06: 69 lines for a 60-frame render at the default log
// level, ~100 KB / ~25k tokens for a full LaunchVideo).
//
// - Runs the checked-in remotion-cli.js through process.execPath, never the `npx`
//   shim, which returns EINVAL when spawned directly on Windows (ERRORS.md
//   2026-09-05).
// - Appends `--log=error` to `render` and `still` unless the caller already set a
//   --log flag. Verified byte-identical output to a loud run (SHA-256).
// - Buffers stdout and stderr. On failure it prints the last 40 buffered lines to
//   stderr and throws an Error carrying .status/.stdout/.stderr/.tail, so the OOM
//   signature the PLAYBOOK documents ("a render that dies with a bare Command
//   failed is out of memory") stays diagnosable.
// - REMOTION_VERBOSE=1 restores inherited stdio for debugging; the summary line
//   still prints.
//
// spawnSync rather than execFileSync: `capture: 'both'` needs the child's stderr
// on a SUCCESSFUL run (ffmpeg writes silencedetect/ebur128 reports to stderr and
// exits 0), and execFileSync only returns stdout. Unit-tested in
// scripts/lib/remotion.test.mjs.
import {spawnSync} from 'node:child_process';
import {statSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const studioDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'studio');
export const remotionCli = join(studioDir, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

const QUIET_VERBS = new Set(['render', 'still']);
const TAIL_LINES = 40;
const MAX_BUFFER = 64 * 1024 * 1024;

let cli = remotionCli;

// Tests point the runner at a fake CLI script; call with no argument to restore.
// WIRE-DARK[test seam only; consumer is scripts/lib/remotion.test.mjs, never production]
export function _setCliForTests(path) {
  cli = path || remotionCli;
}

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Positional args are the tokens after the verb that are neither flags nor the
// value of a space-separated flag (`--out-dir <dir>`). For render/still they are
// [entry?, composition, output], so the output is last and the composition second.
function positionals(args) {
  const found = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('-')) continue;
    const prev = args[i - 1];
    if (prev.startsWith('-') && !prev.includes('=')) continue;
    found.push(args[i]);
  }
  return found;
}

function summary(args, seconds) {
  const verb = args[0];
  const pos = positionals(args);
  if (!QUIET_VERBS.has(verb) || pos.length < 2) return `remotion ${verb} (${seconds}s)`;
  const out = pos[pos.length - 1];
  const comp = pos[pos.length - 2];
  let size = '';
  try {
    size = `, ${formatSize(statSync(out).size)}`;
  } catch {
    size = '';
  }
  return `remotion ${verb} ${comp} -> ${basename(out)} (${seconds}s${size})`;
}

// capture: false -> returns ''; true -> child stdout; 'both' -> stdout + stderr.
// quiet: suppress both the summary line and the failure tail, for internal plumbing
// whose failure the caller handles itself (judge-palette probes a video's duration
// with a call it EXPECTS to exit non-zero, then reads "Duration:" off err.stderr).
// The thrown Error still carries .status/.stdout/.stderr/.tail either way.
export function remotion(args, {cwd = studioDir, capture = false, env, quiet = false} = {}) {
  const argv = [...args];
  if (QUIET_VERBS.has(argv[0]) && !argv.some((a) => a === '--log' || a.startsWith('--log='))) {
    argv.push('--log=error');
  }
  const verbose = process.env.REMOTION_VERBOSE === '1';
  // Verbose restores inherited stdio; a capturing caller keeps its stdout pipe or
  // it would parse an empty string.
  const stdio = verbose ? ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'];
  const started = Date.now();
  const res = spawnSync(process.execPath, [cli, ...argv], {
    cwd,
    stdio,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    ...(env ? {env} : {}),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  if (res.error || res.status !== 0) {
    const tail = [stdout, stderr].filter(Boolean).join('\n').trimEnd().split('\n').slice(-TAIL_LINES).join('\n');
    if (!verbose && !quiet && tail.trim()) process.stderr.write(`${tail}\n`);
    const code = res.status === null || res.status === undefined ? res.error?.code || 'signal' : res.status;
    const err = new Error(`remotion ${argv[0]} failed (exit ${code})${tail ? `\n${tail}` : ''}`);
    err.status = res.status;
    err.stdout = stdout;
    err.stderr = stderr;
    err.tail = tail;
    if (res.error) err.cause = res.error;
    throw err;
  }
  if (!quiet) console.log(summary(argv, seconds));
  if (capture === 'both') return stdout + stderr;
  return capture ? stdout : '';
}

// `remotion ffmpeg` with the banner and per-frame progress suppressed. Callers that
// parse ffmpeg's own stderr (silencedetect, ebur128, Duration:) pass {loud: true}
// and keep their own flags.
export function ffmpeg(args, opts = {}) {
  const quiet = opts.loud ? [] : ['-hide_banner', '-loglevel', 'error'];
  return remotion(['ffmpeg', ...quiet, ...args], opts);
}

// `remotion ffprobe` always captures and returns the child's stdout.
export function ffprobe(args, opts = {}) {
  return remotion(['ffprobe', ...args], {...opts, capture: opts.capture ?? true});
}
