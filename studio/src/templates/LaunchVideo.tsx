import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {alphaHex, getBrand} from '../lib/brand';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring} from '../lib/motion';
import {useFormat} from '../lib/layout';
import {telemetrySchema, steps} from '../lib/telemetry';
import {launchTiming} from '../lib/launchTiming';
import {audioSchema} from '../lib/audioMix';
import {BackgroundLoop} from '../components/BackgroundLoop';
import {PngSequence} from '../components/PngSequence';
import {Headline} from '../components/Headline';
import {FeaturePanel} from '../components/FeaturePanel';
import {DemoStage} from '../components/DemoStage';
import {EndCard} from '../components/EndCard';
import {Caption} from '../components/Caption';
import {CaptionTrack} from '../components/CaptionTrack';
import {FloatBar} from '../components/FloatBar';
import {SoundTrack} from '../components/SoundTrack';
import {FilmGrade} from '../components/FilmGrade';
import {captionCues} from '../lib/captionTiming';
import {getMark} from '../brands/marks';

export const launchVideoSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  demo: z.object({video: z.string().nullable(), telemetry: telemetrySchema.nullable()}),
  features: z.array(
    z.object({
      screenshot: z.string().nullable(),
      heading: z.string(),
      lines: z.array(z.string()).min(1).max(4),
    }),
  ).max(3),
  cta: z.string(),
  assets: z.object({
    logoSequence: z.string().nullable(),
    logoFrames: z.number().int().positive(),
    loopSequence: z.string().nullable(),
    loopFrames: z.number().int().positive(),
  }),
  audio: audioSchema.nullable().default(null),
  // Burn the VO into on-screen captions so the message survives muted autoplay
  // (X/TikTok/Shorts). Default false keeps normal renders/smoke byte-identical;
  // caption text is read from the `audio` manifest's lines.
  burnCaptions: z.boolean().default(false),
  // Optional responsive-matrix overrides read by calculateMetadata (Root.tsx);
  // absent for normal renders/smoke so the declared 1920x1080 is untouched.
  formatWidth: z.number().int().positive().optional(),
  formatHeight: z.number().int().positive().optional(),
});

type Props = z.infer<typeof launchVideoSchema>;

const FADE = 12;

