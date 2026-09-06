import type {Act} from './launchTiming.ts';
import {staggerDelay, type Motion} from './motion.ts';

// Sound-design cue layer for the launch video. PURE derivation from the launchTiming
// act table (same source of truth voWindows uses), so cue frames are never stored in
// the audio manifest — they are recomputed at render time, exactly like voWindows.
//
// Five cue kinds, one reusable SFX file each:
//   whoosh     — a transition swish on every hard act boundary (logo->hook, hook->demo,
//                demo->feature, and between features)
//   riser      — a rising build that leads into the end-card CTA
//   tick       — a soft UI blip on each feature benefit-line reveal
//   paper-tick — a quiet paper tick, used by foldCues() below for a fold beat
//   clunk      — a single low clunk, used by foldCues() below for a count-lock beat
// whoosh/riser/tick are brand-agnostic (used by sfxCues()); paper-tick/clunk are for
// quiet-register brands whose direction forbids whoosh/riser (used by foldCues()).

export type SfxKind = 'whoosh' | 'tick' | 'riser' | 'paper-tick' | 'clunk';
export type SfxCue = {kind: SfxKind; frame: number; gain?: number; eventId?: string};

export type PictureAudio = {
  entry?: 'none' | 'soft' | 'impact';
  music?: 'hold' | 'lift' | 'resolve';
  events?: Array<{
    id: string;
    frame: number;
    kind: 'reveal' | 'focus' | 'confirm';
    intensity?: 'low' | 'mid';
  }>;
};

export type AudioShot = {
  id: string;
  from: number;
  len: number;
  // Voice placement is independent from visual source/id. null means this shot
  // deliberately carries no narration; undefined preserves the legacy id mapping.
  audioRef?: string | null;
  audio?: PictureAudio;
};

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
  featureCueFrames?: (number | null)[][],
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
      const measured = featureCueFrames?.[fi]?.[li];
      cues.push({
        kind: 'tick',
        frame:
          measured == null
            ? f.from + FEATURE_LINE_DELAY + Math.round(staggerDelay(li, FEATURE_LINE_STAGGER, motion))
            : f.from + measured,
      });
    }
  });

  // riser building into the end-card CTA.
  cues.push({kind: 'riser', frame: timing.end.from - RISER_LEAD});

  return cues.sort((a, b) => a.frame - b.frame);
};

/**
 * Sparse cue table for the shot-plan pipeline. Unlike sfxCues(), a cut alone is
 * silent: only an explicit picture event or entry direction produces a sound.
 * Event frames are shot-local and clamped so malformed direction cannot leak a cue
 * into the next shot. Music markers stay metadata for the post-render score.
 */
export const pictureEventCues = (shots: AudioShot[]): SfxCue[] => {
  const cues: SfxCue[] = [];
  for (const shot of shots) {
    if (shot.audio?.entry && shot.audio.entry !== 'none') {
      cues.push({
        kind: 'whoosh',
        frame: shot.from,
        gain: shot.audio.entry === 'soft' ? 0.55 : 0.8,
        eventId: `${shot.id}:entry`,
      });
    }
    for (const event of shot.audio?.events ?? []) {
      if (!Number.isFinite(event.frame) || event.frame < 0 || event.frame >= shot.len) continue;
      cues.push({
        kind: 'tick',
        frame: shot.from + Math.round(event.frame),
        gain: event.intensity === 'mid' ? 0.9 : 0.65,
        eventId: `${shot.id}:${event.id}`,
      });
    }
  }
  return cues.sort((a, b) => a.frame - b.frame);
};

// Quiet-register alternative to sfxCues(): no whoosh (hard-cut transitions), no riser
// (CTA build) — just the two beats a "narration leads, music is a bed" direction asks
// for. `hookFrom` is the hook act's absolute start frame (timing.hook.from); `beats`
// is the [foldFrame, headlineFrame] pair LaunchVideo already computes via
// alignPhraseCues for GalleyFold (word-locked to the fold word and the count word), so
// the tick lands exactly on the paper fold and the clunk exactly on the count landing.
// A null beat (no word-cued hook line) is skipped rather than guessed.
export const foldCues = (hookFrom: number, beats: (number | null)[]): SfxCue[] => {
  const cues: SfxCue[] = [];
  if (beats[0] != null) cues.push({kind: 'paper-tick', frame: hookFrom + beats[0]});
  if (beats[1] != null) cues.push({kind: 'clunk', frame: hookFrom + beats[1]});
  return cues.sort((a, b) => a.frame - b.frame);
};
