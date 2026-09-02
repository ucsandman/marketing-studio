import { describe, expect, it } from "vitest";

const palette = {
  accent: "#2f6f73",
  bad: "#a33b35",
  good: "#2f7d52",
  ink: "#17211f",
  muted: "#56615d",
  panel: "#fcfdf9",
  paper: "#f5f7f3",
} as const;

describe("token contrast", () => {
  it("keeps dashboard text token pairs at WCAG AA contrast", () => {
    const bodyPairs = [
      ["ink", "paper"],
      ["muted", "paper"],
      ["accent", "paper"],
      ["good", "panel"],
      ["bad", "panel"],
      ["ink", "panel"],
      ["paper", "ink"],
    ] as const;

    for (const [foreground, background] of bodyPairs) {
      expect(contrastRatio(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
    }

    expect(contrastRatio(palette.accent, palette.paper)).toBeGreaterThanOrEqual(3);
  });
});

function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string) {
  const [red = 0, green = 0, blue = 0] = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [0, 0, 0];
  const [r, g, b] = [red, green, blue].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
