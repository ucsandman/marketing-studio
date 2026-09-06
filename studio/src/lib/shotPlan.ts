import {z} from 'zod';
import type {CameraSubject, ShotScale} from './camera.ts';
import {directionSchema, directionSpecSchema, resolveDirection, shotScaleSchema} from './direction.ts';
import type {Direction, DirectionSpecInput} from './direction.ts';
import {launchTiming} from './launchTiming.ts';
import type {ActLengths, VoTiming} from './launchTiming.ts';

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('logo')}),
  z.object({kind: z.literal('hook')}),
  z.object({
    kind: z.literal('demo'),
    sourceStartFrame: z.number().int().nonnegative().default(0),
    sourceEndFrame: z.number().int().positive().optional(),
  }),
  z.object({kind: z.literal('feature'), index: z.number().int().nonnegative()}),
  z.object({kind: z.literal('end')}),
  z.object({
    kind: z.literal('asset'),
    path: z.string().min(1),
    media: z.enum(['image', 'video']),
    sourceStartFrame: z.number().int().nonnegative().default(0),
    sourceEndFrame: z.number().int().positive().optional(),
  }),
]);

const cameraSubjectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export const shotAudioSchema = z.object({
  entry: z.enum(['none', 'soft', 'impact']).optional(),
  music: z.enum(['hold', 'lift', 'resolve']).optional(),
  events: z
    .array(
      z.object({
        id: z.string().min(1),
        frame: z.number().int().nonnegative(),
        kind: z.enum(['reveal', 'focus', 'confirm']),
        intensity: z.enum(['low', 'mid']).optional(),
      }),
    )
    .optional(),
});

export const launchShotInputSchema = z.object({
  id: z.string().min(1),
  source: sourceSchema,
  purpose: z.enum(['establish', 'problem', 'mechanism', 'proof', 'detail', 'benefit', 'resolve', 'cta']),
  durationFrames: z.number().int().positive().optional(),
  scale: shotScaleSchema.optional(),
  focus: cameraSubjectSchema.optional(),
  sourceViewport: z.object({width: z.number().positive(), height: z.number().positive()}).optional(),
  // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
  transition: z
    .object({kind: z.enum(['cut', 'dissolve', 'wipe']), frames: z.number().int().nonnegative()})
    .optional(),
  matchFrom: z
    .object({shotId: z.string().min(1), mode: z.enum(['subject', 'motion', 'color', 'none'])})
    .nullable()
    .optional(),
  onScreenText: z.object({maxChars: z.number().int().positive(), minHoldFrames: z.number().int().nonnegative()}).optional(),
  copy: z.object({title: z.string().min(1), supporting: z.string().min(1).nullable().default(null)}).optional(),
  readability: z.object({safeArea: z.boolean(), minContrast: z.number().min(1).max(21)}).optional(),
  hero: z.boolean().optional(),
  endingHoldFrames: z.number().int().nonnegative().optional(),
  audioRef: z.string().min(1).nullable().optional(),
  audio: shotAudioSchema.optional(),
  references: z.array(z.string().min(1)).optional(),
});

export type LaunchShotInput = z.infer<typeof launchShotInputSchema>;

export type LaunchShot = Omit<LaunchShotInput, 'durationFrames' | 'scale' | 'focus'> & {
  from: number;
  len: number;
  durationFrames: number;
  scale: ShotScale;
  focus?: CameraSubject;
  sourceRef: string;
  camera: {cadence: Direction['camera']['cadence']};
  transition: {kind: Direction['edit']['transition']; frames: number};
  matchFrom: {shotId: string; mode: 'subject' | 'motion' | 'color' | 'none'} | null;
  onScreenText: {maxChars: number; minHoldFrames: number};
  readability: {safeArea: boolean; minContrast: number};
  hero: boolean;
  endingHoldFrames: number;
  references: string[];
};

