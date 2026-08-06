import test from 'node:test';
import assert from 'node:assert/strict';
import {fillTemplate, firstCheckpoint, imagesFromHistory} from './client.mjs';

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
    p1: {outputs: {'9': {images: [{filename: 'synthacon_hero_00001_.png', subfolder: '', type: 'output'}]}}},
  };
  assert.deepEqual(imagesFromHistory(history, 'p1'), [
    {filename: 'synthacon_hero_00001_.png', subfolder: '', type: 'output'},
  ]);
  assert.deepEqual(imagesFromHistory({}, 'p1'), []);
});
