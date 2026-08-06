import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {lintJson} from './lint-copy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'lint-copy.mjs');

function violationsFor(rule, violations) {
  return violations.filter((v) => v.rule === rule);
}

// --- Rule 1: em dash ---

test('em dash is flagged as ERROR', () => {
  const violations = lintJson({headline: 'Fast — and reliable'});
  const hits = violationsFor('em-dash', violations);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, 'ERROR');
  assert.equal(hits[0].path, 'headline');
});

test('string without em dash does not flag em-dash rule', () => {
  const violations = lintJson({headline: 'Fast and reliable'});
  assert.equal(violationsFor('em-dash', violations).length, 0);
});

// --- Rule 2: slop lexicon ---

test('each slop-lexicon word fires', () => {
  const samples = [
    'A seamless experience',
    'seamlessly integrated',
    'elevate your workflow',
    'delve into the data',
    'unleash your potential',
    'supercharge your team',
    'a game-changing update',
    'revolutionize the industry',
    'cutting-edge technology',
    'effortless setup',
    'effortlessly configured',
    'empower your team',
    'a robust solution',
    'leverage our platform',
    "in today's world of noise",
    'look no further',
  ];
  for (const s of samples) {
    const violations = lintJson({copy: s});
    assert.ok(
      violationsFor('slop-lexicon', violations).length >= 1,
      `expected slop-lexicon hit for: ${s}`
    );
  }
});

test('unlock as a verb opener fires', () => {
  const violations = lintJson({copy: 'Unlock the power of automation'});
  assert.equal(violationsFor('slop-lexicon', violations).length, 1);
});

test('unlock not at sentence start does not fire the opener check', () => {
  const violations = lintJson({copy: 'Turn the key to unlock savings'});
  assert.equal(violationsFor('slop-lexicon', violations).length, 0);
});

test('clean copy does not trigger slop-lexicon', () => {
  const violations = lintJson({copy: 'Hard spend caps on every trade'});
  assert.equal(violationsFor('slop-lexicon', violations).length, 0);
});

// --- Rule 3: breathless hype ---

test('3+ exclamation marks fires breathless-hype', () => {
  const violations = lintJson({copy: 'Buy now!!! Limited time!!!'});
  assert.ok(violationsFor('breathless-hype', violations).length >= 1);
});

test('fewer than 3 exclamation marks does not fire', () => {
  const violations = lintJson({copy: 'Buy now!'});
  assert.equal(violationsFor('breathless-hype', violations).length, 0);
});

test('ALL-CAPS word of 4+ letters fires breathless-hype', () => {
  const violations = lintJson({copy: 'This is an AMAZING deal'});
  const hits = violationsFor('breathless-hype', violations);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, 'AMAZING');
});

test('allowlisted acronyms do not fire breathless-hype', () => {
  const violations = lintJson({copy: 'Export the JSON via the API, view it in the UI'});
  assert.equal(violationsFor('breathless-hype', violations).length, 0);
});

// --- Rule 4: feature-speak (WARN) ---

test('capitalized gerund opener over 30 chars fires WARN feature-speak', () => {
  const violations = lintJson({copy: 'Providing real-time sync across every device you own'});
  const hits = violationsFor('feature-speak', violations);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, 'WARN');
});

test('Allows/Enables/Provides/Supports opener over 30 chars fires WARN', () => {
  const violations = lintJson({copy: 'Enables teams to ship faster with confidence'});
  assert.equal(violationsFor('feature-speak', violations).length, 1);
});

test('short gerund opener under 30 chars does not fire', () => {
  const violations = lintJson({copy: 'Running fast'});
  assert.equal(violationsFor('feature-speak', violations).length, 0);
});

test('feature-speak violation does not affect exit code (WARN only)', () => {
  const violations = lintJson({copy: 'Providing real-time sync across every device you own'});
  const errorCount = violations.filter((v) => v.level === 'ERROR').length;
  assert.equal(errorCount, 0);
});

// --- Skip rules: should NOT fire ---

test('path-like values (forward slash) are skipped', () => {
  const violations = lintJson({screenshot: 'synthacon/market-grid.png'});
  assert.equal(violations.length, 0);
});

