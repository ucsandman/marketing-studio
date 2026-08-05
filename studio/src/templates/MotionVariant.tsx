import React from "react";
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {CaptionTrack} from "../components/CaptionTrack";
import {alphaHex, getBrand} from "../lib/brand";
import {loadBrandFonts} from "../lib/fonts";
import {motionVariantScene, motionVariantTiming} from "../lib/motionVariants";
import {revealFragment, revealUnit} from "../lib/textReveal";

export type MotionVariantProps = {
  brandId: string;
  direction: "A" | "C";
  headline: string;
  caption: string;
  light?: boolean;
  formatWidth?: number;
  formatHeight?: number;
};

const WaveMark: React.FC<{path: string; color: string; progress: number; width?: number}> = ({path, color, progress, width = 320}) => (
  <svg width={width} height={Math.round(width * 0.19)} viewBox="0 0 960 180" fill="none">
    <path d={path} stroke={color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" pathLength={100} strokeDasharray={100} strokeDashoffset={100 - progress * 100} />
  </svg>
);

const Headline: React.FC<{text: string; frame: number; fps: number; brand: ReturnType<typeof getBrand>; color: string; font: string; size: number}> = ({text, frame, fps, brand, color, font, size}) => {
  const units = revealUnit(brand.motion.textReveal, text) === "char" ? [...text] : text.split(" ");
  return <div style={{fontFamily: font, fontWeight: 800, fontSize: size, lineHeight: .92, letterSpacing: "-.05em", color}}>
    {units.map((unit, index) => <span key={`${unit}-${index}`} style={{display: "inline-block", marginRight: unit === " " ? size * .22 : size * .12, ...revealFragment(brand.motion.textReveal, {frame, fps, motion: brand.motion, index, total: units.length, scale: 1})}}>{unit}</span>)}
  </div>;
};

export const MotionVariant: React.FC<MotionVariantProps> = ({brandId, direction, headline, caption, light}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const portrait = height > width;
  const brand = getBrand(brandId);
  const scene = motionVariantScene(direction);
  const useLight = light ?? scene.light;
  if (useLight && !brand.light) throw new Error(`${brand.id} has no light palette`);
  const palette = useLight
    ? {bg: brand.light!.bg, ink: brand.light!.ink, accent: brand.light!.brand, line: brand.light!.outlineVariant, muted: brand.colors.ink3}
    : {bg: brand.colors.bg, ink: brand.colors.ink, accent: brand.colors.brand, line: brand.colors.line, muted: brand.colors.ink2};
  const fonts = loadBrandFonts(brand);
  const timing = motionVariantTiming(fps, fps, brand.motion.tempo);
  const markProgress = interpolate(frame, [0, timing.mark], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const contentOpacity = interpolate(frame, [timing.mark - 6, timing.mark + 18], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const gearScale = interpolate(frame, [timing.mark, timing.mark + 28], [.96, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const pad = portrait ? 64 : 56;
  const headlineSize = scene.layout === "type-only" ? (portrait ? 108 : 72) : portrait ? 124 : 92;
  const header = <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 2}}>
    <WaveMark path={scene.wavePath} color={palette.accent} progress={markProgress} width={portrait ? 260 : 220} />
    <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: portrait ? 30 : 26, letterSpacing: "-.04em", color: palette.ink}}>Synthacon</div>
  </div>;
  const footer = <div style={{position: "absolute", left: pad, right: pad, bottom: portrait ? 74 : 48, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: fonts.mono, fontSize: portrait ? 22 : 18, color: palette.accent, opacity: contentOpacity}}>
    <span>{scene.label}</span><span>JOIN THE BETA</span>
  </div>;

  return <AbsoluteFill style={{background: palette.bg, color: palette.ink, padding: pad, fontFamily: fonts.body, overflow: "hidden"}}>
    {<div style={{position: "absolute", inset: 0, backgroundImage: `radial-gradient(circle, ${palette.ink}${alphaHex(.1)} 1px, transparent 1px)`, backgroundSize: "24px 24px", opacity: scene.layout === "spec-plate" ? .45 : .7}} />}
    <div style={{position: "absolute", inset: portrait ? 40 : 32, border: `1px solid ${palette.line}`, opacity: .75}} />
    {header}

    {scene.layout === "spec-plate" && <>
      <div style={{position: "absolute", left: pad, right: pad, top: portrait ? 250 : 170, height: portrait ? 650 : 410, border: `1px solid ${palette.line}`, borderRadius: 24, overflow: "hidden", opacity: contentOpacity, transform: `scale(${gearScale})`}}>
        <Img src={staticFile(scene.gearAsset!)} style={{width: "100%", height: "100%", objectFit: "cover"}} />
        <div style={{position: "absolute", inset: 0, backgroundImage: `radial-gradient(circle, ${palette.ink}${alphaHex(.16)} 1px, transparent 1px)`, backgroundSize: "24px 24px"}} />
        <div style={{position: "absolute", left: 28, bottom: 24, fontFamily: fonts.mono, color: palette.accent, fontSize: 18}}>POLYSYNTH / GOOD / LOCAL</div>
      </div>
      <div style={{position: "absolute", left: pad, right: pad, top: portrait ? 1010 : 650}}><Headline text={headline} frame={frame - timing.mark} fps={fps} brand={brand} color={palette.ink} font={fonts.display} size={headlineSize} /></div>
    </>}

    {scene.layout === "type-only" && <>
      <div style={{position: "absolute", left: pad, right: pad, top: portrait ? 380 : 240, display: "grid", gap: portrait ? 70 : 34}}>
        {["Buy", "Sell", "Rent"].map((word, index) => <div key={word} style={{display: "flex", alignItems: "center", gap: 38, opacity: interpolate(frame, [timing.mark + index * 8, timing.mark + 18 + index * 8], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})}}><WaveMark path={[motionVariantScene("A").wavePath, motionVariantScene("C").wavePath, motionVariantScene("A").wavePath][index]} color={palette.accent} progress={markProgress} width={portrait ? 300 : 250} /><span style={{fontFamily: fonts.display, fontWeight: 800, fontSize: portrait ? 112 : 84, letterSpacing: "-.05em"}}>{word}</span></div>)}
      </div>
      <div style={{position: "absolute", left: pad, right: pad, top: portrait ? 1100 : 660}}><Headline text={headline} frame={frame - timing.mark - 20} fps={fps} brand={brand} color={palette.ink} font={fonts.display} size={headlineSize} /></div>
      <WaveMark path={motionVariantScene("A").wavePath} color={palette.accent} progress={markProgress} width={952} />
    </>}
    <CaptionTrack cues={[{text: caption, fromFrame: timing.mark + timing.headline, toFrame: 250}]} brand={brand} />
    {footer}
  </AbsoluteFill>;
};
