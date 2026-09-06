import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {_setCliForTests, ffmpeg, ffprobe, remotion, remotionCli, studioDir} from './remotion.mjs';

// A stand-in for remotion-cli.js: echoes its argv as JSON on stdout, writes a
// marker to stderr, and exits non-zero (with 60 numbered stderr lines) when the
// first argument is 'boom'.
const fixtures = mkdtempSync(join(tmpdir(), 'remotion-runner-test-'));
const fakeCli = join(fixtures, 'fake-cli.mjs');
writeFileSync(
  fakeCli,
  [
    'const argv = process.argv.slice(2);',
    "if (argv[0] === 'boom') {",
    '  for (let i = 1; i <= 60; i++) console.error(`line ${i}`);',
    '  process.exit(7);',
    '}',
    'console.log(JSON.stringify(argv));',
    "console.error('stderr-marker');",
    '',
  ].join('\n'),
);

// Captures whatever the runner writes to stdout/stderr while fn runs.
function capturingConsole(fn) {
  const out = [];
  const errs = [];
  const realLog = console.log;
  const realWrite = process.stderr.write;
  console.log = (line) => out.push(String(line));
  process.stderr.write = (chunk) => {
    errs.push(String(chunk));
    return true;
  };
  try {
    return {result: fn(), out, errs};
  } finally {
    console.log = realLog;
    process.stderr.write = realWrite;
  }
}

test('exports the checked-in CLI path inside studio', () => {
  assert.ok(remotionCli.endsWith(join('node_modules', '@remotion', 'cli', 'remotion-cli.js')));
  assert.ok(remotionCli.startsWith(studioDir));
});

test('appends --log=error to render and still, once, and never to other verbs', () => {
  _setCliForTests(fakeCli);
  try {
    const still = JSON.parse(capturingConsole(() => remotion(['still', 'Card', 'out.png'], {capture: true})).result);
    assert.deepEqual(still, ['still', 'Card', 'out.png', '--log=error']);

    const render = JSON.parse(capturingConsole(() => remotion(['render', 'LogoReveal', 'o.mp4'], {capture: true})).result);
    assert.deepEqual(render, ['render', 'LogoReveal', 'o.mp4', '--log=error']);

    // Already carries a --log flag: not doubled, caller's level wins.
    const preset = JSON.parse(
      capturingConsole(() => remotion(['render', 'X', 'o.mp4', '--log=verbose'], {capture: true})).result,
    );
    assert.deepEqual(preset.filter((a) => a.startsWith('--log')), ['--log=verbose']);

    const bundle = JSON.parse(
      capturingConsole(() => remotion(['bundle', 'src/index.ts', '--out-dir', 'b'], {capture: true})).result,
    );
    assert.ok(!bundle.some((a) => a.startsWith('--log')));
  } finally {
    _setCliForTests();
  }
});

test('prints exactly one summary line naming composition, output and seconds', () => {
  _setCliForTests(fakeCli);
  try {
    const still = capturingConsole(() => remotion(['still', 'src/index.ts', 'LogoReveal', join(fixtures, 'nope.png')]));
    assert.equal(still.out.length, 1);
    assert.match(still.out[0], /^remotion still LogoReveal -> nope\.png \(\d+\.\ds\)$/);

    // A real output file adds its size.
    const sized = join(fixtures, 'sized.png');
    writeFileSync(sized, Buffer.alloc(3 * 1024 * 1024));
    const withSize = capturingConsole(() => remotion(['still', 'Card', sized]));
    assert.match(withSize.out[0], /^remotion still Card -> sized\.png \(\d+\.\ds, 3\.0 MB\)$/);

    const small = join(fixtures, 'small.png');
    writeFileSync(small, Buffer.alloc(2048));
    assert.match(capturingConsole(() => remotion(['still', 'Card', small])).out[0], /, 2 KB\)$/);

    // Non-render verbs get the short form.
    const other = capturingConsole(() => remotion(['bundle', 'src/index.ts']));
    assert.equal(other.out.length, 1);
    assert.match(other.out[0], /^remotion bundle \(\d+\.\ds\)$/);
  } finally {
    _setCliForTests();
  }
});