// per-act fade against the act-local frame
const useActFade = (len: number): number => {
  const f = useCurrentFrame();
  return interpolate(f, [0, FADE, len - FADE, len], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

const LogoAct: React.FC<{assets: Props['assets']; len: number; brand: Brand}> = ({assets, len, brand}) => {
  const fade = useActFade(len);
  const {scale} = useFormat();
  const box = Math.round(500 * scale);
  const Mark = getMark(brand.id);
  return (
    <AbsoluteFill style={{opacity: fade, justifyContent: 'center', alignItems: 'center'}}>
      <div style={{width: box, height: box, filter: `drop-shadow(0 0 ${Math.round(42 * scale)}px ${brand.colors.brand}${alphaHex(brand.effects.glow)})`}}>
        {assets.logoSequence ? (
          <PngSequence
            dir={assets.logoSequence}
            frameCount={assets.logoFrames}
            mode="clamp"
            style={{width: '100%', height: '100%', display: 'block'}}
          />
        ) : (
          <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', position: 'relative'}}>
            <Mark size={Math.round(400 * scale)} color={brand.colors.brand} />
          </AbsoluteFill>
        )}
      </div>
    </AbsoluteFill>
  );
};

const HookAct: React.FC<{kicker: string; headline: string; len: number; brand: Brand}> = ({kicker, headline, len, brand}) => {
  const fade = useActFade(len);
  return (
    <AbsoluteFill style={{opacity: fade}}>
      <Headline kicker={kicker} headline={headline} brand={brand} />
    </AbsoluteFill>
  );
};

const DemoAct: React.FC<{demo: Props['demo']; len: number; brand: Brand}> = ({demo, len, brand}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale, safe} = useFormat();
  const fade = useActFade(len);
  const timeMs = (frame / fps) * 1000;
  const stepList = demo.telemetry ? steps(demo.telemetry) : [];
  const activeStep = [...stepList].reverse().find((s) => s.t <= timeMs);
  return (
    <AbsoluteFill style={{opacity: fade, justifyContent: 'center', alignItems: 'center'}}>
      <div style={{transform: `scale(${0.9 * scale}) translateY(${-28 * scale}px)`}}>
        <DemoStage video={demo.video} telemetry={demo.telemetry} timeMs={timeMs} brand={brand} />
      </div>
      {activeStep ? (
        <div style={{position: 'absolute', bottom: Math.max(Math.round(108 * scale), safe.bottom)}}>
          <Caption label={activeStep.label} brand={brand} enteredMsAgo={timeMs - activeStep.t} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const FeatureAct: React.FC<{feature: Props['features'][number]; len: number; brand: Brand}> = ({feature, len, brand}) => {
  const fonts = loadBrandFonts(brand);
  const fade = useActFade(len);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale, safe, orientation} = useFormat();
  const headIn = brandSpring(frame, fps, brand.motion);
  const headingFont = Math.round(56 * scale);
  const headingTop = Math.max(Math.round(64 * scale), safe.top);
  // Portrait only: FeaturePanel reserves 220px of its own top padding (tuned for
  // the standalone SocialClip). When the safe-area heading sits low (9:16's ~192px
  // top) it collides with that band, so push the panel down by exactly the overflow
  // past 220. Landscape/square (row layout) never overlap, so no offset there.
  const panelTop =
    orientation === 'landscape'
      ? 0
      : Math.max(0, headingTop + Math.round(headingFont * 1.3) + Math.round(50 * scale) - 220);
  return (
    <AbsoluteFill style={{opacity: fade}}>
      <div
        style={{
          position: 'absolute',
          top: headingTop,
          left: safe.left,
          right: safe.right,
          textAlign: 'center',
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: headingFont,
          color: brand.colors.ink,
          opacity: headIn,
        }}
      >
        {feature.heading}
      </div>
      <AbsoluteFill style={{top: panelTop}}>
        <FeaturePanel screenshot={feature.screenshot} lines={feature.lines} brand={brand} zoom={{from: 1, to: 1.04, origin: '50% 30%'}} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const LaunchVideo: React.FC<Props> = ({brandId, kicker, headline, demo, features, cta, assets, audio, burnCaptions}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const {orientation, scale, safe} = useFormat();
  const brand = getBrand(brandId);
  const t = launchTiming(demo.telemetry?.durationMs ?? null, features.length);
  const cues = burnCaptions && audio ? captionCues(audio.lines, t, fps) : [];
  // Wash geometry follows orientation: portrait pulls the hero glow taller and
  // higher, square splits the difference, landscape keeps the picture-lock shape.
  const washGeom =
    orientation === 'portrait'
      ? '92% 42% at 50% 30%'
      : orientation === 'square'
        ? '76% 58% at 50% 34%'
        : '70% 55% at 50% 32%';
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {/* loop backdrop behind every act; the demo stage covers most of it */}
      <BackgroundLoop dir={assets.loopSequence} frameCount={assets.loopFrames} brand={brand} opacity={0.55} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(${washGeom}, ${brand.colors.brand}${alphaHex(brand.effects.wash)}, transparent 72%)`,
        }}
      />
      <Sequence durationInFrames={t.logo.len}>
        <LogoAct assets={assets} len={t.logo.len} brand={brand} />
      </Sequence>
      <Sequence from={t.hook.from} durationInFrames={t.hook.len}>
        <HookAct kicker={kicker} headline={headline} len={t.hook.len} brand={brand} />
      </Sequence>
      <Sequence from={t.demo.from} durationInFrames={t.demo.len}>
        <DemoAct demo={demo} len={t.demo.len} brand={brand} />
      </Sequence>
      {features.map((feature, i) => (
        <Sequence key={i} from={t.features[i].from} durationInFrames={t.features[i].len}>
          <FeatureAct feature={feature} len={t.features[i].len} brand={brand} />
        </Sequence>
      ))}
      <Sequence from={t.end.from} durationInFrames={t.end.len}>
        <EndCard cta={cta} brand={brand} />
      </Sequence>
      {audio ? (
        <SoundTrack
          audio={audio}
          timing={t}
          featureLineCounts={features.map((f) => f.lines.length)}
          motion={brand.motion}
        />
      ) : null}
      <div style={{position: 'absolute', bottom: Math.max(Math.round(40 * scale), safe.bottom), left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={Math.round(640 * scale)} />
      </div>
      {cues.length ? <CaptionTrack cues={cues} brand={brand} /> : null}
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
