// node --test scripts/lib/matrix-props.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveBaseProps, makeBaseLoader, withFormat} from './matrix-props.mjs';

const LAUNCH = {brandId: 'b', headline: 'bare launch props'};
const AUDIO = {track: 'music.mp3', lines: [{act: 'hook', durationMs: 4000, words: [{}]}]};
const SOCIAL = {brandId: 'b', headline: 'social props'};

// A throwaway repo root: props/<brand>-*.json plus, optionally, the merged manifest
// scripts/merge-launch-audio.mjs writes to out/<brand>/launch-audio-props.json.
function fixture(brand, {merged}) {
  const root = mkdtempSync(join(tmpdir(), 'matrix-props-test-'));
  mkdirSync(join(root, 'props'), {recursive: true});
  writeFileSync(join(root, 'props', `${brand}-launch.json`), JSON.stringify(LAUNCH));
  writeFileSync(join(root, 'props', `${brand}-social-launch.json`), JSON.stringify(SOCIAL));
  if (merged) {
    mkdirSync(join(root, 'out', brand), {recursive: true});
    writeFileSync(
      join(root, 'out', brand, 'launch-audio-props.json'),
      JSON.stringify({...LAUNCH, audio: AUDIO}),
    );
  }
  return root;
}

test('LaunchVideo resolves to the merged audio props when they exist', () => {
  const root = fixture('withaudio', {merged: true});
  try {
    assert.equal(
      resolveBaseProps(root, 'withaudio', 'LaunchVideo'),
      join(root, 'out', 'withaudio', 'launch-audio-props.json'),
    );
    assert.deepEqual(makeBaseLoader(root, 'withaudio')('LaunchVideo'), {...LAUNCH, audio: AUDIO});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('SocialClip stays on the social props even when merged launch audio exists', () => {
  const root = fixture('withaudio', {merged: true});
  try {
    assert.equal(
      resolveBaseProps(root, 'withaudio', 'SocialClip'),
      join(root, 'props', 'withaudio-social-launch.json'),
    );
    const base = makeBaseLoader(root, 'withaudio')('SocialClip');
    assert.deepEqual(base, SOCIAL);
    assert.equal('audio' in base, false, 'SocialClip has no audio track by design');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('LaunchVideo without the merged file resolves exactly as before', () => {
  const root = fixture('noaudio', {merged: false});
  try {
    assert.equal(
      resolveBaseProps(root, 'noaudio', 'LaunchVideo'),
      join(root, 'props', 'noaudio-launch.json'),
    );
    assert.deepEqual(makeBaseLoader(root, 'noaudio')('LaunchVideo'), LAUNCH);
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
