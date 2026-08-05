export type MotionVariantTiming = {mark: number; headline: number; hold: number};

export type MotionVariantScene = {
  layout: "spec-plate" | "type-only";
  gearAsset: string | null;
  wavePath: string;
  label: string;
  light: boolean;
};

const scenes: Record<"A" | "C", MotionVariantScene> = {
  A: {
    layout: "spec-plate",
    gearAsset: "synthacon/launch/synth-poly-dark.png",
    wavePath: "M8 90 Q 68 10 128 90 T 248 90 T 368 90 T 488 90 T 608 90 T 728 90 T 848 90 T 952 90",
    label: "SIGNAL / AVAILABLE NOW",
    light: false,
  },
  C: {
    layout: "type-only",
    gearAsset: null,
    wavePath: "M8 148 H128 V30 H248 V148 H368 V30 H488 V148 H608 V30 H728 V148 H848 V30 H952",
    label: "BUY / SELL / RENT",
    light: false,
  },
};

export const motionVariantScene = (direction: "A" | "C"): MotionVariantScene => scenes[direction];

export const motionVariantTiming = (fps: number, _fps: number, tempo: number): MotionVariantTiming => {
  const safeTempo = Math.max(0.25, tempo);
  return {mark: Math.round((fps / safeTempo)), headline: Math.round((fps * 1.8) / safeTempo), hold: 180};
};
