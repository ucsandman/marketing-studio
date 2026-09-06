// node --test scripts/lib/matrix-props.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {productionHeroFrame, resolveBaseProps, makeBaseLoader, withBoundCaptions, withFormat} from './matrix-props.mjs';

const LAUNCH = {brandId: 'b', headline: 'bare launch props'};
const AUDIO = {track: 'music.mp3', lines: [{act: 'hook', durationMs: 4000, words: [{}]}]};
const SOCIAL = {brandId: 'b', headline: 'social props'};

// A throwaway repo root: props/<brand>-*.json plus, optionally, the merged manifest
// scripts/merge-launch-audio.mjs writes to out/<brand>/launch-audio-props.json.
function fixture(brand, {merged}) {
  const root = mkdtempSync(join(tmpdir(), 'matrix-props-test-'));
  const brandRoot = join(root, 'marketing', 'assets', brand);
  const propsDir = join(brandRoot, 'props');
  mkdirSync(propsDir, {recursive: true});
  writeFileSync(join(propsDir, `${brand}-launch.json`), JSON.stringify(LAUNCH));
  writeFileSync(join(propsDir, `${brand}-social-launch.json`), JSON.stringify(SOCIAL));
  if (merged) {
    writeFileSync(join(brandRoot, 'launch-audio-props.json'), JSON.stringify({...LAUNCH, audio: AUDIO}));
  }
  return {root, workspace: {brandRoot, propsDir}};
}

test('LaunchVideo resolves to the merged audio props when they exist', () => {
  const {root, workspace} = fixture('withaudio', {merged: true});
  try {
    assert.equal(
      resolveBaseProps(workspace, 'withaudio', 'LaunchVideo'),
      join(workspace.brandRoot, 'launch-audio-props.json'),
    );
    assert.deepEqual(makeBaseLoader(workspace, 'withaudio')('LaunchVideo'), {...LAUNCH, audio: AUDIO});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('SocialClip stays on the social props even when merged launch audio exists', () => {
  const {root, workspace} = fixture('withaudio', {merged: true});
  try {
    assert.equal(
      resolveBaseProps(workspace, 'withaudio', 'SocialClip'),
      join(workspace.propsDir, 'withaudio-social-launch.json'),
    );
    const base = makeBaseLoader(workspace, 'withaudio')('SocialClip');
    assert.deepEqual(base, SOCIAL);
    assert.equal('audio' in base, false, 'SocialClip has no audio track by design');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('LaunchVideo without the merged file resolves exactly as before', () => {
  const {root, workspace} = fixture('noaudio', {merged: false});
  try {
    assert.equal(
      resolveBaseProps(workspace, 'noaudio', 'LaunchVideo'),
      join(workspace.propsDir, 'noaudio-launch.json'),
    );
    assert.deepEqual(makeBaseLoader(workspace, 'noaudio')('LaunchVideo'), LAUNCH);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('withFormat overlays the dimension props on whichever base was resolved', () => {
  assert.deepEqual(withFormat({...LAUNCH, audio: AUDIO}, 1080, 1920), {
    ...LAUNCH,
    audio: AUDIO,
    formatWidth: 1080,
    formatHeight: 1920,
  });
});

test('caption props require timing from the selected props audio', () => {
  assert.throws(() => withBoundCaptions('LaunchVideo', LAUNCH, null), /audio\.lines inside the selected props/);
  assert.deepEqual(withBoundCaptions('LaunchVideo', LAUNCH, AUDIO), {...LAUNCH, audio: AUDIO, burnCaptions: true});
  assert.deepEqual(withBoundCaptions('SocialClip', SOCIAL, AUDIO).voLines, [{act: 'hook', text: undefined, durationMs: 4000}]);
});

test('production stills use the directed hero midpoint and clamp to the timeline', () => {
  assert.equal(productionHeroFrame({total: 780, shots: [{from: 216, len: 170, hero: true}]}, 240), 301);
  assert.equal(productionHeroFrame({total: 300, shots: [{from: 290, len: 40, hero: true}]}, 240), 299);
  assert.equal(productionHeroFrame({shots: [{from: 20, len: 30}]}, 240), 240);
});

test('a portrait SocialClip row prefers <brand>-social-vertical.json (the file that carries videoCropRegion)', () => {
  const {root, workspace} = fixture('crop', {merged: false});
  const VERTICAL = {...SOCIAL, videoCropRegion: {x: 300, y: 400, w: 1350, h: 620, sourceWidth: 1920, sourceHeight: 1080}};
  writeFileSync(join(workspace.propsDir, 'crop-social-vertical.json'), JSON.stringify(VERTICAL));
  writeFileSync(join(workspace.propsDir, 'crop-social-linkedin.json'), JSON.stringify(SOCIAL));
  try {
    assert.equal(resolveBaseProps(workspace, 'crop', 'SocialClip', {portrait: true}), join(workspace.propsDir, 'crop-social-vertical.json'));
    assert.equal(resolveBaseProps(workspace, 'crop', 'SocialClip'), join(workspace.propsDir, 'crop-social-launch.json'));
    const load = makeBaseLoader(workspace, 'crop');
    assert.deepEqual(load('SocialClip', {portrait: true}), VERTICAL);
    assert.deepEqual(load('SocialClip'), SOCIAL, 'landscape rows are unchanged and not served from the portrait cache entry');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a portrait row with no vertical file falls back exactly as before', () => {
  const {root, workspace} = fixture('novert', {merged: false});
  try {
    assert.equal(resolveBaseProps(workspace, 'novert', 'SocialClip', {portrait: true}), join(workspace.propsDir, 'novert-social-launch.json'));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