test('failure prints the last 40 buffered lines and throws with status and tail', () => {
  _setCliForTests(fakeCli);
  try {
    let thrown;
    const {errs} = capturingConsole(() => {
      try {
        remotion(['boom']);
      } catch (err) {
        thrown = err;
      }
      return null;
    });
    assert.ok(thrown, 'expected the runner to rethrow');
    assert.equal(thrown.status, 7);
    assert.match(thrown.message, /remotion boom failed \(exit 7\)/);

    const tailLines = thrown.tail.split('\n');
    assert.equal(tailLines.length, 40, `expected a 40-line tail, got ${tailLines.length}`);
    assert.equal(tailLines[0], 'line 21');
    assert.equal(tailLines[39], 'line 60');
    assert.ok(!thrown.tail.includes('line 20'), 'tail must be the LAST 40 lines');

    // The same tail went to stderr for the operator.
    const printed = errs.join('');
    assert.ok(printed.includes('line 60'), 'tail was not printed to stderr');
    assert.ok(printed.includes('line 21'));

    // Callers that parse ffmpeg's stderr off a failing run (judge-palette reads
    // "Duration:" this way) still get the raw streams.
    assert.ok(thrown.stderr.includes('line 60'));
    assert.equal(typeof thrown.stdout, 'string');
  } finally {
    _setCliForTests();
  }
});

test('capture modes: false returns empty, true returns stdout, both adds stderr', () => {
  _setCliForTests(fakeCli);
  try {
    assert.equal(capturingConsole(() => remotion(['bundle'])).result, '');
    assert.equal(capturingConsole(() => remotion(['bundle'], {capture: true})).result.trim(), '["bundle"]');
    const both = capturingConsole(() => remotion(['bundle'], {capture: 'both'})).result;
    assert.ok(both.includes('stderr-marker'), 'capture:both must include the child stderr');
  } finally {
    _setCliForTests();
  }
});

test('REMOTION_VERBOSE=1 inherits stdio and still prints the summary line', () => {
  _setCliForTests(fakeCli);
  const before = process.env.REMOTION_VERBOSE;
  process.env.REMOTION_VERBOSE = '1';
  try {
    // stdout is inherited (nothing captured) but the summary line still prints.
    const quiet = capturingConsole(() => remotion(['bundle']));
    assert.equal(quiet.result, '');
    assert.equal(quiet.out.length, 1);
    assert.match(quiet.out[0], /^remotion bundle \(\d+\.\ds\)$/);

    // A capturing caller keeps its pipe, so parsing scripts keep working.
    assert.equal(capturingConsole(() => remotion(['bundle'], {capture: true})).result.trim(), '["bundle"]');
  } finally {
    if (before === undefined) delete process.env.REMOTION_VERBOSE;
    else process.env.REMOTION_VERBOSE = before;
    _setCliForTests();
  }
});

test('quiet suppresses the summary line and the failure tail, not the thrown Error', () => {
  _setCliForTests(fakeCli);
  try {
    const ok = capturingConsole(() => remotion(['bundle'], {quiet: true}));
    assert.deepEqual(ok.out, [], 'quiet must print no summary line');

    let thrown;
    const {out, errs} = capturingConsole(() => {
      try {
        remotion(['boom'], {quiet: true});
      } catch (err) {
        thrown = err;
      }
      return null;
    });
    assert.deepEqual(out, []);
    assert.deepEqual(errs, [], 'quiet must not print the failure tail');
    assert.ok(thrown, 'quiet must still throw');
    assert.equal(thrown.status, 7);
    assert.ok(thrown.stderr.includes('line 60'), 'the caller still gets the raw stderr to parse');
  } finally {
    _setCliForTests();
  }
});

test('ffmpeg quiets by default, keeps caller flags when loud; ffprobe always captures', () => {
  _setCliForTests(fakeCli);
  try {
    const quiet = JSON.parse(capturingConsole(() => ffmpeg(['-i', 'a.mp4', 'b.mp4'], {capture: true})).result);
    assert.deepEqual(quiet, ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'a.mp4', 'b.mp4']);

    const loud = JSON.parse(
      capturingConsole(() => ffmpeg(['-hide_banner', '-i', 'a.mp4'], {loud: true, capture: true})).result,
    );
    assert.deepEqual(loud, ['ffmpeg', '-hide_banner', '-i', 'a.mp4']);

    // ffprobe needs no capture flag from the caller.
    const probed = capturingConsole(() => ffprobe(['-v', 'error', 'a.mp4'])).result;
    assert.deepEqual(JSON.parse(probed), ['ffprobe', '-v', 'error', 'a.mp4']);
  } finally {
    _setCliForTests();
  }
});
