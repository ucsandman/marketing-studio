import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyNobanAssets, NOBAN_ASSETS, resolveNobanAssetPaths} from './fetch-noban-assets.mjs';

const fixture = () => {
  const project = mkdtempSync(join(tmpdir(), 'noban-assets-product-'));
  mkdirSync(join(project, '.git'));
  const sourceDir = join(project, 'marketing', 'assets', 'shots');
  mkdirSync(sourceDir, {recursive: true});
  for (const file of NOBAN_ASSETS) writeFileSync(join(sourceDir, file), `fixture:${file}`);
  return {project, sourceDir};
};

test('NoBan asset paths and copies stay in the product public namespace', () => {
  const {project, sourceDir} = fixture();
  try {
    const paths = resolveNobanAssetPaths(['--project', project]);
    assert.equal(paths.sourceDir, sourceDir);
    assert.equal(paths.destDir, join(project, 'marketing', 'assets', 'noban', 'public', 'noban'));
    assert.equal(copyNobanAssets(paths), 3);
    for (const file of NOBAN_ASSETS) {
      const copied = join(paths.destDir, file);
      assert.ok(existsSync(copied));
      assert.equal(readFileSync(copied, 'utf8'), `fixture:${file}`);
    }
  } finally {
    rmSync(project, {recursive: true, force: true});
  }
});

test('NoBan source and output overrides reject product-repository escapes', () => {
  const {project} = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'noban-assets-outside-'));
  try {
    assert.throws(
      () => resolveNobanAssetPaths(['--project', project, '--source', outside]),
      /escapes product repository/,
    );
    assert.throws(
      () => resolveNobanAssetPaths(['--project', project, '--out', outside]),
      /escapes product repository/,
    );
  } finally {
    rmSync(project, {recursive: true, force: true});
    rmSync(outside, {recursive: true, force: true});
  }
});
