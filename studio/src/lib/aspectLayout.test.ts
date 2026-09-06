import {describe, expect, it} from 'vitest';
import {captionDisplayLines, containedStage, markBox, wrapMeasuredLines} from './aspectLayout';
import {formatFor} from './layout';
import {textWidthEm} from './typography';

const DEMO_CAPTURE = {width: 1440, height: 900};
const FEATURE_STRIP = {width: 2704, height: 640};
// The demo act's narration, which is the cue the 9:16 first render orphaned.
const CUE = 'This is the whole office. One screen you work from your phone between jobs.';

describe('containedStage', () => {
  it('fits the whole capture width inside the safe area on 9:16 and 1:1', () => {
    for (const format of [formatFor(1080, 1920), formatFor(1080, 1080)]) {
      const stage = containedStage(format, DEMO_CAPTURE);
      expect(stage.left).toBe(format.safe.left);
      expect(stage.width).toBe(format.width - format.safe.left - format.safe.right);
      expect(stage.scale).toBeLessThan(1);
      // Whole plate on screen: nothing of the source is cropped away.
      expect(stage.height).toBe(Math.round(DEMO_CAPTURE.height * stage.scale));
      expect(stage.top).toBeGreaterThanOrEqual(format.safe.top);
      expect(stage.top + stage.height).toBeLessThanOrEqual(format.height - format.safe.bottom);
    }
  });

  it('keeps a titled plate clear of the title band and the burned-caption zone', () => {
    const format = formatFor(1080, 1920);
    const plain = containedStage(format, FEATURE_STRIP);
    const titled = containedStage(format, FEATURE_STRIP, {titled: true});
    expect(titled.top).toBeGreaterThan(plain.top);
    expect(titled.height).toBe(plain.height);
  });
});

describe('markBox', () => {
  it('reproduces the master box at 1920x1080 and fills a narrow canvas instead', () => {
    expect(markBox(formatFor(1920, 1080))).toBe(500);
    const portrait = formatFor(1080, 1920);
    // format.scale is the smaller axis ratio, so 500 * scale would leave the mark at a
    // quarter of a 9:16 frame; the box comes off the safe width instead.
    expect(markBox(portrait)).toBeGreaterThan(Math.round(500 * portrait.scale));
    expect(markBox(portrait)).toBeLessThan(portrait.width - portrait.safe.left - portrait.safe.right);
  });
});

describe('wrapMeasuredLines', () => {
  it('never leaves a single orphaned word on the last line', () => {
    const lines = wrapMeasuredLines(CUE, 908, 54, undefined);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[lines.length - 1].split(' ').length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(CUE);
  });

  it('keeps every line inside the measured box', () => {
    const lines = wrapMeasuredLines(CUE, 908, 54, undefined);
    for (const line of lines) expect(textWidthEm(line, undefined, 600) * 54).toBeLessThanOrEqual(908);
  });

  it('passes a single word through untouched', () => {
    expect(wrapMeasuredLines('Truckside', 908, 54)).toEqual(['Truckside']);
  });
});

describe('captionDisplayLines', () => {
  it('leaves the 16:9 master on the character-count split it was approved with', () => {
    expect(captionDisplayLines(CUE, formatFor(1920, 1080), 1690)).toEqual([
      'This is the whole office. One screen you',
      'work from your phone between jobs.',
    ]);
  });

  it('rewraps on the measured box for a portrait canvas', () => {
    const lines = captionDisplayLines(CUE, formatFor(1080, 1920), 908);
    expect(lines).not.toEqual(captionDisplayLines(CUE, formatFor(1920, 1080), 1690));
    expect(lines[lines.length - 1].split(' ').length).toBeGreaterThan(1);
  });
});
