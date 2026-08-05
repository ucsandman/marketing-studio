import {describe, expect, it} from "vitest";
import {motionVariantScene, motionVariantTiming} from "./motionVariants";

describe("motionVariantTiming", () => {
  it("keeps the final hold long enough for a readable caption", () => {
    expect(motionVariantTiming(30, 30, 1)).toEqual({mark: 30, headline: 54, hold: 180});
  });

  it("scales the reveal windows with tempo", () => {
    expect(motionVariantTiming(30, 30, 2)).toEqual({mark: 15, headline: 27, hold: 180});
  });

  it("maps each direction to a distinct board-derived scene", () => {
    const scenes = ["A", "C"].map((direction) => motionVariantScene(direction as "A" | "C"));
    expect(new Set(scenes.map((scene) => scene.layout))).toEqual(new Set(["spec-plate", "type-only"]));
    expect(scenes[0].gearAsset).toMatch(/synth-poly-dark\.png$/);
    expect(scenes[1].gearAsset).toBeNull();
    expect(new Set(scenes.map((scene) => scene.wavePath)).size).toBe(2);
  });
});
