import {z} from 'zod';

export const directionPresetSchema = z.enum(['editorial', 'precision', 'playful']);
export const shotScaleSchema = z.enum(['wide', 'medium', 'close', 'detail']);

export const referenceSchema = z.object({
  id: z.string().min(1),
  pathOrUrl: z.string().min(1),
  intendedAttributes: z.array(z.string().min(1)).min(1),
  provenance: z.object({
    kind: z.enum(['capture', 'product', 'brand', 'reference', 'generated']),
    source: z.string().min(1),
    capturedAt: z.string().nullable().default(null),
  }),
});

export const reviewArtifactSchema = z.object({
  artifact: z.string().min(1),
  review: z.string().min(1),
});

export const directionGrammarSchema = z.object({
  camera: z.object({
    cadence: z.enum(['locked', 'measured', 'kinetic']),
    establishingScale: shotScaleSchema,
    proofScale: shotScaleSchema,
    detailScale: shotScaleSchema,
  }),
  motion: z.object({
    energy: z.number().min(0).max(1),
    travel: z.number().min(0).max(1),
    stagger: z.number().min(0).max(1),
    settle: z.number().min(0).max(1),
  }),
  typography: z.object({
    composition: z.enum(['editorial', 'instrument', 'kinetic']),
    align: z.enum(['left', 'center']),
    density: z.enum(['airy', 'compact']),
    casing: z.enum(['sentence', 'upper']),
  }),
  material: z.object({
    treatment: z.enum(['paper', 'solid', 'glass']),
    edge: z.enum(['rule', 'hairline', 'soft']),
    depth: z.number().min(0).max(1),
  }),
  edit: z.object({
    rhythm: z.enum(['measured', 'hard', 'syncopated']),
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    transition: z.enum(['cut', 'dissolve', 'wipe']),
    transitionFrames: z.number().int().min(0).max(24),
  }),
  intro: z.object({
    kind: z.enum(['mark', 'cold-open', 'proof-first']),
    holdFrames: z.number().int().min(0).max(180),
  }),
  outro: z.object({
    kind: z.enum(['lockup', 'command', 'callback']),
    holdFrames: z.number().int().min(24).max(240),
  }),
});

export const directionOverridesSchema = z.object({
  camera: directionGrammarSchema.shape.camera.partial().optional(),
  motion: directionGrammarSchema.shape.motion.partial().optional(),
  typography: directionGrammarSchema.shape.typography.partial().optional(),
  material: directionGrammarSchema.shape.material.partial().optional(),
  edit: directionGrammarSchema.shape.edit.partial().optional(),
  intro: directionGrammarSchema.shape.intro.partial().optional(),
  outro: directionGrammarSchema.shape.outro.partial().optional(),
});

export const directionSpecSchema = z.object({
  preset: directionPresetSchema,
  reason: z.string().min(1),
  visualMetaphor: z.string().nullable().default(null),
  soundIntent: z.string().nullable().default(null),
  references: z.array(referenceSchema).default([]),
  styleFrame: reviewArtifactSchema.nullable().default(null),
  animatic: reviewArtifactSchema.nullable().default(null),
  overrides: directionOverridesSchema.default({}),
});

export const directionSchema = directionSpecSchema.and(directionGrammarSchema);

export type DirectionPreset = z.infer<typeof directionPresetSchema>;
export type DirectionSpec = z.infer<typeof directionSpecSchema>;
export type DirectionSpecInput = z.input<typeof directionSpecSchema>;
export type DirectionGrammar = z.infer<typeof directionGrammarSchema>;
export type Direction = DirectionSpec & DirectionGrammar;

export const DIRECTION_PRESETS: Record<DirectionPreset, DirectionGrammar> = {
  editorial: {
    camera: {
      cadence: 'measured',
      establishingScale: 'wide',
      proofScale: 'medium',
      detailScale: 'close',
    },
    motion: {energy: 0.28, travel: 0.2, stagger: 0.45, settle: 0.15},
    typography: {
      composition: 'editorial',
      align: 'left',
      density: 'airy',
      casing: 'sentence',
    },
    material: {treatment: 'paper', edge: 'rule', depth: 0.18},
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    edit: {rhythm: 'measured', transition: 'dissolve', transitionFrames: 12},
    intro: {kind: 'proof-first', holdFrames: 54},
    outro: {kind: 'callback', holdFrames: 90},
  },
  precision: {
    camera: {
      cadence: 'locked',
      establishingScale: 'wide',
      proofScale: 'close',
      detailScale: 'detail',
    },
    motion: {energy: 0.18, travel: 0.08, stagger: 0.25, settle: 0.05},
    typography: {
      composition: 'instrument',
      align: 'center',
      density: 'compact',
      casing: 'upper',
    },
    material: {treatment: 'solid', edge: 'hairline', depth: 0.08},
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    edit: {rhythm: 'hard', transition: 'cut', transitionFrames: 0},
    intro: {kind: 'mark', holdFrames: 72},
    outro: {kind: 'command', holdFrames: 72},
  },
  playful: {
    camera: {
      cadence: 'kinetic',
      establishingScale: 'medium',
      proofScale: 'close',
      detailScale: 'detail',
    },
    motion: {energy: 0.78, travel: 0.72, stagger: 0.72, settle: 0.58},
    typography: {
      composition: 'kinetic',
      align: 'center',
      density: 'compact',
      casing: 'sentence',
    },
    material: {treatment: 'glass', edge: 'soft', depth: 0.72},
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    edit: {rhythm: 'syncopated', transition: 'wipe', transitionFrames: 8},
    intro: {kind: 'cold-open', holdFrames: 36},
    outro: {kind: 'lockup', holdFrames: 60},
  },
};

const mergeGrammar = (base: DirectionGrammar, overrides: DirectionSpec['overrides']): DirectionGrammar => ({
  camera: {...base.camera, ...overrides.camera},
  motion: {...base.motion, ...overrides.motion},
  typography: {...base.typography, ...overrides.typography},
  material: {...base.material, ...overrides.material},
  edit: {...base.edit, ...overrides.edit},
  intro: {...base.intro, ...overrides.intro},
  outro: {...base.outro, ...overrides.outro},
});

/** Resolve a named starting point plus composable overrides into one full grammar. */
export const resolveDirection = (input: DirectionSpec): Direction => {
  const spec = directionSpecSchema.parse(input);
  return {...spec, ...mergeGrammar(DIRECTION_PRESETS[spec.preset], spec.overrides)};
};
