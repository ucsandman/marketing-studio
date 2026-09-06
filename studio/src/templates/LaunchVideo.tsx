import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {alphaHex, getBrand, motionOverrideSchema} from '../lib/brand';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {brandSpring, entrance} from '../lib/motion';
import type {Motion} from '../lib/motion';
import {parallaxOffset, settleOn, offsetTransform, settleTransform} from '../lib/depth';
import {useFormat} from '../lib/layout';
import {containedStage, markBox} from '../lib/aspectLayout';
import {telemetrySchema, steps} from '../lib/telemetry';
import {launchTiming, voTimingFrom} from '../lib/launchTiming';
import {directionSpecSchema} from '../lib/direction';
import type {Direction} from '../lib/direction';
import {buildLaunchShotPlan, launchShotInputSchema} from '../lib/shotPlan';
import type {LaunchShot} from '../lib/shotPlan';
import {cameraAtCues} from '../lib/camera';
import {alignPhraseCues, alignWordCues} from '../lib/wordCues';
import {foldCues} from '../lib/sfxCues';
import {audioSchema, timingFromShots} from '../lib/audioMix';
import {BackgroundLoop} from '../components/BackgroundLoop';
import {PngSequence} from '../components/PngSequence';
import {Headline} from '../components/Headline';
import {MeasuredStamp} from '../components/MeasuredStamp';
import {GalleyFold} from '../components/GalleyFold';
import {FeaturePanel} from '../components/FeaturePanel';
import {StagedScene} from '../components/StagedScene';
import {stagedSceneSchema} from '../lib/staged';
import {DemoStage} from '../components/DemoStage';
import {EndCard} from '../components/EndCard';
import {Caption} from '../components/Caption';
import {CaptionTrack} from '../components/CaptionTrack';
import {FloatBar} from '../components/FloatBar';
import {SoundTrack} from '../components/SoundTrack';
import {FilmGrade} from '../components/FilmGrade';
import {CameraRig} from '../components/CameraRig';
import {captionCues} from '../lib/captionTiming';
import {getMark} from '../brands/marks';

// Zod mirror of lib/launchTiming's ActLengths. It lives here, not in launchTiming.ts,
// because that lib is imported by plain .mjs scripts via Node type-stripping and must
// stay dependency-free.
export const actLengthsSchema = z.object({
  logo: z.number().int().positive().optional(),
  hook: z.number().int().positive().optional(),
  features: z.array(z.number().int().positive()).optional(),
  end: z.number().int().positive().optional(),
  demoTail: z.number().int().nonnegative().optional(),
});