test('path-like values (backslash) are skipped', () => {
  const violations = lintJson({screenshot: 'synthacon\\market-grid.png'});
  assert.equal(violations.length, 0);
});

test('hex colors are skipped', () => {
  const violations = lintJson({colors: {bg: '#0b0a0f', profit: '#d6c23c', short: '#fff'}});
  assert.equal(violations.length, 0);
});

test('URLs are skipped', () => {
  const violations = lintJson({link: 'https://synthacon.com/robust-page'});
  assert.equal(violations.length, 0);
});

test('font names under a "fonts" object are skipped', () => {
  const violations = lintJson({fonts: {display: 'Saira', body: 'Hanken Grotesk', mono: 'Geist Mono'}});
  assert.equal(violations.length, 0);
});

test('font-prefixed key is skipped', () => {
  const violations = lintJson({font: 'Robust Sans'});
  assert.equal(violations.length, 0);
});

test('keys named id/key/act/comp are skipped even with slop text', () => {
  const violations = lintJson({id: 'seamless-intro', key: 'unleash', act: 'delve', comp: 'ROBUST'});
  assert.equal(violations.length, 0);
});

test('keys ending in Path/Src/File are skipped', () => {
  const violations = lintJson({
    logoPath: 'seamless assets here',
    videoSrc: 'seamless video',
    configFile: 'seamless config',
  });
  assert.equal(violations.length, 0);
});

test('non-string values (numbers, booleans, null) are ignored without error', () => {
  const violations = lintJson({count: 42, active: true, missing: null});
  assert.equal(violations.length, 0);
});

test('nested arrays and objects are walked with correct JSON paths', () => {
  const violations = lintJson({features: [{lines: ['a robust feature']}]});
  const hits = violationsFor('slop-lexicon', violations);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'features[0].lines[0]');
});

// --- CLI exit codes and flags (spawned subprocess) ---

const tmpDir = mkdtempSync(join(tmpdir(), 'lint-copy-test-'));

function writeFixture(name, data) {
  const file = join(tmpDir, name);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function runCli(args) {
  try {
    const stdout = execFileSync('node', [cli, ...args], {encoding: 'utf8'});
    return {stdout, status: 0};
  } catch (err) {
    return {stdout: err.stdout ?? '', status: err.status};
  }
}

test('CLI exits 0 on clean fixture', () => {
  const file = writeFixture('clean.json', {headline: 'Hard spend caps on every trade'});
  const {status, stdout} = runCli([file]);
  assert.equal(status, 0);
  assert.match(stdout, /clean, no violations/);
});

test('CLI exits 1 on fixture with an ERROR-level violation', () => {
  const file = writeFixture('dirty.json', {headline: 'A seamless — revolutionize experience'});
  const {status} = runCli([file]);
  assert.equal(status, 1);
});

test('CLI exits 0 when only WARN-level violations are present', () => {
  const file = writeFixture('warn-only.json', {copy: 'Providing real-time sync across every device you own'});
  const {status, stdout} = runCli([file]);
  assert.equal(status, 0);
  assert.match(stdout, /feature-speak/);
});

test('CLI --json emits machine-readable results', () => {
  const file = writeFixture('json-mode.json', {headline: 'A seamless experience'});
  const {stdout, status} = runCli([file, '--json']);
  assert.equal(status, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.file, file);
  assert.ok(parsed.violations.length >= 1);
  assert.equal(parsed.errorCount, 1);
});

test('CLI --fix-report adds fix suggestions to the human report', () => {
  const file = writeFixture('fix-report.json', {headline: 'A seamless experience'});
  const {stdout} = runCli([file, '--fix-report']);
  assert.match(stdout, /fix:/);
});

test('CLI fails loudly on a missing file', () => {
  const {status} = runCli([join(tmpDir, 'does-not-exist.json')]);
  assert.equal(status, 1);
});

test('CLI fails loudly on invalid JSON', () => {
  const file = join(tmpDir, 'invalid.json');
  writeFileSync(file, '{not valid json');
  const {status} = runCli([file]);
  assert.equal(status, 1);
});

test('CLI fails loudly with no file argument', () => {
  const {status} = runCli([]);
  assert.equal(status, 1);
});
