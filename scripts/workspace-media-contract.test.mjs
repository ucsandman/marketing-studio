import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveWorkspace} from './lib/workspace.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const scripts = [
  ['build-costclaw-feature-stills.mjs', 'costclaw', false],
  ['build-postflop-feature-stills.mjs', 'postflop', false],
  ['build-practicalsystems-feature-stills.mjs', 'practicalsystems', false],
  ['build-sidetap-feature-stills.mjs', 'sidetap', false],
  ['build-sidetap-social-opens.mjs', 'sidetap', false],
  ['build-tenwords-feature-stills.mjs', 'tenwords', false],
  ['build-postflop-launch-demo.mjs', 'postflop', true],
  ['build-tenwords-launch-demo.mjs', 'tenwords', true],
];

test('all eight media builders bind public and props paths to an external workspace', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'media-contract-'));
  const engine = join(fixture, 'engine');
  const project = join(fixture, 'product');
  mkdirSync(join(engine, '.git'), {recursive: true});
  mkdirSync(join(project, '.git'), {recursive: true});

  for (const [name, brand, writesProps] of scripts) {
    const workspace = resolveWorkspace(engine, {brand, project});
    assert.equal(join(workspace.publicDir, brand), join(project, 'marketing', 'assets', brand, 'public', brand));
    if (writesProps) assert.equal(workspace.propsDir, join(project, 'marketing', 'assets', brand, 'props'));

    const source = readFileSync(join(root, name), 'utf8');
    assert.match(source, /resolveWorkspace\(root, \{brand:/, name);
    assert.match(source, /projectArg\(process\.argv\.slice\(2\)\)/, name);
    assert.match(source, /join\(workspace\.publicDir, ['"][a-z]+['"]\)/, name);
    if (writesProps) assert.match(source, /workspace\.propsDir/, name);
    assert.doesNotMatch(source, /join\((?:root|studio), ['"](?:out|props|public)['"]/, name);
    assert.doesNotMatch(source, /^\s*(?:execFileSync\(['"]npx['"]|shell:)/m, name);
    if (source.includes("'remotion', 'ffmpeg'")) assert.fail(`${name}: npx-style Remotion argv remains`);
  }
});
