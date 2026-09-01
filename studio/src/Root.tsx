import "./index.css";
import React from "react";
import { Composition } from "remotion";
import { ComponentGallery } from "./templates/ComponentGallery";
import { StagedGallery } from "./templates/StagedGallery";
import { SocialClip, socialClipSchema } from "./templates/SocialClip";
import { ProductDemo, productDemoSchema } from "./templates/ProductDemo";
import { LogoReveal, logoRevealSchema } from "./templates/LogoReveal";
import { LaunchVideo, launchVideoSchema } from "./templates/LaunchVideo";
import { AnimatedOG, animatedOgSchema } from "./templates/AnimatedOG";
import { StoreTile, storeTileSchema } from "./templates/StoreTile";
import { Card, cardSchema } from "./templates/Card";
import { WrapClip, wrapClipSchema, wrapDurationInFrames } from "./templates/WrapClip";
import { launchTiming, voTimingFrom } from "./lib/launchTiming";

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
        id="StagedGallery"
        component={StagedGallery}
        durationInFrames={510}
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
          command: null,
          video: null,
          videoStartFrame: null,
          videoCropRegion: null,
          burnCaptions: false,
          voLines: null,
          headlineOverVideo: false,
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
          command: null,
          assets: {logoSequence: null, logoFrames: 90, loopSequence: null, loopFrames: 240},
          audio: null,
          burnCaptions: false,
          motionOverride: null,
          actLengths: null,
          voTiming: null,
          hookFold: null,
          hookStamp: null,
        }}
        // VO-driven act lengths (Phase B): engages only when the audio manifest
        // carries word timings, so every existing render is byte-identical. The
        // component must build the SAME fourth argument — a mismatch here silently
        // truncates or pads the film.
        calculateMetadata={({props}) => ({
          durationInFrames: launchTiming(
            props.demo.telemetry?.durationMs ?? null,
            props.features.length,
            props.actLengths ?? null,
            voTimingFrom(props.audio?.lines ?? null, props.features.length, {
              force: props.voTiming ?? null,
            }),
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
          command: null,
          heroImage: null,
          loopSequence: null,
          loopFrames: 240,
        }}
      />
      <Composition
        id="StoreTile"
        component={StoreTile}
        durationInFrames={1}
        fps={30}
        width={1400}
        height={560}
        schema={storeTileSchema}
        defaultProps={{
          brandId: "tenwords",
          tagline: null,
          density: 1,
        }}
        calculateMetadata={({props}) => ({
          width: props.formatWidth ?? 1400,
          height: props.formatHeight ?? 560,
        })}
      />
      <Composition
        id="Card"
        component={Card}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1080}
        schema={cardSchema}
        defaultProps={{
          brandId: "sidetap",
          kind: "quote" as const,
          value: "Your iPhone, driven from Windows",
          label: "The agent sees the screen and taps it",
          source: "sidetap.io/docs",
          kicker: "sidetap",
          ctaUrl: null,
        }}
        calculateMetadata={({props}) => ({
          width: props.formatWidth ?? 1080,
          height: props.formatHeight ?? 1080,
        })}
      />
      <Composition
        id="WrapClip"
        component={WrapClip}
        durationInFrames={345}
        fps={30}
        width={1920}
        height={1080}
        schema={wrapClipSchema}
        defaultProps={{
          brandId: "dashclaw",
          video: null,
          segment: null,
          captions: [],
          cta: "",
          music: null,
        }}
        calculateMetadata={({props}) => ({
          durationInFrames: wrapDurationInFrames(props.segment),
          width: props.formatWidth ?? 1920,
          height: props.formatHeight ?? 1080,
        })}
      />
    </>
  );
};
