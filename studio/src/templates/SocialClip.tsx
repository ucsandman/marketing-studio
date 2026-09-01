import React from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import {alphaHex, getBrand} from '../lib/brand';
import {FloatBar} from '../components/FloatBar';
import {EndCard} from '../components/EndCard';
import {Headline} from '../components/Headline';
import {FeaturePanel} from '../components/FeaturePanel';
import {FilmGrade} from '../components/FilmGrade';
import {CaptionTrack} from '../components/CaptionTrack';
import {useFormat} from '../lib/layout';
import {sequentialCues} from '../lib/captionTiming';

export const socialClipSchema = z.object({
  brandId: z.string(),
  kicker: z.string(),
  headline: z.string(),
  lines: z.array(z.string()).min(1).max(4),
  screenshot: z.string().nullable(),
  portraitScreenshot: z.string().optional(),
  cta: z.string(),
  // Optional runnable command shown on the end card under the CTA (mono, verbatim,
  // never uppercased) -- same slot LaunchVideo's EndCard already renders. Nullable
  // so brands/clips with no command stay byte-identical.
  command: z.string().nullable().default(null),
  // Optional raw demo footage played muted, full-bleed, behind the opening headline
  // act so the clip opens on the product moving rather than static text. Nullable
  // so every existing social clip prop file (no video) renders byte-identical.
  video: z.string().nullable().default(null),
  // Where in the source footage (in composition frames, i.e. seconds * fps) the
  // video Sequence starts from. Nullable so existing video clips (tuned against
  // the old hardcoded 120) render byte-identical; only a brand whose money-shot
  // moment lands elsewhere needs to set this.
  videoStartFrame: z.number().int().nonnegative().nullable().default(null),
  // Crop the source to one content region (in source pixels) and scale it to fill
  // the frame's width, instead of letterboxing the whole plate. `contain` (below)
  // stops slicing text but on a 9:16 frame it also shrinks a 16:9 plate to a
  // fraction of the frame width, too small to read on a phone. A region tight
  // around one complete piece of content (no line half-cut at its own edges) fixes
  // both: legible size, and the letterbox math (frame width / region.w) still
  // determines the scale, so whatever's left top/bottom is real empty ground.
  // Nullable so the default is the existing `contain` behaviour, unchanged.
  videoCropRegion: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      sourceWidth: z.number(),
      sourceHeight: z.number(),
    })
    .nullable()
    .default(null),
  // Burn VO lines into on-screen captions for muted autoplay. SocialClip has no
  // audio track, so caption text arrives via the optional `voLines` prop (the
  // props builder is the sole writer, only when audio props exist). Default
  // false/null keeps normal renders/smoke byte-identical.
  burnCaptions: z.boolean().default(false),
  voLines: z
    .array(z.object({act: z.string(), text: z.string(), durationMs: z.number().positive()}))
    .nullable()
    .default(null),
  // Optional responsive-matrix overrides read by calculateMetadata (Root.tsx);
  // absent for normal renders/smoke so the declared 1920x1080 is untouched.
  formatWidth: z.number().int().positive().optional(),
  formatHeight: z.number().int().positive().optional(),
});

type Props = z.infer<typeof socialClipSchema>;

