// Unit tests for build-postkit.mjs's buildDisclosureMd (DISCLOSURE.md at the kit
// root). Sibling of build-postkit-licences.test.mjs, same reason: these root-level
// record files are their own concern, kept out of the main postkit assembly tests.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDisclosureMd, PLATFORM_MAP} from './build-postkit.mjs';

const withVo = {lines: [{id: 'a'}, {id: 'b'}], music: {src: 'noban/audio/music.mp3'}, sfx: {enabled: true}};
const silent = null;

test('synthetic voiceover and music are both listed as disclosable', () => {
  const md = buildDisclosureMd('noban.gg', withVo, false);
  assert.match(md, /\*\*Voiceover\*\*.*2 line\(s\)/);
  assert.match(md, /\*\*Music bed\*\*/);
  assert.match(md, /\*\*Sound effects\*\*/);
});

test('programmatic motion graphics are explicitly NOT claimed as AI imagery', () => {
  // A blanket "AI-generated" label on Remotion output would be inaccurate: no
  // generative image model produced those frames. Over-disclosing is its own
  // failure — it mislabels hand-authored work.
  const md = buildDisclosureMd('noban.gg', silent, false);
  assert.match(md, /Motion graphics/);
  assert.match(md, /[Nn]ot "AI-generated imagery"/);
});

test('real screen capture is called genuine, so it is never labelled generated', () => {
  const withCapture = buildDisclosureMd('noban.gg', withVo, true);
  assert.match(withCapture, /Product footage.*real screen recording/s);
  assert.match(withCapture, /Do not label it as generated/);
  // No capture for this brand -> the line must be absent, not a false claim.
  assert.doesNotMatch(buildDisclosureMd('noban.gg', withVo, false), /Product footage/);
});

test('the C2PA gap is stated rather than implied to be covered', () => {
  // The kit embeds no cryptographic provenance. Silence here would read as
  // coverage, which is the failure mode worth guarding against.
  const md = buildDisclosureMd('noban.gg', withVo, false);
  assert.match(md, /No C2PA credential is embedded/);
  assert.match(md, /2026-08-02/);
  assert.match(md, /Article 50/);
});

test('the TikTok private-only API trap is recorded', () => {
  // An unaudited Content Posting API integration succeeds at every call and
  // reaches nobody — a false success, which is exactly what this repo's gates
  // exist to catch.
  assert.match(buildDisclosureMd('noban.gg', withVo, false), /private-only until/);
});

test('a fully silent brand still gets a usable disclosure, not an empty one', () => {
  const md = buildDisclosureMd('noban.gg', silent, false);
  assert.doesNotMatch(md, /\*\*Voiceover\*\*/);
  assert.match(md, /if any synthetic audio is added later/);
  assert.match(md, /# noban\.gg postkit DISCLOSURE/);
});

test('every platform declares an aiDisclosure control, even when it is null', () => {
  // null is a deliberate "no mandatory toggle here" answer. A MISSING key would
  // mean the platform was added without anyone deciding, and POST.md would then
  // silently omit the step.
  for (const [key, cfg] of Object.entries(PLATFORM_MAP)) {
    assert.ok('aiDisclosure' in cfg, `${key} has no aiDisclosure decision`);
    assert.ok(cfg.aiDisclosure === null || typeof cfg.aiDisclosure === 'string');
  }
  // The three platforms with a real mandatory control must name it.
  assert.match(PLATFORM_MAP.tiktok.aiDisclosure, /AI-generated content/);
  assert.match(PLATFORM_MAP.youtube.aiDisclosure, /synthetic content/);
  assert.match(PLATFORM_MAP.instagram.aiDisclosure, /AI info/);
});
