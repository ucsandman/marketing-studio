import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ansiLineToHtml, PALETTE, resolveGroups, toLines} from './ansi-replay.mjs';

const ESC = String.fromCharCode(27);
const fresh = () => ({bold: false, dim: false, fg: null});

test('bold text renders as ink at weight 700', () => {
  const html = ansiLineToHtml(`${ESC}[1mCostClaw audit${ESC}[22m`, fresh());
  assert.match(html, /color:#251d1a;font-weight:700">CostClaw audit</);
});

test('dim text renders muted, not bold', () => {
  const html = ansiLineToHtml(`${ESC}[2mSource: logs${ESC}[22m`, fresh());
  assert.match(html, /color:#6f5f58">Source: logs</);
  assert.doesNotMatch(html, /font-weight/);
});

test('the brand accent becomes umber, never clay: colored text is umber', () => {
  const html = ansiLineToHtml(`${ESC}[1;38;5;209m11.0% of analyzed usage${ESC}[0m`, fresh());
  assert.match(html, new RegExp(`color:${PALETTE.umber};font-weight:700`));
  assert.doesNotMatch(html, /e07a5f/);
});

test('score-band numbers read as umber but bar glyphs keep the band color', () => {
  const line = `${ESC}[38;5;29m82 / 100${ESC}[39m [${ESC}[38;5;29m###${ESC}[39m${ESC}[2m..${ESC}[22m]`;
  const html = ansiLineToHtml(line, fresh());
  assert.match(html, new RegExp(`color:${PALETTE.umber};font-weight:700">82 / 100<`));
  assert.match(html, /color:#3f7d4e">###</); // svg.ts bandColorForScore, dialed in
  assert.match(html, new RegExp(`color:${PALETTE.track}">\\.\\.<`)); // empty track, not muted prose
  assert.equal(PALETTE.track, '#cbb8ae'); // survives the stage's brightness grade
});

test('style state carries across lines like a real terminal', () => {
  const state = fresh();
  ansiLineToHtml(`${ESC}[2mopen dim`, state);
  assert.equal(state.dim, true);
  assert.match(ansiLineToHtml('still dim', state), /color:#6f5f58">still dim</);
});

test('groups resolve from content markers and trim trailing blanks', () => {
  const lines = toLines(['head', 'Overall setup score: 82', 'pillar a', 'pillar b', '', 'Top fixes', 'fix'].join('\n'));
  const [g] = resolveGroups(lines, [{id: 'beat-score', start: 'Overall setup score', endBefore: 'Top fixes'}]);
  assert.deepEqual(g, {id: 'beat-score', start: 1, end: 3});
});

test('a missing marker fails loudly instead of guessing a range', () => {
  assert.throws(
    () => resolveGroups(['a', 'b'], [{id: 'beat-x', start: 'a', endBefore: 'nope'}]),
    /endBefore marker not found/,
  );
});
