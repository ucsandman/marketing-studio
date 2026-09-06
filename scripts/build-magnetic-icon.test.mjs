import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveIconOutput} from './build-magnetic-icon.mjs';

const fixture = () => {
  const project = mkdtempSync(join(tmpdir(), 'magnetic-icon-product-'));
  mkdirSync(join(project, '.git'));
  return project;
};

test('icon output defaults inside the explicit or inferred product repository', () => {
  const project = fixture();
  try {
    const expected = join(project, 'marketing', 'assets', 'magnetic', 'marketing', 'handoff');
    assert.equal(resolveIconOutput(['--project', project]), expected);
    assert.equal(resolveIconOutput([], project), expected);
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('icon output accepts an in-product override and rejects an escape', () => {
  const project = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'magnetic-icon-outside-'));
  try {
    assert.equal(
      resolveIconOutput(['--project', project, '--out', 'marketing/icons']),
      join(project, 'marketing', 'icons'),
    );
    assert.throws(
      () => resolveIconOutput(['--project', project, '--out', outside]),
      /escapes product repository/,
    );
  } finally {
    rmSync(project, {recursive: true, force: true});
    rmSync(outside, {recursive: true, force: true});
  }
});