export const SocialClip: React.FC<Props> = ({
  brandId,
  kicker,
  headline,
  lines,
  screenshot,
  portraitScreenshot,
  cta,
  command,
  video,
  videoStartFrame,
  videoCropRegion,
  burnCaptions,
  voLines,
}) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const {orientation, scale, width: frameWidth, height: frameHeight, safe} = useFormat();
  // Region -> on-screen transform: scale so the region's width fills the frame,
  // then position so the region's top-left lands at the frame's origin and the
  // region sits vertically centred (whatever's left top/bottom is empty ground).
  const cropScale = videoCropRegion ? frameWidth / videoCropRegion.w : 1;
  const cropLeft = videoCropRegion ? -videoCropRegion.x * cropScale : 0;
  const cropTop = videoCropRegion
    ? (frameHeight - videoCropRegion.h * cropScale) / 2 - videoCropRegion.y * cropScale
    : 0;
  const brand = getBrand(brandId);
  const cues = burnCaptions && voLines ? sequentialCues(voLines, fps, durationInFrames) : [];
  const fadeAt = (start: number, end: number) =>
    interpolate(frame, [start, start + 12, end - 12, end], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  const washGeom =
    orientation === 'portrait'
      ? '88% 44% at 50% 32%'
      : orientation === 'square'
        ? '70% 56% at 50% 36%'
        : '60% 50% at 50% 35%';
  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      {video ? (
        <Sequence durationInFrames={90}>
          <AbsoluteFill style={{opacity: fadeAt(0, 90), overflow: 'hidden'}}>
            {videoCropRegion ? (
              // OffthreadVideo does not reliably honor an explicit pixel width/height/
              // left/top passed straight to it (verified: a plain sibling div DOES
              // respect the identical style, OffthreadVideo silently does not). So the
              // crop+reposition math lands on a plain wrapper div sized to the region's
              // scaled full-source footprint, and OffthreadVideo inside it goes back to
              // its own proven-working `100%/100%/contain` — same-aspect box, so contain
              // is a no-op fit, not a letterbox.
              <div
                style={{
                  position: 'absolute',
                  width: videoCropRegion.sourceWidth * cropScale,
                  height: videoCropRegion.sourceHeight * cropScale,
                  left: cropLeft,
                  top: cropTop,
                }}
              >
                <OffthreadVideo
                  src={staticFile(video)}
                  muted
                  startFrom={videoStartFrame ?? 120}
                  style={{width: '100%', height: '100%', objectFit: 'contain', display: 'block'}}
                />
              </div>
            ) : (
              <OffthreadVideo
                src={staticFile(video)}
                muted
                // Default 120 (4s in): past the blank prompt, into the scrolling
                // report body (the recoverable-spend line itself passes through),
                // so the opening motion is legible content, not empty terminal.
                // `videoStartFrame` overrides this per brand for a different money shot.
                startFrom={videoStartFrame ?? 120}
                // 'contain', not 'cover': a 16:9 source into a 9:16 frame under cover
                // keeps only a ~32%-wide center sliver of the plate, which slices clean
                // through any on-screen line of text. Contain shows the whole frame
                // (letterboxed into the brand ground behind it); a same-aspect landscape
                // render is unaffected (contain == cover when source and frame match).
                style={{width: '100%', height: '100%', objectFit: 'contain', display: 'block'}}
              />
            )}
            {/* Paper-toned scrim: keeps the opening headline legible over moving
                footage without going to a dark-terminal look (brand voice is white
                paper, never dark). */}
            <AbsoluteFill style={{background: `${brand.colors.bg}${alphaHex(0.52)}`}} />
          </AbsoluteFill>
        </Sequence>
      ) : null}
      <AbsoluteFill
        style={{
          background: `radial-gradient(${washGeom}, ${brand.colors.brand}${alphaHex(brand.effects.wash)}, transparent 70%)`,
        }}
      />
      <Sequence durationInFrames={90}>
        <AbsoluteFill style={{opacity: fadeAt(0, 90)}}>
          <Headline
            kicker={kicker}
            headline={headline}
            brand={brand}
            hideKicker={Boolean(video)}
            scrim={Boolean(video)}
            topAlign={Boolean(video)}
          />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={78} durationInFrames={162}>
        <AbsoluteFill style={{opacity: fadeAt(78, 240)}}>
          <FeaturePanel
            screenshot={screenshot}
            portraitScreenshot={portraitScreenshot}
            lines={lines}
            brand={brand}
            zoom={{from: 1, to: 1.04, origin: '50% 30%'}}
          />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={228}>
        <EndCard cta={cta} command={command} brand={brand} />
      </Sequence>
      {/* progress float bar, pinned bottom */}
      <div style={{position: 'absolute', bottom: Math.max(Math.round(48 * scale), safe.bottom), left: 0, right: 0, display: 'flex', justifyContent: 'center'}}>
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={Math.round(640 * scale)} />
      </div>
      {cues.length ? <CaptionTrack cues={cues} brand={brand} /> : null}
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
