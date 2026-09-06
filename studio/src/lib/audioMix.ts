import {z} from 'zod';
import {VO_LEAD, type Act} from './launchTiming.ts';
import type {AudioShot, SfxCue, SfxKind} from './sfxCues';

// Word-level VO timestamps (feeders/audio/client.mjs --timestamps, or the
// even-distribution `words` fallback). OPTIONAL and never defaulted: `undefined`
// means "this line has no measured timings", which is the signal launchTiming and
// the cue helpers gate on. Every manifest written before this feature parses
// unchanged and keeps rendering byte-identically.
export const wordSchema = z.object({
  w: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
export type Word = z.infer<typeof wordSchema>;

export const audioSchema = z.object({
  music: z
    .object({
      src: z.string(),
      durationMs: z.number().positive(),
      // Edit markers are picture-time requests. score-film measures the actual bed
      // and reports the nearest detected beat; it never invents a BPM.
      markers: z
        .array(
          z.object({
            id: z.string().min(1),
            frame: z.number().int().nonnegative(),
            kind: z.enum(['hold', 'lift', 'resolve']),
          }),
        )
        .optional(),
    })
    .nullable(),
  lines: z.array(
    z.object({
      act: z.string(),
      src: z.string(),
      durationMs: z.number().positive(),
      text: z.string(),
      words: z.array(wordSchema).optional(),
      // true when the times came from even distribution over the mp3 rather than
      // from the TTS alignment. Sync is approximate; judge-av-sync warns.
      wordsEstimated: z.boolean().optional(),
    }),
  ),
  // Optional sound-design cue layer. Absent (the default for every existing
  // manifest) => no sfx layers => renders stay byte-identical. `enabled` is set by
  // the brand audio builder only after the shared sfx library is staged to
  // studio/public/sfx/, so it doubles as the file-presence gate; cue FRAMES are
  // never stored here, they are derived at render time from launchTiming (sfxCues).
  sfx: z.object({enabled: z.boolean()}).optional(),
});

export type AudioManifest = z.infer<typeof audioSchema>;

type Timing = {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act};

const FPS = 30;
// Frames of music-only lead-in before each VO line starts. Owned by launchTiming.ts
// (the VO-driven act length is built from it) and re-exported here so
// captionTiming.ts and every existing `import {VO_LEAD} from './audioMix'` site
// places captions on the exact same window as the spoken audio.
export {VO_LEAD};
const BASE = 0.35;
const DUCKED = 0.12;
const RAMP = 9;
export const FADE_IN = 24;
export const FADE_OUT = 36;

const actFor = (key: string, timing: Timing): Act => {
  if (key === 'logo' || key === 'hook' || key === 'demo' || key === 'end') return timing[key];
  const m = key.match(/^feature-(\d+)$/);
  if (m && timing.features[Number(m[1])]) return timing.features[Number(m[1])];
  throw new Error(`audio manifest references unknown act "${key}"`);
};

/** Map stable shot ids back to the act-keyed audio contract after shot reordering. */
export const timingFromShots = (shots: AudioShot[], requiredActs?: string[]): Timing => {
  const byId = new Map<string, Act>();
  for (const shot of shots) {
    const audioRef = shot.audioRef === undefined ? shot.id : shot.audioRef;
    if (audioRef == null) continue;
    if (byId.has(audioRef)) throw new Error(`shot plan assigns audio act "${audioRef}" more than once`);
    byId.set(audioRef, {from: shot.from, len: shot.len});
  }
  for (const id of requiredActs ?? []) {
    if (!byId.has(id)) throw new Error(`shot plan is missing audio act "${id}"`);
  }
  // Zero-length sentinels keep the long-standing full Timing shape compatible with
  // captionCues. They are never read because every manifest act is validated above.
  const empty = {from: 0, len: 0};
  const featureIndexes = [...byId.keys()]
    .map((id) => id.match(/^feature-(\d+)$/))
    .filter((match): match is RegExpMatchArray => match != null)
    .map((match) => Number(match[1]));
  const features = Array.from({length: Math.max(-1, ...featureIndexes) + 1}, (_, i) => byId.get(`feature-${i}`) ?? empty);
  return {
    logo: byId.get('logo') ?? empty,
    hook: byId.get('hook') ?? empty,
    demo: byId.get('demo') ?? empty,
    features,
    end: byId.get('end') ?? empty,
  };
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

// --- Sound-design cue layer ------------------------------------------------
// Static file per cue kind, staged under studio/public/ by scripts/build-sfx.mjs.
export const SFX_SRC: Record<SfxKind, string> = {
  whoosh: 'sfx/whoosh.mp3',
  tick: 'sfx/tick.mp3',
  riser: 'sfx/riser.mp3',
  'paper-tick': 'sfx/paper-tick.mp3',
  clunk: 'sfx/clunk.mp3',
};

// Cue volumes sit under full-scale VO (VO Audios play at 1.0) and track the music
// ducking constants: transitions/riser near the music BASE, the soft UI tick at the
// ducked-music floor so it reads as an accent, never a competing element.
const SFX_TRANSITION = BASE; // whoosh + riser build
export const SFX_VOLUME: Record<SfxKind, number> = {
  whoosh: SFX_TRANSITION,
  riser: SFX_TRANSITION,
  tick: DUCKED,
  // Fold beat + count-lock: both sit at the ducked-music floor, same as tick — quiet
  // accents, never competing with the narration (direction.md: "soft paper tick",
  // "single low clunk").
  'paper-tick': DUCKED,
  clunk: DUCKED,
};

export type SfxLayer = {src: string; frame: number; volume: number};

// Pure: maps derived cues to the <Audio> layers the SoundTrack renders, dropping any
// whose file the caller reports missing (nullable-asset / silent-skip rule). At render
// time presence is guaranteed by the manifest's `sfx.enabled` gate; the fileExists
// hook keeps the resolution unit-testable and future-proofs a real per-file check.
export const resolveSfxLayers = (
  cues: SfxCue[],
  fileExists: (src: string) => boolean,
): SfxLayer[] =>
  cues
    .map((c) => ({
      src: SFX_SRC[c.kind],
      frame: c.frame,
      volume: SFX_VOLUME[c.kind] * (c.gain ?? 1),
    }))
    .filter((layer) => fileExists(layer.src));
