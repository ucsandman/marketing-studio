// node --test scripts/build-launch-props.test.mjs
// Runs the builder as a child process against synthetic product workspaces.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const VO_LOCKED_BRANDS = ['truckside', 'tenwords', 'practicalsystems', 'postflop'];
const demoPropsName = (brand) =>
  brand === 'tenwords' || brand === 'postflop' ? `${brand}-launch-demo.json` : `${brand}-demo.json`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('only intentional VO-locked brands embed product-owned measured word timing', (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'launch-props-product-'));
  t.after(() => rmSync(projectRoot, {recursive: true, force: true}));
  mkdirSync(join(projectRoot, '.git'), {recursive: true});

  for (const brand of [...VO_LOCKED_BRANDS, 'noban']) {
    const workspace = resolveWorkspace(null, {brand, project: projectRoot});
    mkdirSync(workspace.propsDir, {recursive: true});
    mkdirSync(workspace.publicDir, {recursive: true});
    const words = [{word: `Measured-${brand}`, startMs: 0, endMs: 400}];
    const audio = {
      music: null,
      lines: [{act: 'hook', text: `Measured words for ${brand}.`, src: `${brand}/audio/hook.mp3`, durationMs: 900, words}],
    };
    writeFileSync(join(workspace.propsDir, demoPropsName(brand)), JSON.stringify({video: null, telemetry: null}));
    writeFileSync(join(workspace.propsDir, `${brand}-audio.json`), JSON.stringify(audio));

    execFileSync(process.execPath, [join(root, 'scripts', 'build-launch-props.mjs'), brand, '--project', projectRoot]);
    const propsPath = join(workspace.propsDir, `${brand}-launch.json`);
    const propsText = readFileSync(propsPath, 'utf8');
    const launch = JSON.parse(propsText);
    const production = JSON.parse(readFileSync(join(workspace.marketingDir, 'production-plan.json'), 'utf8'));

    if (VO_LOCKED_BRANDS.includes(brand)) {
      assert.deepEqual(launch.audio.lines[0].words, words, `${brand} must preserve measured word timing`);
    } else {
      assert.equal(launch.audio, undefined, `${brand} must not accidentally embed an audio manifest`);
    }
    assert.equal(
      production.sourceBundle.props.path,
      `marketing/assets/${brand}/props/${brand}-launch.json`,
    );
    assert.equal(production.sourceBundle.props.sha256, sha256(propsText));
    assert.match(production.sourceBundle.sha256, /^[0-9a-f]{64}$/);
  }
});
