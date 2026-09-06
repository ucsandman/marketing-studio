import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fillTemplate, firstCheckpoint, imagesFromHistory, resolveHeroOutput} from './client.mjs';

test('fillTemplate substitutes string and numeric tokens and parses', () => {
  const text = '{"a": {"inputs": {"ckpt_name": "{{CHECKPOINT}}", "seed": "{{SEED}}", "text": "x {{POSITIVE}} y"}}}';
  const graph = fillTemplate(text, {CHECKPOINT: 'model.safetensors', SEED: 47, POSITIVE: 'violet grid'});
  assert.equal(graph.a.inputs.ckpt_name, 'model.safetensors');
  assert.equal(graph.a.inputs.seed, 47); // numeric, unquoted
  assert.equal(graph.a.inputs.text, 'x violet grid y');
});

test('fillTemplate throws on unresolved tokens', () => {
  assert.throws(() => fillTemplate('{"x": "{{MISSING}}"}', {}), /unresolved token/i);
});

test('firstCheckpoint reads the object_info enum shape', () => {
  const info = {CheckpointLoaderSimple: {input: {required: {ckpt_name: [['a.safetensors', 'b.ckpt']]}}}};
  assert.equal(firstCheckpoint(info), 'a.safetensors');
  assert.equal(firstCheckpoint({}), null);
});

test('imagesFromHistory collects images across output nodes', () => {
  const history = {
    p1: {outputs: {'9': {images: [{filename: 'noban_hero_00001_.png', subfolder: '', type: 'output'}]}}},
  };
  assert.deepEqual(imagesFromHistory(history, 'p1'), [
    {filename: 'noban_hero_00001_.png', subfolder: '', type: 'output'},
  ]);
  assert.deepEqual(imagesFromHistory({}, 'p1'), []);
});

test('resolveHeroOutput defaults production output into the product workspace', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'comfy-product-'));
  mkdirSync(join(project, '.git'));
  t.after(() => rmSync(project, {recursive: true, force: true}));
  const {outDir} = resolveHeroOutput(['hero', '--project', project, '--brand', 'example']);
  assert.equal(outDir, join(project, 'marketing', 'assets', 'example', 'assets', 'comfy'));
});

test('resolveHeroOutput rejects production output outside the product workspace', (t) => {
  const project = mkdtempSync(join(tmpdir(), 'comfy-product-'));
  mkdirSync(join(project, '.git'));
  t.after(() => rmSync(project, {recursive: true, force: true}));
  assert.throws(
    () => resolveHeroOutput(['hero', '--project', project, '--out', process.cwd()]),
    /escapes product repository/,
  );
});
