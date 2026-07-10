import type {Act} from './launchTiming';
import {staggerDelay} from './motion';
import type {Motion} from './motion';

// Sound-design cue layer for the launch video. PURE derivation from the launchTiming
// act table (same source of truth voWindows uses), so cue frames are never stored in
// the audio manifest — they are recomputed at render time, exactly like voWindows.
//
// Three cue kinds, one reusable brand-agnostic SFX file each:
//   whoosh — a transition swish on every hard act boundary (logo->hook, hook->demo,
//            demo->feature, and between features)
//   riser  — a rising build that leads into the end-card CTA
//   tick   — a soft UI blip on each feature benefit-line reveal

export type SfxKind = 'whoosh' | 'tick' | 'riser';
export type SfxCue = {kind: SfxKind; frame: number};

type Timing = {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act};

// Frames before the end act where the riser begins (leads into the CTA).
export const RISER_LEAD = 45;

// Must track FeaturePanel.tsx: benefit line `i` reveals at
// `delayFrames = FEATURE_LINE_DELAY + staggerDelay(i, FEATURE_LINE_STAGGER, motion)`
// relative to its feature act's start. Kept in sync via staggerDelay (imported, not
// re-derived); the two literals mirror the inline constants in FeaturePanel's map.
const FEATURE_LINE_DELAY = 15;
const FEATURE_LINE_STAGGER = 10;

export const sfxCues = (
  timing: Timing,
  featureLineCounts: number[],
  motion: Motion,
): SfxCue[] => {
  const cues: SfxCue[] = [];

  // whoosh on each hard cut: into hook, into demo, into every feature act.
  cues.push({kind: 'whoosh', frame: timing.hook.from});
  cues.push({kind: 'whoosh', frame: timing.demo.from});
  for (const f of timing.features) {
    cues.push({kind: 'whoosh', frame: f.from});
  }

  // tick per benefit line, aligned to FeaturePanel's stagger onset.
  timing.features.forEach((f, fi) => {
    const count = featureLineCounts[fi] ?? 0;
    for (let li = 0; li < count; li += 1) {
      cues.push({
        kind: 'tick',
        frame: f.from + FEATURE_LINE_DELAY + Math.round(staggerDelay(li, FEATURE_LINE_STAGGER, motion)),
      });
    }
  });

  // riser building into the end-card CTA.
  cues.push({kind: 'riser', frame: timing.end.from - RISER_LEAD});

  return cues.sort((a, b) => a.frame - b.frame);
};
