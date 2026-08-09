import {describe, expect, it} from 'vitest';
import {
  LEAD_HIT,
  LEAD_READ,
  alignPhraseCues,
  alignWordCues,
  normalizeToken,
  wordCueFrames,
} from './wordCues';
import {VO_LEAD} from './launchTiming';

// "See where your spend leaks." measured at 30fps.
const HOOK = {
  durationMs: 1800,
  words: [
    {w: 'See', startMs: 0, endMs: 350},
    {w: 'where', startMs: 400, endMs: 650},
    {w: 'your', startMs: 700, endMs: 950},
    {w: 'spend', startMs: 1000, endMs: 1350},
    {w: 'leaks.', startMs: 1400, endMs: 1800},
  ],
};

describe('wordCueFrames', () => {
  it('is empty when the line is absent or carries no words', () => {
    expect(wordCueFrames(undefined, 30)).toEqual([]);
    expect(wordCueFrames(null, 30)).toEqual([]);
    expect(wordCueFrames({durationMs: 1000}, 30)).toEqual([]);
  });

  it('offsets every word start by the VO lead-in', () => {
    const line = {
      durationMs: 2000,
      words: [
        {w: 'a', startMs: 0, endMs: 200},
        {w: 'b', startMs: 500, endMs: 900},
      ],
    };
    expect(wordCueFrames(line, 30)).toEqual([12, 27]);
    expect(wordCueFrames(line, 30)[0]).toBe(VO_LEAD);
  });
});

describe('normalizeToken', () => {
  it('lowercases and strips everything but [a-z0-9]', () => {
    expect(normalizeToken("Claude's")).toBe('claudes');
    expect(normalizeToken('350,')).toBe('350');
    expect(normalizeToken('  ')).toBe('');
  });
});

describe('alignWordCues', () => {
  it('locks every matched display word to its VO word, minus the read lead', () => {
    const frames = wordCueFrames(HOOK, 30);
    expect(alignWordCues(['See', 'where', 'spend', 'leaks'], HOOK, 30)).toEqual([
      frames[0] - LEAD_READ,
      frames[1] - LEAD_READ,
      frames[3] - LEAD_READ,
      frames[4] - LEAD_READ,
    ]);
  });

  it('lands exactly on the word with LEAD_HIT', () => {
    expect(alignWordCues(['See', 'spend'], HOOK, 30, {leadFrames: LEAD_HIT})).toEqual([
      wordCueFrames(HOOK, 30)[0],
      wordCueFrames(HOOK, 30)[3],
    ]);
  });

  it('clamps a lead longer than the cue frame at 0', () => {
    expect(alignWordCues(['See'], HOOK, 30, {leadFrames: 999})).toEqual([0]);
  });

  it('nulls an unmatched word, keeps the length, and still matches later words', () => {
    const out = alignWordCues(['See', 'nowhere', 'leaks'], HOOK, 30);
    expect(out).toHaveLength(3);
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(wordCueFrames(HOOK, 30)[4] - LEAD_READ);
  });

  it('gives every display word null when the line has no word table', () => {
    expect(alignWordCues(['a', 'b'], {durationMs: 900}, 30)).toEqual([null, null]);
    expect(alignWordCues(['a', 'b'], null, 30)).toEqual([null, null]);
  });

  it('takes each occurrence of a repeated word in order (the cursor never rewinds)', () => {
    const line = {
      durationMs: 2000,
      words: [
        {w: 'the', startMs: 0, endMs: 200},
        {w: 'cat', startMs: 300, endMs: 500},
        {w: 'and', startMs: 600, endMs: 800},
        {w: 'the', startMs: 900, endMs: 1100},
        {w: 'dog', startMs: 1200, endMs: 1500},
      ],
    };
    const frames = wordCueFrames(line, 30);
    expect(alignWordCues(['the', 'the'], line, 30, {leadFrames: 0})).toEqual([frames[0], frames[3]]);
  });
});

describe('alignPhraseCues', () => {
  // "Then your setup gets a six pillar score, from evidence only."
  const FEATURE = {
    durationMs: 3000,
    words: [
      {w: 'Then', startMs: 0, endMs: 250},
      {w: 'your', startMs: 300, endMs: 500},
      {w: 'setup', startMs: 550, endMs: 900},
      {w: 'gets', startMs: 950, endMs: 1200},
      {w: 'a', startMs: 1250, endMs: 1350},
      {w: 'score', startMs: 1400, endMs: 1800},
    ],
  };

  it('cues the phrase on its first non-stopword, not on "then"', () => {
    const frames = wordCueFrames(FEATURE, 30);
    const [cue] = alignPhraseCues(['Then your setup gets a score'], FEATURE, 30, {leadFrames: 0});
    expect(cue).toBe(frames[2]); // 'setup', not 'Then' (frames[0])
    expect(cue).not.toBe(frames[0]);
  });

  it('nulls a phrase whose first content word is not spoken', () => {
    expect(alignPhraseCues(['Ledger exports nightly'], FEATURE, 30)).toEqual([null]);
  });

  it('keeps phrase order in step with VO order', () => {
    const frames = wordCueFrames(FEATURE, 30);
    expect(
      alignPhraseCues(['Your setup is checked', 'It gets a score'], FEATURE, 30, {leadFrames: 0}),
    ).toEqual([frames[2], frames[3]]);
  });

  it('gives every phrase null when the line has no word table', () => {
    expect(alignPhraseCues(['a', 'b'], {durationMs: 900}, 30)).toEqual([null, null]);
  });
});
