import React from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {z} from 'zod';
import {alphaHex, getBrand} from '../lib/brand';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {revealFragment, revealUnit} from '../lib/textReveal';
import {duckedVolume} from '../lib/audioMix';
import {useFormat} from '../lib/layout';
import type {Cue} from '../lib/captionTiming';
import {FloatBar} from '../components/FloatBar';
import {CaptionTrack} from '../components/CaptionTrack';
import {EndCard} from '../components/EndCard';
import {FilmGrade} from '../components/FilmGrade';
import {getMark} from '../brands/marks';

export const wrapClipSchema = z.object({
  brandId: z.string(),
  video: z.string().nullable(), // staged under studio/public/<brand>/, null = placeholder slate
  segment: z.object({startSec: z.number(), endSec: z.number(), title: z.string()}).nullable(),
  captions: z.array(z.object({startSec: z.number(), endSec: z.number(), text: z.string()})),
  cta: z.string(),
  music: z.string().nullable(), // optional bed, ducked under source audio
  formatWidth: z.number().optional(),
  formatHeight: z.number().optional(),
});

type Props = z.infer<typeof wrapClipSchema>;

const FPS = 30;
// ~1.5s hook title card before the source window opens.
export const TITLE_CARD_FRAMES = 45;
// EndCard tail — matches ProductDemo's 60-frame (2s) end-act convention.
export const END_CARD_FRAMES = 60;
// Placeholder source-window length when segment is null (smoke-safe slate) —
// matches launchTiming's DEMO_FALLBACK_LEN (8s).
export const FALLBACK_SOURCE_FRAMES = 240;

/** Pure duration calc — the single source of truth Root.tsx's calculateMetadata
 * calls, so the declared duration always matches what WrapClip actually renders. */
export const wrapDurationInFrames = (segment: Props['segment']): number => {
  const sourceFrames = segment
    ? Math.round((segment.endSec - segment.startSec) * FPS)
    : FALLBACK_SOURCE_FRAMES;
  return TITLE_CARD_FRAMES + sourceFrames + END_CARD_FRAMES;
};

// Hook title card: segment.title through the brand's textReveal preset. Mirrors
// Headline.tsx's word/char reveal loop (same lib/textReveal + lib/motion machinery)
// without the kicker line — WrapClip has no kicker in its schema.
const TitleCard: React.FC<{title: string; brand: Brand; scale: number}> = ({title, brand, scale}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const preset = brand.motion.textReveal;
  const words = title.split(' ');
  const byChar = revealUnit(preset, title) === 'char';
  const totalChars = words.reduce((n, w) => n + w.length, 0);
  const wordCharStart: number[] = [];
  words.reduce((acc, w, i) => {
    wordCharStart[i] = acc;
    return acc + w.length;
  }, 0);
  const wordStyle: React.CSSProperties = {
    fontFamily: fonts.display,
    fontWeight: 800,
    fontSize: Math.round(84 * scale),
    lineHeight: 1.12,
    color: brand.colors.ink,
    display: 'inline-block',
  };
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: `0 ${Math.round(20 * scale)}px`,
          maxWidth: Math.round(1500 * scale),
          padding: `0 ${Math.round(120 * scale)}px`,
          textAlign: 'center',
        }}
      >
        {words.map((w, i) => {
          if (!byChar) {
            const frag = revealFragment(preset, {frame, fps, motion: brand.motion, index: i, total: words.length, scale});
            return (
              <span key={i} style={{...wordStyle, ...frag}}>
                {w}
              </span>
            );
          }
          return (
            <span key={i} style={wordStyle}>
              {w.split('').map((ch, j) => {
                const frag = revealFragment(preset, {
                  frame,
                  fps,
                  motion: brand.motion,
                  index: wordCharStart[i] + j,
                  total: totalChars,
                  scale,
                });
                return (
                  <span key={j} style={{display: 'inline-block', ...frag}}>
                    {ch}
                  </span>
                );
              })}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Source video window: the DemoStage card language (border/radius/shadow, capture
// filter, Mark placeholder on null) without DemoStage's telemetry-driven camera
// zoom/cursor — this plays real editorial footage windowed via startFrom/endAt, not
// a synthetic browser recording.
const SourceWindow: React.FC<{
  video: string | null;
  segment: {startSec: number; endSec: number} | null;
  fps: number;
  brand: Brand;
  scale: number;
}> = ({video, segment, fps, brand, scale}) => {
  const Mark = getMark(brand.id);
  const width = Math.round(1600 * scale);
  const height = Math.round(900 * scale);
  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          width,
          height,
          borderRadius: Math.round(14 * scale),
          border: `1px solid ${brand.colors.line}`,
          background: brand.colors.surface,
          overflow: 'hidden',
          boxShadow: `0 40px 120px ${brand.colors.bg}`,
        }}
      >
        {video && segment ? (
          <OffthreadVideo
            src={staticFile(video)}
            trimBefore={Math.round(segment.startSec * fps)}
            trimAfter={Math.round(segment.endSec * fps)}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              filter: 'brightness(1.12) contrast(1.03)',
            }}
          />
        ) : (
          <AbsoluteFill style={{background: brand.colors.surface2, justifyContent: 'center', alignItems: 'center'}}>
            <Mark size={Math.round(120 * scale)} color={brand.colors.line} />
          </AbsoluteFill>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const WrapClip: React.FC<Props> = ({brandId, video, segment, captions, cta, music}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const {scale, safe} = useFormat();
  const brand = getBrand(brandId);

  const sourceFrames = segment
    ? Math.round((segment.endSec - segment.startSec) * fps)
    : FALLBACK_SOURCE_FRAMES;
  const sourceFrom = TITLE_CARD_FRAMES;
  const endFrom = sourceFrom + sourceFrames;

  // Caption cues arrive pre-windowed to the segment (0 == segment start); shift
  // them by the title-card duration so they land on the source window's frames.
  const cues: Cue[] = captions.map((c) => ({
    text: c.text,
    fromFrame: sourceFrom + Math.round(c.startSec * fps),
    toFrame: sourceFrom + Math.round(c.endSec * fps),
  }));

  // Music ducks under the source window's own narration audio for its whole span.
  const musicWindows = [{fromFrame: sourceFrom, toFrame: endFrom}];

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 55% at 50% 32%, ${brand.colors.brand}${alphaHex(brand.effects.wash)}, transparent 72%)`,
        }}
      />
      <Sequence durationInFrames={TITLE_CARD_FRAMES}>
        <TitleCard title={segment?.title ?? brand.tagline} brand={brand} scale={scale} />
      </Sequence>
      <Sequence from={sourceFrom} durationInFrames={sourceFrames}>
        <SourceWindow video={video} segment={segment} fps={fps} brand={brand} scale={scale} />
      </Sequence>
      <Sequence from={endFrom}>
        <EndCard cta={cta} brand={brand} />
      </Sequence>
      {music ? (
        <Html5Audio
          src={staticFile(music)}
          volume={(f) => duckedVolume(f, musicWindows, durationInFrames)}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          bottom: Math.max(Math.round(40 * scale), safe.bottom),
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <FloatBar progress={frame / (durationInFrames - 1)} brand={brand} width={Math.round(640 * scale)} />
      </div>
      {cues.length ? <CaptionTrack cues={cues} brand={brand} /> : null}
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