const launchShotSchema = launchShotInputSchema.extend({
  from: z.number().int().nonnegative(),
  len: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
  scale: shotScaleSchema,
  sourceRef: z.string().min(1),
  camera: z.object({cadence: z.enum(['locked', 'measured', 'kinetic'])}),
  // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
  transition: z.object({kind: z.enum(['cut', 'dissolve', 'wipe']), frames: z.number().int().nonnegative()}),
  matchFrom: z.object({shotId: z.string(), mode: z.enum(['subject', 'motion', 'color', 'none'])}).nullable(),
  onScreenText: z.object({maxChars: z.number().int().positive(), minHoldFrames: z.number().int().nonnegative()}),
  readability: z.object({safeArea: z.boolean(), minContrast: z.number().min(1).max(21)}),
  hero: z.boolean(),
  endingHoldFrames: z.number().int().nonnegative(),
  references: z.array(z.string()),
});

export const launchShotPlanSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['legacy', 'directed']),
  direction: directionSchema.nullable(),
  timing: z.object({
    logo: z.object({from: z.number(), len: z.number()}),
    hook: z.object({from: z.number(), len: z.number()}),
    demo: z.object({from: z.number(), len: z.number()}),
    features: z.array(z.object({from: z.number(), len: z.number()})),
    end: z.object({from: z.number(), len: z.number()}),
    total: z.number(),
  }),
  shots: z.array(launchShotSchema),
  total: z.number().int().positive(),
});

export type LaunchShotPlan = z.infer<typeof launchShotPlanSchema>;

const shot = (
  id: string,
  source: LaunchShotInput['source'],
  purpose: LaunchShotInput['purpose'],
  extras: Partial<LaunchShotInput> = {},
): LaunchShotInput => ({id, source, purpose, ...extras});

/** A preset's real editorial sequence. Callers can replace it with authored shots. */
export const defaultDirectedShots = (
  direction: Direction,
  featureCount: number,
  telemetryDurationMs: number | null,
  fps: number = 30,
): LaunchShotInput[] => {
  const features = Array.from({length: featureCount}, (_, index) =>
    shot(`feature-${index}`, {kind: 'feature', index}, index === 0 ? 'proof' : 'benefit', {
      scale: index === 0 ? direction.camera.proofScale : direction.camera.detailScale,
      audioRef: `feature-${index}`,
      audio: index === 0 ? {entry: 'soft', music: 'lift'} : undefined,
    }),
  );
  if (direction.intro.kind === 'proof-first') {
    return [
      shot('hook', {kind: 'hook'}, 'problem', {scale: 'close', audioRef: 'hook'}),
      shot('demo', {kind: 'demo', sourceStartFrame: 0}, 'establish', {scale: direction.camera.establishingScale, hero: true, audioRef: 'demo'}),
      ...features,
      shot('logo', {kind: 'logo'}, 'resolve', {durationFrames: direction.intro.holdFrames, audioRef: 'logo'}),
      shot('end', {kind: 'end'}, 'cta', {audioRef: 'end', endingHoldFrames: direction.outro.holdFrames, audio: {music: 'resolve'}}),
    ];
  }
  if (direction.intro.kind === 'cold-open') {
    const demoFrames = Math.max(fps * 2, Math.ceil(((telemetryDurationMs ?? 8000) / 1000) * fps));
    return [
      shot('hook', {kind: 'hook'}, 'problem', {scale: 'close', audioRef: 'hook', audio: {entry: 'impact'}}),
      shot('demo-wide', {kind: 'demo', sourceStartFrame: 0, sourceEndFrame: Math.ceil(demoFrames * 0.56)}, 'establish', {durationFrames: Math.ceil(demoFrames * 0.56), scale: 'wide', hero: true, audioRef: 'demo'}),
      ...(features.length ? [features[0]] : []),
      shot('demo-detail', {kind: 'demo', sourceStartFrame: Math.floor(demoFrames * 0.56), sourceEndFrame: demoFrames}, 'detail', {
        durationFrames: Math.ceil(demoFrames * 0.44), scale: 'detail', matchFrom: {shotId: 'demo-wide', mode: 'subject'}, audioRef: null,
      }),
      ...features.slice(1),
      shot('logo', {kind: 'logo'}, 'resolve', {durationFrames: direction.intro.holdFrames, audioRef: 'logo'}),
      shot('end', {kind: 'end'}, 'cta', {audioRef: 'end', endingHoldFrames: direction.outro.holdFrames, audio: {music: 'resolve'}}),
    ];
  }
  return [shot('logo', {kind: 'logo'}, 'establish', {durationFrames: direction.intro.holdFrames, audioRef: 'logo'}), shot('hook', {kind: 'hook'}, 'problem', {audioRef: 'hook'}), shot('demo', {kind: 'demo', sourceStartFrame: 0}, 'mechanism', {hero: true, audioRef: 'demo'}), ...features.map((f, i) => ({...f, audioRef: `feature-${i}`})), shot('end', {kind: 'end'}, 'cta', {audioRef: 'end', endingHoldFrames: direction.outro.holdFrames})];
};

