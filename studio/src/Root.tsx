import "./index.css";
import React from "react";
import { Composition } from "remotion";
import { ComponentGallery } from "./templates/ComponentGallery";
import { SocialClip, socialClipSchema } from "./templates/SocialClip";
import { ProductDemo, productDemoSchema } from "./templates/ProductDemo";
import { LogoReveal, logoRevealSchema } from "./templates/LogoReveal";
import { LaunchVideo, launchVideoSchema } from "./templates/LaunchVideo";
import { AnimatedOG, animatedOgSchema } from "./templates/AnimatedOG";
import { launchTiming } from "./lib/launchTiming";
import { getBrand } from "./lib/brand";
import { getReveal } from "./brands/reveals";
import { loopCycleFrames } from "./lib/revealTiming";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ComponentGallery"
        component={ComponentGallery}
        durationInFrames={90}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="SocialClip"
        component={SocialClip}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={socialClipSchema}
        defaultProps={{
          brandId: "noban",
          kicker: "noban.gg",
          headline: "Skin arbitrage with guardrails",
          lines: [
            "Scans CSFloat, Steam, and 7 more venues",
            "Float and pattern aware spreads",
            "Hard spend caps on every trade",
          ],
          screenshot: "noban/cockpit.webp",
          cta: "Free in simulation",
          burnCaptions: false,
          voLines: null,
        }}
        calculateMetadata={({props}) => ({
          width: props.formatWidth ?? 1920,
          height: props.formatHeight ?? 1080,
        })}
      />
      <Composition
        id="ProductDemo"
        component={ProductDemo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        schema={productDemoSchema}
        defaultProps={{
          brandId: "noban",
          video: null,
          cta: "Simulate free at noban.gg",
          telemetry: null,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: props.telemetry
            ? Math.ceil((props.telemetry.durationMs / 1000) * 30) + 60
            : 240,
        })}
      />
      <Composition
        id="LogoReveal"
        component={LogoReveal}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={logoRevealSchema}
        defaultProps={{
          brandId: "noban",
          sequence: null,
          frameCount: 90,
          cta: "Simulate free at noban.gg",
          motionOverride: null,
        }}
      />
      <Composition
        id="LaunchVideo"
        component={LaunchVideo}
        durationInFrames={1350}
        fps={30}
        width={1920}
        height={1080}
        schema={launchVideoSchema}
        defaultProps={{
          brandId: "noban",
          kicker: "noban.gg",
          headline: "CS2 skin arbitrage with guardrails",
          demo: {video: null, telemetry: null},
          features: [],
          cta: "Simulate free at noban.gg",
          assets: {logoSequence: null, logoFrames: 90, loopSequence: null, loopFrames: 240},
          audio: null,
          burnCaptions: false,
          motionOverride: null,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: launchTiming(
            props.demo.telemetry?.durationMs ?? null,
            props.features.length,
          ).total,
          width: props.formatWidth ?? 1920,
          height: props.formatHeight ?? 1080,
        })}
      />
      <Composition
        id="AnimatedOG"
        component={AnimatedOG}
        durationInFrames={240}
        fps={30}
        width={1200}
        height={630}
        schema={animatedOgSchema}
        defaultProps={{
          brandId: "noban",
          tagline: "CS2 skin arbitrage with guardrails",
          cta: "Simulate free at noban.gg",
          heroImage: null,
          loopSequence: null,
          loopFrames: 240,
        }}
        calculateMetadata={({props}) => {
          // Brands with a registered vector reveal (synthacon) render it LOOPING
          // in the mark slot (AnimatedOG.tsx); size the composition's total
          // duration to a whole multiple of the reveal's own cycle length so the
          // rendered mp4/gif loops without a visible jump (PLAYBOOK: f(0) ==
          // f(duration)). Brands with no reveal keep the declared 240 unchanged.
          if (!getReveal(props.brandId)) return {};
          const brand = getBrand(props.brandId);
          const cycle = loopCycleFrames(30, brand.motion.tempo);
          const cycles = Math.max(1, Math.round(240 / cycle));
          return {durationInFrames: cycles * cycle};
        }}
      />
    </>
  );
};
