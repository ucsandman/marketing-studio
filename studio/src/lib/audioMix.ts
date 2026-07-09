import {z} from 'zod';
import type {Act} from './launchTiming';

export const audioSchema = z.object({
  music: z.object({src: z.string(), durationMs: z.number().positive()}).nullable(),
  lines: z.array(
    z.object({
      act: z.string(),
      src: z.string(),
      durationMs: z.number().positive(),
      text: z.string(),
    }),
  ),
});

export type AudioManifest = z.infer<typeof audioSchema>;

type Timing = {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act};

const FPS = 30;
const VO_LEAD = 12;
const BASE = 0.35;
const DUCKED = 0.12;
const RAMP = 9;
const FADE_IN = 24;
const FADE_OUT = 36;

const actFor = (key: string, timing: Timing): Act => {
  if (key === 'logo' || key === 'hook' || key === 'demo' || key === 'end') return timing[key];
  const m = key.match(/^feature-(\d+)$/);
  if (m && timing.features[Number(m[1])]) return timing.features[Number(m[1])];
  throw new Error(`audio manifest references unknown act "${key}"`);
};

export const voWindows = (
  lines: AudioManifest['lines'],
  timing: Timing,
): {fromFrame: number; toFrame: number; src: string}[] =>
  lines.map((line) => {
    const act = actFor(line.act, timing);
    const fromFrame = act.from + VO_LEAD;
    const toFrame = Math.min(
      fromFrame + Math.ceil((line.durationMs / 1000) * FPS),
      act.from + act.len,
    );
    return {fromFrame, toFrame, src: line.src};
  });

export const duckedVolume = (
  frame: number,
  windows: {fromFrame: number; toFrame: number}[],
  totalFrames: number,
): number => {
  // duck factor: 1 fully inside a window, 0 outside, linear over RAMP frames
  let duck = 0;
  for (const w of windows) {
    if (frame < w.fromFrame - RAMP || frame > w.toFrame + RAMP) continue;
    let d = 1;
    if (frame < w.fromFrame) d = (frame - (w.fromFrame - RAMP)) / RAMP;
    else if (frame > w.toFrame) d = ((w.toFrame + RAMP) - frame) / RAMP;
    duck = Math.max(duck, Math.min(1, Math.max(0, d)));
  }
  const level = BASE - (BASE - DUCKED) * duck;
  const fadeIn = Math.min(1, frame / FADE_IN);
  const fadeOut = Math.min(1, (totalFrames - 1 - frame) / FADE_OUT);
  return level * Math.max(0, fadeIn) * Math.max(0, fadeOut);
};
