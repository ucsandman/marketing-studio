export type Act = {from: number; len: number};

// Per-render act-length overrides. Every field is optional and falls back to the
// shared constant below, so an absent (or empty) override reproduces the default
// layout exactly — a brand whose approved narration needs more room can widen its
// own acts without moving any other brand's picture lock. The FORMULA still lives
// only here; only the lengths are injectable.
export type ActLengths = {
  logo?: number;
  hook?: number;
  // Per-feature lengths, index-aligned with the features array; missing entries
  // fall back to FEATURE_LEN.
  features?: number[];
  end?: number;
  demoTail?: number;
};

// Frames of music-only lead-in before each VO line starts. Owned here because the
// VO-driven act length is built from it; audioMix.ts re-exports it so every existing
// import site (captionTiming.ts, scripts) is unchanged.
export const VO_LEAD = 12;

// Tail hold after a line: the breath that makes the next beat land (~0.4s at 30fps).
export const VO_PAD = 12;

const FPS = 30;
const LOGO_LEN = 150;
const HOOK_LEN = 186;
const DEMO_FALLBACK_LEN = 240;
const DEMO_TAIL = 24;
const FEATURE_LEN = 180;
const END_LEN = 150;

// Measured VO milliseconds per act, from the audio manifest. Every field optional
// and nullable: an act with no VO line keeps its constant/override length.
export type VoTiming = {
  padFrames?: number; // default VO_PAD
  logo?: number | null;
  hook?: number | null;
  demo?: number | null;
  features?: (number | null)[];
  end?: number | null;
};

/**
 * Act length that fits a measured VO line: the music-only lead-in, the spoken
 * frames, and the tail hold. THE formula — never re-derived anywhere else.
 */
export const voActLen = (voMs: number, padFrames: number = VO_PAD, fps: number = FPS): number =>
  VO_LEAD + Math.ceil((voMs / 1000) * fps) + padFrames;

// Structural shape of an audio-manifest line (declared here so this module stays
// zod-free; AudioManifest['lines'][number] satisfies it).
export type VoLineLike = {act: string; durationMs: number; words?: unknown[]};

/**
 * Audio-manifest lines -> VoTiming, or null when VO-driven timing must not engage.
 * Returns null when: lines is null/empty, or (force !== true and NO line carries a
 * `words` array). force === false pins the constants regardless of words.
 * Unknown act keys are ignored here — audioMix.voWindows already throws on them at
 * render, and judge-av-sync reports them; calculateMetadata is the wrong place to die.
 */
export const voTimingFrom = (
  lines: VoLineLike[] | null | undefined,
  featureCount: number,
  opts?: {force?: boolean | null; padFrames?: number},
): VoTiming | null => {
  if (!lines || lines.length === 0) return null;
  if (opts?.force === false) return null;
  const hasWords = lines.some((l) => Array.isArray(l.words) && l.words.length > 0);
  if (opts?.force !== true && !hasWords) return null;
  const msFor = (act: string): number | null =>
    lines.find((l) => l.act === act)?.durationMs ?? null;
  return {
    ...(opts?.padFrames != null ? {padFrames: opts.padFrames} : {}),
    logo: msFor('logo'),
    hook: msFor('hook'),
    demo: msFor('demo'),
    features: Array.from({length: featureCount}, (_, i) => msFor(`feature-${i}`)),
    end: msFor('end'),
  };
};

export const launchTiming = (
  telemetryDurationMs: number | null,
  featureCount: number,
  lengths?: ActLengths | null,
  vo?: VoTiming | null,
): {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act; total: number} => {
  const l = lengths ?? {};
  const pad = vo?.padFrames ?? VO_PAD;
  const telemetryLen = telemetryDurationMs
    ? Math.ceil((telemetryDurationMs / 1000) * FPS) + (l.demoTail ?? DEMO_TAIL)
    : DEMO_FALLBACK_LEN;
  // The demo act's picture is a telemetry recording: widen it to fit narration,
  // never shorten it to fit narration.
  const demoLen = Math.max(telemetryLen, vo?.demo != null ? voActLen(vo.demo, pad) : 0);
  let cursor = 0;
  const next = (len: number): Act => {
    const act = {from: cursor, len};
    cursor += len;
    return act;
  };
  const logo = next(l.logo ?? (vo?.logo != null ? voActLen(vo.logo, pad) : LOGO_LEN));
  const hook = next(l.hook ?? (vo?.hook != null ? voActLen(vo.hook, pad) : HOOK_LEN));
  const demo = next(demoLen);
  const features = Array.from({length: featureCount}, (_, i) => {
    const voMs = vo?.features?.[i];
    return next(l.features?.[i] ?? (voMs != null ? voActLen(voMs, pad) : FEATURE_LEN));
  });
  const end = next(l.end ?? (vo?.end != null ? voActLen(vo.end, pad) : END_LEN));
  return {logo, hook, demo, features, end, total: cursor};
};
