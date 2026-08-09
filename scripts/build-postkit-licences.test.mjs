// Unit tests for build-postkit.mjs's buildLicencesMd (Phase E: LICENCES.md stub).
// New file, not an edit to the existing build-postkit.test.mjs, per this task's
// file-scope restriction (existing tests stay untouched).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLicencesMd} from './build-postkit.mjs';

const brand = {fonts: {display: 'Saira', body: 'Hanken Grotesk', mono: 'Geist Mono'}};

test('buildLicencesMd lists the music src with a TODO when present', () => {
  const md = buildLicencesMd('noban.gg', brand, {music: {src: 'noban/audio/music.mp3'}, sfx: {enabled: false}});
  assert.match(md, /noban\/audio\/music\.mp3/);
  assert.match(md, /## Music[\s\S]*TODO/);
});

test('buildLicencesMd notes no music track when the manifest has none', () => {
  const md = buildLicencesMd('noban.gg', brand, {music: null, sfx: {enabled: false}});
  assert.match(md, /No music track for this brand/);
});

test('buildLicencesMd notes no audio manifest at all (silent-render brand)', () => {
  const md = buildLicencesMd('noban.gg', brand, null);
  assert.match(md, /No audio manifest for this brand/);
});

test('buildLicencesMd lists all three SFX files with a TODO when sfx.enabled is true', () => {
  const md = buildLicencesMd('noban.gg', brand, {music: null, sfx: {enabled: true}});
  assert.match(md, /whoosh\.mp3/);
  assert.match(md, /tick\.mp3/);
  assert.match(md, /riser\.mp3/);
});

test('buildLicencesMd notes SFX not enabled otherwise', () => {
  const md = buildLicencesMd('noban.gg', brand, {music: null, sfx: {enabled: false}});
  assert.match(md, /SFX not enabled for this brand/);
  assert.doesNotMatch(md, /whoosh\.mp3/);
});

test('buildLicencesMd lists each distinct font family once', () => {
  const md = buildLicencesMd('noban.gg', brand, null);
  assert.match(md, /Saira/);
  assert.match(md, /Hanken Grotesk/);
  assert.match(md, /Geist Mono/);
});

test('buildLicencesMd dedupes a font family used in more than one role', () => {
  const dashclaw = {fonts: {display: 'Inter', body: 'Inter', mono: 'JetBrains Mono'}};
  const md = buildLicencesMd('DashClaw', dashclaw, null);
  const interCount = (md.match(/Inter\b/g) ?? []).length;
  assert.equal(interCount, 1);
  assert.match(md, /JetBrains Mono/);
});

test('buildLicencesMd notes no fonts recorded when brand.fonts is missing', () => {
  const md = buildLicencesMd('noban.gg', {}, null);
  assert.match(md, /No fonts recorded for this brand/);
});