export const launchVideoSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  demo: z.object({video: z.string().nullable(), telemetry: telemetrySchema.nullable()}),
  features: z.array(
    z.object({
      screenshot: z.string().nullable(),
      portraitScreenshot: z.string().optional(),
      heading: z.string(),
      lines: z.array(z.string()).min(1).max(4),
      // Optional staged native-UI scene rendered INSTEAD of the screenshot panel
      // (docs/product-launch-motion-adoption.md Phase C). All content comes from
      // props. Nullable, defaults null, so every existing feature entry parses and
      // renders byte-identically — same nullable-override pattern as actLengths.
      staged: stagedSceneSchema.nullable().default(null),
    }),
  ).max(3),
  cta: z.string(),
  // Optional runnable command shown on the end card under the CTA (mono, verbatim).
  // Nullable, defaults null, so brands without one render byte-identically.
  command: z.string().nullable().default(null),
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
  // Optional per-render motion-knob override (scripts/render-variants.mjs hero
  // takes, scripts/render-hook-variants.mjs hook A/B). Nullable, defaults null, so
  // a normal render/smoke merges nothing and stays byte-identical to brand.motion
  // — same nullable-override pattern as formatWidth/formatHeight above.
  motionOverride: motionOverrideSchema.nullable().default(null),
  // Optional per-render act-length overrides (lib/launchTiming's ActLengths), for a
  // brand whose approved narration needs more room than the shared constants give.
  // Nullable, defaults null, so a normal render/smoke overrides nothing and stays
  // byte-identical — same nullable-override pattern as motionOverride above.
  actLengths: actLengthsSchema.nullable().default(null),
  // Optional hook act that DEMONSTRATES the product's verb before the headline
  // claims it: a real paragraph folds down to its condensed line, then the headline
  // sets underneath (components/GalleyFold). foldOnWord / headlineOnWord name the
  // narration words those two beats lock to; without measured word times they fall
  // back to fractions of the act. Nullable, defaults null, so every other brand
  // keeps the plain Headline hook act byte-identically.
  hookFold: z
    .object({
      paragraph: z.string(),
      folded: z.string(),
      foldOnWord: z.string().nullable().default(null),
      headlineOnWord: z.string().nullable().default(null),
      accentWord: z.string().nullable().default(null),
      // Act-local frames used ONLY while the narration has no measured word times
      // (no manifest, or a manifest without `words`). A measured cue always wins, so
      // the film re-locks itself to the voice the moment the VO exists, with no
      // props edit. Absent, the beats fall back to fractions of the act.
      foldFrame: z.number().int().nonnegative().nullable().default(null),
      headlineFrame: z.number().int().nonnegative().nullable().default(null),
    })
    .nullable()
    .default(null),
  // Optional second beat under the hook headline: a mono label with a filled accent
  // block stamped beside it (components/MeasuredStamp). It exists because a hook act
  // long enough to carry a two-sentence narration line is too long to hold one static
  // headline, and the stamp is the film's signature move. `frame` is the act-local
  // frame the block lands on; null falls back to a fraction of the act, and a measured
  // VO word time is not consulted here (the audio pass owns that). Nullable, defaults
  // null, so every other brand's hook act stays byte-identical.
  hookStamp: z
    .object({
      label: z.string(),
      tag: z.string(),
      frame: z.number().int().nonnegative().nullable().default(null),
    })
    .nullable()
    .default(null),
  // Optional force switch for VO-driven act lengths (lib/launchTiming's voTimingFrom
  // `force`): true pins act lengths to the measured VO even with no word timings,
  // false pins the shared constants. Nullable, defaults null = auto, which engages
  // only when a manifest line carries `words`, so existing renders are unchanged.
  voTiming: z.boolean().nullable().default(null),
  // New production uses a resolved direction plus an authored, repeatable-source
  // shot list. Both stay nullable so historical props take the legacy act route.
  direction: directionSpecSchema.nullable().default(null),
  shots: z.array(launchShotInputSchema).nullable().default(null),
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

// Parallax depth-layer wrapper. Renders children inside a transformed container
// ONLY when there is an actual offset; at parallax 0 the transform is '' and the
// children render inline, so the DOM (and every pixel) stays byte-identical to a
// flat render.
const Depth: React.FC<{transform: string; children: React.ReactNode}> = ({transform, children}) =>
  transform ? <AbsoluteFill style={{transform}}>{children}</AbsoluteFill> : <>{children}</>;

