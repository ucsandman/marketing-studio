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

const FPS = 30;
const LOGO_LEN = 150;
const HOOK_LEN = 186;
const DEMO_FALLBACK_LEN = 240;
const DEMO_TAIL = 24;
const FEATURE_LEN = 180;
const END_LEN = 150;

export const launchTiming = (
  telemetryDurationMs: number | null,
  featureCount: number,
  lengths?: ActLengths | null,
): {logo: Act; hook: Act; demo: Act; features: Act[]; end: Act; total: number} => {
  const l = lengths ?? {};
  const demoLen = telemetryDurationMs
    ? Math.ceil((telemetryDurationMs / 1000) * FPS) + (l.demoTail ?? DEMO_TAIL)
    : DEMO_FALLBACK_LEN;
  let cursor = 0;
  const next = (len: number): Act => {
    const act = {from: cursor, len};
    cursor += len;
    return act;
  };
  const logo = next(l.logo ?? LOGO_LEN);
  const hook = next(l.hook ?? HOOK_LEN);
  const demo = next(demoLen);
  const features = Array.from({length: featureCount}, (_, i) =>
    next(l.features?.[i] ?? FEATURE_LEN),
  );
  const end = next(l.end ?? END_LEN);
  return {logo, hook, demo, features, end, total: cursor};
};
