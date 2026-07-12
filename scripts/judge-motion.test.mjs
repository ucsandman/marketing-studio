import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scanSource, checkMotionTokens, stripComments} from './judge-motion.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'judge-motion.mjs');

function findingsFor(check, findings) {
  return findings.filter((f) => f.check === check);
}

// --- source rules -------------------------------------------------------

test('Easing.in( fires ease-in ERROR with the line number', () => {
  const findings = scanSource('const a = 1;\nconst e = Easing.in(Easing.quad);\n', 'studio/src/components/X.tsx');
  const hits = findingsFor('ease-in', findings);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, 'ERROR');
  assert.equal(hits[0].line, 2);
});

test('Easing.inOut( does not fire ease-in', () => {
  const findings = scanSource('const e = Easing.inOut(Easing.quad);', 'studio/src/components/X.tsx');
  assert.equal(findingsFor('ease-in', findings).length, 0);
});

test('Easing.out( does not fire ease-in', () => {
  const findings = scanSource('const e = Easing.out(Easing.exp);', 'studio/src/components/X.tsx');
  assert.equal(findingsFor('ease-in', findings).length, 0);
});

test('scale(0) in a transform string fires scale-zero ERROR', () => {
  const findings = scanSource("const s = {transform: 'scale(0)'};", 'studio/src/components/X.tsx');
  assert.equal(findingsFor('scale-zero', findings).length, 1);
});

test('scale: 0 object style fires scale-zero', () => {
  const findings = scanSource('const s = {scale: 0, opacity: 1};', 'studio/src/components/X.tsx');
  assert.equal(findingsFor('scale-zero', findings).length, 1);
});

test('scale(0.95) and interpolated scale do not fire scale-zero', () => {
  const clean = [
    "const s = {transform: 'scale(0.95)'};",
    'const t = `scale(${0.9 * scale}) translateY(-28px)`;',
    'const u = {transform: `scale(${cam.scale})`};',
  ].join('\n');
  assert.equal(findingsFor('scale-zero', scanSource(clean, 'studio/src/components/X.tsx')).length, 0);
});

test('CSS transition fires css-transition ERROR', () => {
  const findings = scanSource("const s = {transition: 'transform 200ms ease-out'};", 'studio/src/components/X.tsx');
  assert.equal(findingsFor('css-transition', findings).length, 1);
});

test('@keyframes and animation: fire css-keyframes', () => {
  const findings = scanSource("const css = '@keyframes slideIn {}';\nconst s = {animation: 'slideIn 1s'};", 'studio/src/components/X.tsx');
  assert.equal(findingsFor('css-keyframes', findings).length, 2);
});

test('raw spring( outside lib/motion.ts fires WARN raw-spring', () => {
  const findings = scanSource('const v = spring({frame, fps, config: {damping: 200}});', 'studio/src/components/X.tsx');
  const hits = findingsFor('raw-spring', findings);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, 'WARN');
});

test('brandSpring( does not fire raw-spring', () => {
  const findings = scanSource('const v = brandSpring(frame, fps, brand.motion);', 'studio/src/components/X.tsx');
  assert.equal(findingsFor('raw-spring', findings).length, 0);
});

test('spring( inside lib/motion.ts is exempt', () => {
  const findings = scanSource('return spring({frame, fps, config});', 'studio/src/lib/motion.ts');
  assert.equal(findingsFor('raw-spring', findings).length, 0);
});

test('rule text inside comments never fires', () => {
  const commented = [
    '// transition: transform 200ms would be wrong here',
    '/* Easing.in( is forbidden */',
    '/*',
    ' * scale(0) discussion in a block comment',
    ' */',
    'const ok = 1;',
  ].join('\n');
  assert.equal(scanSource(commented, 'studio/src/components/X.tsx').length, 0);
});

test('stripComments keeps line count stable for accurate line numbers', () => {
  const text = 'a\n/* b\nc */\nd';
  assert.equal(stripComments(text).length, text.split('\n').length);
});

// --- brand token bands ----------------------------------------------------

test('exuberance above 0.85 fires WARN exuberance-band', () => {
  const findings = checkMotionTokens({exuberance: 0.9, tempo: 1}, 'testbrand');
  const hits = findingsFor('exuberance-band', findings);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, 'WARN');
  assert.equal(hits[0].file, 'brands/testbrand.json');
});

test('tempo outside [0.5, 2] fires WARN tempo-band', () => {
  assert.equal(findingsFor('tempo-band', checkMotionTokens({tempo: 2.5}, 't')).length, 1);
  assert.equal(findingsFor('tempo-band', checkMotionTokens({tempo: 0.4}, 't')).length, 1);
});

test('in-band motion block produces no findings', () => {
  assert.equal(checkMotionTokens({tempo: 1.15, exuberance: 0.3, stagger: 0.6, overshoot: 0.2}, 't').length, 0);
});

test('missing motion block (zod defaults) produces no findings', () => {
  assert.equal(checkMotionTokens(undefined, 't').length, 0);
});

// --- CLI ------------------------------------------------------------------

test('CLI passes on the real repo and exits 0', () => {
  const stdout = execFileSync('node', [cli], {encoding: 'utf8'});
  assert.match(stdout, /judge-motion: PASS/);
});

test('CLI --strict still exits 0 while the repo is clean', () => {
  const stdout = execFileSync('node', [cli, '--strict'], {encoding: 'utf8'});
  assert.match(stdout, /PASS/);
});