// Applies the overshoot-and-settle kicker to an act, keyed on the act-local frame
// (the cut is local frame 0, where the kicker peaks). At settle 0 the transform is
// '' and children render inline — byte-identical to today's hard cut.
const ActContainer: React.FC<{motion: Motion; children: React.ReactNode}> = ({motion, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const transform = settleTransform(settleOn(frame, 0, fps, motion));
  return transform ? <AbsoluteFill style={{transform}}>{children}</AbsoluteFill> : <>{children}</>;
};

// `fade` is the act-local crossfade. It stays on for the legacy act route, which has
// no other entry or exit. The directed route turns it off: DirectedTransition already
// owns every entry and exit there, so the act fade only doubled up and left the film's
// opening and closing logo frames near-invisible.
const LogoAct: React.FC<{assets: Props['assets']; len: number; brand: Brand; fade?: boolean}> = ({assets, len, brand, fade = true}) => {
  const actFade = useActFade(len);
  const format = useFormat();
  // 500 * format.scale at the master; a share of the safe width on a narrow canvas,
  // where format.scale (the smaller axis ratio) would leave the mark at a quarter of
  // the frame. Glow and fallback mark stay in the same proportion to the box.
  const box = markBox(format);
  const Mark = getMark(brand.id);
  return (
    <AbsoluteFill style={{opacity: fade ? actFade : 1, justifyContent: 'center', alignItems: 'center'}}>
      <div style={{width: box, height: box, filter: `drop-shadow(0 0 ${Math.round(box * 0.084)}px ${brand.colors.brand}${alphaHex(brand.effects.glow)})`}}>
        {assets.logoSequence ? (
          <PngSequence
            dir={assets.logoSequence}
            frameCount={assets.logoFrames}
            mode="clamp"
            style={{width: '100%', height: '100%', display: 'block'}}
          />
        ) : (
          <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', position: 'relative'}}>
            <Mark size={Math.round(box * 0.8)} color={brand.colors.brand} />
          </AbsoluteFill>
        )}
      </div>
    </AbsoluteFill>
  );
};

const HookAct: React.FC<{
  kicker: string;
  headline: string;
  len: number;
  brand: Brand;
  cueFrames?: (number | null)[];
  fold?: Props['hookFold'];
  foldFrame?: number;
  headlineFrame?: number;
  stamp?: Props['hookStamp'];
}> = ({kicker, headline, len, brand, cueFrames, fold, foldFrame, headlineFrame, stamp}) => {
  const fade = useActFade(len);
  return (
    <AbsoluteFill style={{opacity: fade}}>
      {fold ? (
        <GalleyFold
          kicker={kicker}
          paragraph={fold.paragraph}
          folded={fold.folded}
          headline={headline}
          brand={brand}
          foldFrame={foldFrame ?? fold.foldFrame ?? Math.round(len * 0.42)}
          headlineFrame={headlineFrame ?? fold.headlineFrame ?? Math.round(len * 0.66)}
          accentWord={fold.accentWord ?? undefined}
        />
      ) : (
        <Headline
          kicker={kicker}
          headline={headline}
          brand={brand}
          cueFrames={cueFrames}
          footer={
            stamp ? (
              <MeasuredStamp
                label={stamp.label}
                tag={stamp.tag}
                brand={brand}
                at={stamp.frame ?? Math.round(len * 0.62)}
              />
            ) : undefined
          }
        />
      )}
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

const FeatureAct: React.FC<{
  feature: Props['features'][number];
  len: number;
  brand: Brand;
  seat: number;
  cueFrames?: (number | null)[];
}> = ({feature, len, brand, seat, cueFrames}) => {
  const fonts = loadBrandFonts(brand);
  const fade = useActFade(len);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scale, safe, orientation} = useFormat();
  const headIn = brandSpring(frame, fps, brand.motion);
  const rule = brand.ctaStyle === 'block';
  const ruleIn = entrance(frame, fps, brand.motion, {durFrames: 16, easing: Easing.out(Easing.cubic)});
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
      {rule ? (
        // BONE & RULE: a `ctaStyle: 'block'` brand sets its figures UNDER a hard ink
        // rule that draws across first, the way a spec sheet rules a table off from
        // its caption. Width, not scaleX, so nothing shares a matrix with the panel's
        // own entrance. Every other brand renders no rule at all -> byte-identical.
        <div
          style={{
            position: 'absolute',
            top: headingTop + Math.round(headingFont * 1.34),
            left: safe.left,
            right: safe.right,
            height: Math.max(2, Math.round(3 * scale)),
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${ruleIn * 100}%`,
              height: '100%',
              background: brand.colors.ink,
            }}
          />
        </div>
      ) : null}
      {feature.staged ? (
        // StagedScene sits OUTSIDE the panelTop wrapper on purpose: it does its own
        // safe-area band math from useFormat.
        <StagedScene config={feature.staged} len={len} brand={brand} seat={seat} />
      ) : (
        <AbsoluteFill style={{top: panelTop}}>
          <FeaturePanel
            screenshot={feature.screenshot}
            portraitScreenshot={feature.portraitScreenshot}
            lines={feature.lines}
            brand={brand}
            zoom={{from: 1, to: 1.04, origin: '50% 30%'}}
            cueFrames={cueFrames}
          />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

const DirectedTransition: React.FC<{shot: LaunchShot; direction: Direction; children: React.ReactNode}> = ({shot, direction, children}) => {
  const frame = useCurrentFrame();
  const frames = shot.transition.frames;
  const p = frames === 0 ? 1 : interpolate(frame, [0, frames], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const arrivalTransform = direction.edit.rhythm === 'syncopated'
    ? `translateX(${(1 - p) * direction.motion.travel * 42}px)`
    : direction.edit.rhythm === 'measured'
      ? `translateY(${(1 - p) * direction.motion.settle * 22}px)`
      : undefined;
  const transitionStyle = shot.transition.kind === 'wipe'
    ? {clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, transform: arrivalTransform}
    : shot.transition.kind === 'dissolve'
      ? {opacity: p, transform: arrivalTransform}
      : undefined;
  return (
    <AbsoluteFill
      style={{
        ...transitionStyle,
        overflow: 'hidden',
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

// The establishing logo shot on the directed route. The mark itself is the legacy
// LogoAct, minus its act fade; what is added is the direction's own material edge. A
// `rule` direction is a film set on ruled paper, so the rule is on the page from frame
// 0 and the mark is drawn onto it. Without it the film opened on frames that carried
// no ink at all: the staged mark sequence starts with a blank lead-in hold, and the
// act fade held those frames near-transparent on top of that, so the first samples of
// the film measured as an empty page (judge-production render-integrity, 2026-09-06).
const DirectedLogo: React.FC<{assets: Props['assets']; len: number; brand: Brand; direction: Direction}> = ({assets, len, brand, direction}) => {
  const {scale, safe} = useFormat();
  return (
    <AbsoluteFill style={{background: brand.colors.bg}}>
      {direction.material.edge === 'rule' ? (
        <div
          style={{
            position: 'absolute',
            top: safe.top,
            left: safe.left,
            right: safe.right,
            height: Math.max(3, Math.round(6 * scale)),
            background: brand.colors.brand,
          }}
        />
      ) : null}
      <LogoAct assets={assets} len={len} brand={brand} fade={false} />
    </AbsoluteFill>
  );
};

const DirectedHook: React.FC<{kicker: string; headline: string; brand: Brand; direction: Direction; copy?: LaunchShot['copy']}> = ({kicker, headline, brand, direction, copy}) => {
  const {height} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const treatment =
    direction.typography.composition === 'instrument'
      ? 'precision'
      : direction.typography.composition === 'kinetic'
        ? 'playful'
        : 'editorial';
  const title = direction.typography.casing === 'upper' ? (copy?.title ?? headline).toUpperCase() : copy?.title ?? headline;
  return (
    <AbsoluteFill style={{background: brand.colors.bg}}>
      <Headline kicker={kicker} headline={title} brand={brand} treatment={treatment} footer={copy?.supporting ? <div style={{fontFamily: fonts.body, fontSize: height * 0.035, color: brand.colors.ink2}}>{copy.supporting}</div> : undefined} />
    </AbsoluteFill>
  );
};

const DirectedFeature: React.FC<{feature: Props['features'][number]; brand: Brand; direction: Direction; shot: LaunchShot}> = ({feature, brand, direction, shot}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {width, height} = useVideoConfig();
  const format = useFormat();
  const {orientation} = format;
  const sourceViewport = shot.sourceViewport ?? {width: 1600, height: 1000};
  const focusFrames = shot.camera.cadence === 'locked' ? 1 : shot.camera.cadence === 'kinetic' ? 12 : 18;
  const camera = shot.focus
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    ? cameraAtCues([{at: 0, subject: shot.focus, scale: shot.scale, transition: focusFrames, hold: Math.max(0, shot.len - focusFrames)}], frame, sourceViewport)
    : null;
  const copyIn = brandSpring(frame, fps, brand.motion, {delayFrames: Math.round(direction.motion.stagger * 12)});
  const treatment = direction.typography.composition === 'instrument' ? 'precision' : direction.typography.composition === 'kinetic' ? 'playful' : 'editorial';
  // Landscape geometry fixed 2026-09-05: the crop box used to sit at width*0.073 with
  // width*0.704, so the panel had a 140px left margin against a 428px right margin —
  // aligned to neither the title's own width*0.04 left edge nor to frame center — and
  // cropTop 0.22 pinned title AND panel into the top half, leaving the bottom 48% of a
  // 16:9 frame empty. It now hangs from the same left edge as a left-set title (or
  // centers under a centered one), fills the frame's width symmetrically, and sits in
  // the lower-middle so the title has air above it. Portrait and square are unchanged.
  // Square and portrait relayout: the strip keeps its FULL width inside the safe area
  // and sits centred between the title band and the burned-caption zone, instead of the
  // master's fraction-of-frame box on a 1080-wide canvas. Landscape is the picture-lock
  // geometry, untouched.
  const landscape = orientation === 'landscape';
  const contained = landscape ? null : containedStage(format, sourceViewport, {titled: true});
  const cropWidth = contained ? contained.width : width * 0.92;
  const cropHeight = contained ? contained.height : height * 0.39;
  const cropLeft = contained
    ? contained.left
    : direction.typography.align === 'left'
      ? width * 0.04
      : (width - cropWidth) / 2;
  const cropTop = contained ? contained.top : height * 0.38;
  const stageScale = cropWidth / sourceViewport.width;
  const stageTop = (cropHeight - sourceViewport.height * stageScale) / 2;
  const title = direction.typography.casing === 'upper' ? (shot.copy?.title ?? feature.heading).toUpperCase() : shot.copy?.title ?? feature.heading;
  // The master sets a feature title at 0.72 of the size headlineLayout fitted for a
  // 1920-wide frame. On a 1080-wide canvas that fitted size is ALREADY the canvas's own
  // measure, so shrinking it again left the title at 58% of the frame width with a dead
  // right margin; take it at full fitted size and let the safe area be the bound.
  const titleScale = (landscape ? 0.72 : 1) * (direction.typography.density === 'compact' ? 1.08 : direction.typography.density === 'airy' ? 1 : 1.04);
  const glass = direction.material.treatment === 'glass';
  const shadowY = 10 + direction.material.depth * 56;
  const shadowBlur = 24 + direction.material.depth * 90;
  return (
    <AbsoluteFill style={{background: brand.colors.bg}}>
      <div style={{position: 'absolute', inset: 0, left: landscape && direction.typography.align === 'left' ? width * 0.04 : 0, opacity: copyIn, transform: `translateY(${(1 - copyIn) * direction.motion.travel * 24}px) scale(${titleScale})`, transformOrigin: direction.typography.align === 'left' ? 'top left' : 'top center'}}>
        <Headline kicker="" headline={title} brand={brand} hideKicker topAlign treatment={treatment} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: cropTop,
          left: cropLeft,
          width: cropWidth,
          height: cropHeight,
          overflow: 'hidden',
          border: glass ? `10px solid ${brand.colors.surface}${alphaHex(0.72)}` : `1px solid ${brand.colors.line}`,
          borderTop: direction.material.edge === 'rule' ? `4px solid ${brand.colors.brand}` : undefined,
          borderRadius: direction.material.edge === 'soft' ? 18 : 2,
          boxShadow: glass
            ? `inset 0 1px 0 #ffffff${alphaHex(0.72)}, 0 ${shadowY}px ${shadowBlur}px ${brand.colors.ink}${alphaHex(0.14)}`
            : `0 ${shadowY}px ${shadowBlur}px ${brand.colors.ink}${alphaHex(0.12)}`,
          backgroundColor: brand.colors.surface2,
          backdropFilter: glass ? 'blur(16px)' : undefined,
        }}
      >
        <div style={{position: 'absolute', top: stageTop, width: sourceViewport.width, height: sourceViewport.height, transform: `scale(${stageScale})`, transformOrigin: 'top left'}}>
          <CameraRig camera={camera} cameraViewport={sourceViewport}>
            {feature.screenshot ? <Img src={staticFile(feature.screenshot)} style={{width: sourceViewport.width, height: sourceViewport.height}} /> : null}
          </CameraRig>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DirectedDemo: React.FC<{demo: Props['demo']; brand: Brand; direction: Direction; shot: LaunchShot}> = ({demo, brand, direction, shot}) => {
  const {width, height, fps} = useVideoConfig();
  const format = useFormat();
  const viewport = demo.telemetry?.viewport ?? {width: 1600, height: 1000};
  const start = shot.source.kind === 'demo' ? shot.source.sourceStartFrame : 0;
  const frame = useCurrentFrame();
  const stage = (
    <Sequence from={-start} layout="none">
      <DemoStage video={demo.video} telemetry={demo.telemetry} timeMs={((frame + start) / fps) * 1000} brand={brand} />
    </Sequence>
  );
  // The master fills a 16:9 frame with the capture (a 16:10 plate loses ~5% of its
  // height, no text). Cover on a 1:1 or 9:16 canvas is a CENTRE CROP of the same plate:
  // at 1080 wide it keeps 56% (square) or 35% (portrait) of the capture's width and
  // slices the dashboard's own rows mid-word at both edges. Those canvases get the plate
  // CONTAINED instead — full width inside the safe area, letterboxed on the paper ground
  // under the direction's green rule.
  if (format.orientation !== 'landscape') {
    const box = containedStage(format, viewport);
    return (
      <AbsoluteFill style={{background: brand.colors.bg}}>
        <div
          style={{
            position: 'absolute',
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            borderTop: direction.material.edge === 'rule' ? `4px solid ${brand.colors.brand}` : undefined,
          }}
        >
          <div style={{width: viewport.width, height: viewport.height, transform: `scale(${box.scale})`, transformOrigin: 'top left'}}>
            {stage}
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  const cover = Math.max(width / viewport.width, height / viewport.height);
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', background: brand.colors.bg}}>
      <div style={{width: viewport.width, height: viewport.height, transform: `scale(${cover})`}}>{stage}</div>
    </AbsoluteFill>
  );
};

const DirectedAsset: React.FC<{shot: LaunchShot; brand: Brand}> = ({shot, brand}) => {
  if (shot.source.kind !== 'asset') return null;
  const mediaStyle: React.CSSProperties = {width: '100%', height: '100%', objectFit: shot.scale === 'wide' ? 'contain' : 'cover'};
  return (
    <AbsoluteFill style={{background: brand.colors.bg}}>
      {shot.source.media === 'image' ? (
        <Img src={staticFile(shot.source.path)} style={mediaStyle} />
      ) : (
        <Sequence from={-shot.source.sourceStartFrame} layout="none">
          <OffthreadVideo src={staticFile(shot.source.path)} muted style={mediaStyle} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

const DirectedEnd: React.FC<{cta: string; command: string | null; headline: string; brand: Brand; direction: Direction}> = ({cta, command, headline, brand, direction}) => {
  const {height, width} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const Mark = getMark(brand.id);
  if (direction.outro.kind === 'command') return <EndCard cta={cta} command={command} brand={brand} casing={direction.typography.casing} />;
  if (direction.outro.kind === 'lockup') {
    return (
      <AbsoluteFill style={{background: brand.colors.bg, justifyContent: 'center', alignItems: 'center', gap: height * 0.05}}>
        <Mark size={Math.round(height * 0.28)} color={brand.colors.brand} />
        <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: height * 0.065, color: brand.colors.ink, textAlign: 'center'}}>{cta}</div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{background: brand.colors.bg, justifyContent: 'center', padding: `0 ${width * 0.09}px`}}>
      <div style={{width: width * 0.12, height: 5, background: brand.colors.brand, marginBottom: height * 0.045}} />
      <div style={{fontFamily: fonts.mono, fontSize: height * 0.026, color: brand.colors.ink3, marginBottom: height * 0.025}}>{headline}</div>
      <div style={{fontFamily: fonts.display, fontWeight: 800, fontSize: height * 0.078, lineHeight: 1, color: brand.colors.ink, maxWidth: width * 0.72}}>{cta}</div>
    </AbsoluteFill>
  );
};

const DirectedShotContent: React.FC<{shot: LaunchShot; props: Props; brand: Brand; direction: Direction}> = ({shot, props, brand, direction}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const viewport = shot.sourceViewport ?? props.demo.telemetry?.viewport ?? {width: 1600, height: 1000};
  const focusFrames = shot.camera.cadence === 'locked' ? 1 : shot.camera.cadence === 'kinetic' ? 12 : 18;
  const camera = shot.focus
    // eslint-disable-next-line @remotion/non-pure-animation -- Timeline metadata, not a CSS transition
    ? cameraAtCues([{at: 0, subject: shot.focus, scale: shot.scale, transition: focusFrames, hold: Math.max(0, shot.len - focusFrames)}], frame, viewport)
    : null;
  const moving = shot.hero || shot.purpose === 'detail';
  const turn = moving && shot.camera.cadence === 'kinetic' ? {fromY: -5, toY: -1.2, len: shot.len, perspective: 2600} : null;
  const dolly = moving && shot.camera.cadence === 'measured' ? [{at: Math.round(shot.len * 0.16), dur: Math.round(shot.len * 0.62), to: 1.035}] : [];
  const content = (() => {
    if (shot.source.kind === 'logo') return <DirectedLogo assets={props.assets} len={shot.len} brand={brand} direction={direction} />;
    if (shot.source.kind === 'hook') return <DirectedHook kicker={props.kicker} headline={props.headline} brand={brand} direction={direction} copy={shot.copy} />;
    if (shot.source.kind === 'demo') return <DirectedDemo demo={props.demo} brand={brand} direction={direction} shot={shot} />;
    if (shot.source.kind === 'feature') {
      const feature = props.features[shot.source.index];
      return feature ? <DirectedFeature feature={feature} brand={brand} direction={direction} shot={shot} /> : null;
    }
    if (shot.source.kind === 'asset') return <DirectedAsset shot={shot} brand={brand} />;
    return <DirectedEnd cta={props.cta} command={props.command} headline={props.headline} brand={brand} direction={direction} />;
  })();
  return (
    <DirectedTransition shot={shot} direction={direction}>
      <CameraRig camera={shot.source.kind === 'feature' ? null : camera} cameraViewport={viewport} turn={shot.source.kind === 'feature' ? null : turn} dolly={shot.source.kind === 'feature' ? [] : dolly} dollyOrigin={`${width / 2}px ${height / 2}px`}>
        {content}
      </CameraRig>
    </DirectedTransition>
  );
};

export const LaunchVideo: React.FC<Props> = (props) => {
  const {brandId, kicker, headline, demo, features, cta, command, assets, audio, burnCaptions, motionOverride, actLengths, voTiming, hookFold, hookStamp, direction, shots} = props;
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const {orientation, scale, safe} = useFormat();
  const brand = getBrand(brandId);
  const m = motionOverride ? {...brand.motion, ...motionOverride} : brand.motion;
  // These four arguments MUST match Root.tsx's calculateMetadata exactly — a
  // mismatch silently truncates or pads the film.
  const t = launchTiming(
    demo.telemetry?.durationMs ?? null,
    features.length,
    actLengths,
    voTimingFrom(audio?.lines ?? null, features.length, {force: voTiming ?? null}),
  );
  const shotPlan = buildLaunchShotPlan({
    telemetryDurationMs: demo.telemetry?.durationMs ?? null,
    featureCount: features.length,
    lengths: actLengths,
    vo: voTimingFrom(audio?.lines ?? null, features.length, {force: voTiming ?? null}),
    direction,
    shots,
    fps,
    demoViewport: demo.telemetry?.viewport ?? null,
  });
  const cues = burnCaptions && audio ? captionCues(audio.lines, t, fps) : [];
  // Word-locked reveal cues (lib/wordCues). Built ONLY for an act whose manifest line
  // carries measured word times; every other act passes undefined and keeps its
  // stagger cascade, so a word-free brand renders byte-identically.
  const cueLine = (act: string) => {
    const line = audio?.lines.find((l) => l.act === act);
    return line?.words?.length ? line : null;
  };
  const hookLine = cueLine('hook');
  const hookCues = hookLine ? alignWordCues(headline.split(' '), hookLine, fps) : undefined;
  // The fold and the headline are two HITS inside one narration line, so they are
  // aligned in a SINGLE in-order pass: a separate call per beat would let the
  // headline's word match an earlier occurrence than the fold's.
  const foldBeats =
    hookFold && hookLine
      ? alignPhraseCues([hookFold.foldOnWord ?? '', hookFold.headlineOnWord ?? ''], hookLine, fps, {
          leadFrames: 0,
        })
      : [null, null];
  const directed = shotPlan.mode === 'directed' && shotPlan.direction;
  if (directed) {
    const directedTiming = timingFromShots(shotPlan.shots, audio?.lines.map((line) => line.act));
    const directedCaptions = burnCaptions && audio ? captionCues(audio.lines, directedTiming, fps) : [];
    const featureCueFrames = features.map((feature, i) => {
      const line = cueLine(`feature-${i}`);
      return line ? alignPhraseCues(feature.lines, line, fps) : [];
    });
    return (
      <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
        {shotPlan.shots.map((shot) => (
          <Sequence key={shot.id} name={shot.id} from={shot.from} durationInFrames={shot.len}>
            <DirectedShotContent shot={shot} props={props} brand={brand} direction={directed} />
          </Sequence>
        ))}
        {audio ? (
          <SoundTrack
            audio={audio}
            timing={directedTiming}
            shots={shotPlan.shots}
            featureLineCounts={features.map((feature) => feature.lines.length)}
            featureCueFrames={featureCueFrames}
            motion={m}
          />
        ) : null}
        {directedCaptions.length ? <CaptionTrack cues={directedCaptions} brand={brand} /> : null}
        <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
      </AbsoluteFill>
    );
  }
  // Three depth planes for the flat comp: the loop backdrop drifts most (far), the
  // wash sits mid, act content drifts least (near). Per-layer seeds keep the planes
  // from drifting in lockstep. At motion.parallax 0 every transform is '' and the
  // layers render inline — byte-identical to the flat render.
  const bgTransform = offsetTransform(parallaxOffset(frame, fps, 1, m, `${brandId}:bg`));
  // Overscan the full-frame backdrop while it drifts so the offset never exposes the
  // page bg at an edge; no overscan when it isn't drifting (preserves byte-identity).
  const bgLayer = bgTransform ? `${bgTransform} scale(1.03)` : '';
  const washTransform = offsetTransform(parallaxOffset(frame, fps, 0.6, m, `${brandId}:wash`));
  const contentTransform = offsetTransform(parallaxOffset(frame, fps, 0.25, m, `${brandId}:content`));
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
      {/* loop backdrop behind every act (far plane); the demo stage covers most of it */}
      <Depth transform={bgLayer}>
        <BackgroundLoop dir={assets.loopSequence} frameCount={assets.loopFrames} brand={brand} opacity={0.55} />
      </Depth>
      <Depth transform={washTransform}>
        <AbsoluteFill
          style={{
            background: `radial-gradient(${washGeom}, ${brand.colors.brand}${alphaHex(brand.effects.wash)}, transparent 72%)`,
          }}
        />
      </Depth>
      {/* act content = near plane (drifts least); each act settles at its own cut */}
      <Depth transform={contentTransform}>
        <Sequence durationInFrames={t.logo.len}>
          <ActContainer motion={m}>
            <LogoAct assets={assets} len={t.logo.len} brand={brand} />
          </ActContainer>
        </Sequence>
        <Sequence from={t.hook.from} durationInFrames={t.hook.len}>
          <ActContainer motion={m}>
            <HookAct
              kicker={kicker}
              headline={headline}
              len={t.hook.len}
              brand={brand}
              cueFrames={hookCues}
              fold={hookFold}
              foldFrame={foldBeats[0] ?? undefined}
              headlineFrame={foldBeats[1] ?? undefined}
              stamp={hookStamp}
            />
          </ActContainer>
        </Sequence>
        <Sequence from={t.demo.from} durationInFrames={t.demo.len}>
          <ActContainer motion={m}>
            <DemoAct demo={demo} len={t.demo.len} brand={brand} />
          </ActContainer>
        </Sequence>
        {features.map((feature, i) => {
          const line = cueLine(`feature-${i}`);
          return (
            <Sequence key={i} from={t.features[i].from} durationInFrames={t.features[i].len}>
              <ActContainer motion={m}>
                <FeatureAct
                  feature={feature}
                  len={t.features[i].len}
                  brand={brand}
                  seat={i}
                  cueFrames={line ? alignPhraseCues(feature.lines, line, fps) : undefined}
                />
              </ActContainer>
            </Sequence>
          );
        })}
        <Sequence from={t.end.from} durationInFrames={t.end.len}>
          <ActContainer motion={m}>
            <EndCard cta={cta} command={command} brand={brand} />
          </ActContainer>
        </Sequence>
      </Depth>
      {audio ? (
        <SoundTrack
          audio={audio}
          timing={t}
          // A staged act reveals no benefit lines, so sfxCues would tick against
          // nothing: report 0 display units for it.
          featureLineCounts={features.map((f) => (f.staged ? 0 : f.lines.length))}
          motion={m}
          // hookFold brands (quiet register, no hard-cut whoosh/riser): replace the
          // default cue table with the two fold-word-locked beats — a soft tick on
          // the fold, a low clunk on the count landing. Every brand without hookFold
          // keeps the default sfxCues() path, unchanged.
          cueOverride={hookFold ? foldCues(t.hook.from, foldBeats) : undefined}
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
