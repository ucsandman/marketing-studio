import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {resolveBaseProps, stillFrameForComposition} from './matrix-props.mjs';

// Isolated fake <root>/props/ directory per test so resolution never touches the
// real repo props/ folder.
function makeRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'matrix-props-'));
  mkdirSync(join(root, 'props'), {recursive: true});
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(root, 'props', name), JSON.stringify(contents));
  }
  return root;
}

test('LaunchVideo resolves to <brand>-launch.json (unchanged)', () => {
  const root = makeRoot({'acme-launch.json': {ok: true}});
  assert.equal(resolveBaseProps(root, 'acme', 'LaunchVideo'), join(root, 'props', 'acme-launch.json'));
  rmSync(root, {recursive: true, force: true});
});

test('SocialClip prefers <brand>-social-launch.json (unchanged)', () => {
  const root = makeRoot({
    'acme-social-launch.json': {ok: true},
    'acme-social-x.json': {ok: true},
  });
  assert.equal(resolveBaseProps(root, 'acme', 'SocialClip'), join(root, 'props', 'acme-social-launch.json'));
  rmSync(root, {recursive: true, force: true});
});

test('SocialClip falls back to the first <brand>-social-*.json (unchanged)', () => {
  const root = makeRoot({'acme-social-x.json': {ok: true}});
  assert.equal(resolveBaseProps(root, 'acme', 'SocialClip'), join(root, 'props', 'acme-social-x.json'));
  rmSync(root, {recursive: true, force: true});
});

test('MotionVariant resolves to <brand>-motion.json', () => {
  const root = makeRoot({'synthacon-motion.json': {ok: true}});
  assert.equal(resolveBaseProps(root, 'synthacon', 'MotionVariant'), join(root, 'props', 'synthacon-motion.json'));
  rmSync(root, {recursive: true, force: true});
});

test('MotionVariant resolves a selected post props file without changing other comps', () => {
  const root = makeRoot({
    'acme-launch.json': {ok: true},
    'acme-social-launch.json': {ok: true},
    'acme-motion.json': {ok: true},
    'acme-post-next-owner.json': {ok: true},
  });
  assert.equal(resolveBaseProps(root, 'acme', 'MotionVariant', 'next-owner'), join(root, 'props', 'acme-post-next-owner.json'));
  assert.equal(resolveBaseProps(root, 'acme', 'LaunchVideo'), join(root, 'props', 'acme-launch.json'));
  assert.equal(resolveBaseProps(root, 'acme', 'SocialClip'), join(root, 'props', 'acme-social-launch.json'));
  rmSync(root, {recursive: true, force: true});
});

test('still frames preserve both call sites while MotionVariant uses its settled poster frame', () => {
  const callSites = [
    {name: 'render-matrix', launchVideoFrame: 240},
    {name: 'extract-thumbs', launchVideoFrame: 220},
  ];

  for (const {name, launchVideoFrame} of callSites) {
    assert.equal(stillFrameForComposition('MotionVariant', launchVideoFrame), 140, `${name}: MotionVariant`);
    assert.equal(stillFrameForComposition('SocialClip', launchVideoFrame), 40, `${name}: SocialClip`);
    assert.equal(stillFrameForComposition('LaunchVideo', launchVideoFrame), launchVideoFrame, `${name}: LaunchVideo`);
  }
});