type BuildPlanInput = {
  telemetryDurationMs: number | null;
  featureCount: number;
  lengths?: ActLengths | null;
  vo?: VoTiming | null;
  direction?: DirectionSpecInput | null;
  shots?: LaunchShotInput[] | null;
  fps?: number;
  demoViewport?: {width: number; height: number} | null;
};

const sourceRef = (source: LaunchShotInput['source']): string => {
  if (source.kind === 'feature') return `feature-${source.index}`;
  if (source.kind === 'asset') return `asset:${source.path}`;
  return source.kind;
};

/** The sole timeline normalizer used by render metadata, picture, sound and gates. */
export const buildLaunchShotPlan = (input: BuildPlanInput): LaunchShotPlan => {
  const fps = input.fps ?? 30;
  const timing = launchTiming(input.telemetryDurationMs, input.featureCount, input.lengths, input.vo);
  const direction = input.direction ? resolveDirection(directionSpecSchema.parse(input.direction)) : null;
  const legacy = !direction && !input.shots?.length;
  const legacyInputs: LaunchShotInput[] = [
    shot('logo', {kind: 'logo'}, 'establish', {durationFrames: timing.logo.len, audioRef: 'logo'}),
    shot('hook', {kind: 'hook'}, 'problem', {durationFrames: timing.hook.len, audioRef: 'hook'}),
    shot('demo', {kind: 'demo', sourceStartFrame: 0}, 'mechanism', {durationFrames: timing.demo.len, hero: true, audioRef: 'demo'}),
    ...timing.features.map((feature, index) =>
      shot(`feature-${index}`, {kind: 'feature', index}, index === 0 ? 'proof' : 'benefit', {
        durationFrames: feature.len,
        audioRef: `feature-${index}`,
      }),
    ),
    shot('end', {kind: 'end'}, 'cta', {durationFrames: timing.end.len, audioRef: 'end'}),
  ];
  const sourceInputs = input.shots?.length
    ? input.shots.map((entry) => launchShotInputSchema.parse(entry))
    : direction
      ? defaultDirectedShots(direction, input.featureCount, input.telemetryDurationMs, fps)
      : legacyInputs;
  const seen = new Set<string>();
  let cursor = 0;
  let previousOverlap = 0;
  let previousLen = 0;
  const demoFrames = input.telemetryDurationMs == null ? null : Math.ceil((input.telemetryDurationMs / 1000) * fps);
  const shots: LaunchShot[] = sourceInputs.map((entry, index) => {
    if (seen.has(entry.id)) throw new Error(`Duplicate launch shot id "${entry.id}".`);
    if (entry.matchFrom && !seen.has(entry.matchFrom.shotId)) {
      throw new Error(`Shot "${entry.id}" matchFrom must name an earlier shot.`);
    }
    if (entry.source.kind === 'feature' && entry.source.index >= input.featureCount) {
      throw new Error(`Shot "${entry.id}" references missing feature ${entry.source.index}.`);
    }
    const sourceStart = 'sourceStartFrame' in entry.source ? entry.source.sourceStartFrame : 0;
    const sourceEnd = 'sourceEndFrame' in entry.source ? entry.source.sourceEndFrame : undefined;
    if (sourceEnd != null && sourceEnd <= sourceStart) {
      throw new Error(`Shot "${entry.id}" sourceEndFrame must exceed sourceStartFrame.`);
    }
    if (entry.source.kind === 'demo' && demoFrames != null && (sourceStart >= demoFrames || (sourceEnd ?? 0) > demoFrames)) {
      throw new Error(`Shot "${entry.id}" exceeds the ${demoFrames}-frame demo source.`);
    }
    const sourceLen = sourceEnd == null ? null : sourceEnd - sourceStart;
    const demoRemaining = entry.source.kind === 'demo' && demoFrames != null ? demoFrames - sourceStart : null;
    const fallback = entry.source.kind === 'logo' ? timing.logo.len : entry.source.kind === 'hook' ? timing.hook.len : entry.source.kind === 'demo' ? timing.demo.len : entry.source.kind === 'feature' ? timing.features[entry.source.index]?.len ?? 180 : entry.source.kind === 'end' ? timing.end.len : fps * 5;
    const requested = entry.durationFrames ?? sourceLen ?? demoRemaining ?? fallback;
    const available = sourceLen ?? demoRemaining;
    if (!legacy && requested < 24) throw new Error(`Shot "${entry.id}" must be at least 24 frames.`);
    if (!legacy && available != null && available < 24) throw new Error(`Shot "${entry.id}" has fewer than 24 source frames available.`);
    if (!legacy && available != null && requested > available) throw new Error(`Shot "${entry.id}" requests ${requested} frames but only ${available} source frames are available.`);
    const len = requested;
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    const defaultTransition = direction?.edit ?? {transition: 'cut' as const, transitionFrames: 0};
    const requestedOverlap = index === 0 ? 0 : entry.transition?.frames ?? defaultTransition.transitionFrames;
    const overlap = Math.max(0, Math.min(24, requestedOverlap, len - 1, previousLen - previousOverlap - 1));
    const from = Math.max(0, cursor - overlap);
    const scale = (entry.scale ?? (entry.purpose === 'detail' ? direction?.camera.detailScale : entry.purpose === 'proof' ? direction?.camera.proofScale : direction?.camera.establishingScale) ?? 'medium') as ShotScale;
    const audio = entry.audio?.events ? {...entry.audio, events: entry.audio.events.map((event) => ({...event, frame: Math.min(len - 1, event.frame)}))} : entry.audio;
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    const resolved: LaunchShot = {...entry, sourceViewport: entry.sourceViewport ?? (entry.source.kind === 'demo' ? input.demoViewport ?? undefined : undefined), from, len, durationFrames: len, scale, focus: entry.focus as CameraSubject | undefined, sourceRef: sourceRef(entry.source), camera: {cadence: direction?.camera.cadence ?? 'locked'}, transition: {kind: entry.transition?.kind ?? defaultTransition.transition, frames: overlap}, matchFrom: entry.matchFrom ?? null, onScreenText: entry.onScreenText ?? {maxChars: 120, minHoldFrames: Math.min(45, len)}, readability: entry.readability ?? {safeArea: true, minContrast: 4.5}, hero: entry.hero ?? false, endingHoldFrames: Math.min(len, entry.endingHoldFrames ?? (entry.source.kind === 'end' ? direction?.outro.holdFrames ?? 60 : 0)), audio, references: entry.references ?? []};
    seen.add(entry.id);
    previousOverlap = overlap;
    previousLen = len;
    cursor = from + len;
    return resolved;
  });
  return launchShotPlanSchema.parse({version: 1, mode: legacy ? 'legacy' : 'directed', direction, timing, shots, total: cursor});
};
