import React from 'react';
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {z} from 'zod';
import type {Brand} from '../lib/brand';
import {getBrand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {entrance} from '../lib/motion';
import {EndCard} from '../components/EndCard';
import {FilmGrade} from '../components/FilmGrade';
import {
  ClaudeHeader,
  ClaudeMessage,
  ClaudePrompt,
  ClaudeThinking,
  ClaudeToolCall,
  ClaudeWindow,
  defaultSessionTheme,
  type SessionTheme,
} from '../components/agent-session/ui';
import {isTyping, typeHuman} from '../components/agent-session/typing';
import {
  SESSION_LAYOUT,
  promptTypingOptions,
  sessionMetrics,
  sessionTiming,
  welcomeBoxHeight,
  type TimedBeat,
} from '../lib/sessionTiming';

// A Claude Code session, scripted beat by beat. Everything on screen is a pure
// function of the frame: the typing, the spinner glyph, the amber-to-green flip and
// the staged buffer scroll all read from lib/sessionTiming, which calculateMetadata
// reads too, so the allocated duration and the drawn frames cannot disagree.
//
// The terminal keeps Claude Code's own palette (components/agent-session/palette.ts)
// because the scene's whole claim is that this IS Claude Code. The brand enters
// through the theme below: its accent tints the MCP server prefix, its `safe` green
// marks a finished call, and its `loss` orange marks a call that finished but is
// parked on a human. Running stays Claude Code's amber, because "still working" is
// not a state the brand has a colour for.

const promptBeatSchema = z.object({kind: z.literal('prompt'), text: z.string()});
const sayBeatSchema = z.object({kind: z.literal('say'), text: z.string()});
const thinkBeatSchema = z.object({
  kind: z.literal('think'),
  verb: z.string(),
  frames: z.number().int().positive(),
});
const toolBeatSchema = z.object({
  kind: z.literal('tool'),
  tool: z.string(),
  // MCP calls render as `server - tool_name(arg)`; built-ins (Bash, Read) take no
  // prefix, which is what null means here.
  server: z.string().nullable(),
  arg: z.string(),
  pendingText: z.string(),
  doneText: z.string(),
  frames: z.number().int().positive(),
  status: z.enum(['success', 'hold']),
  expandable: z.boolean(),
});

export const agentSessionSchema = z.object({
  brandId: z.string(),
  header: z.object({
    user: z.string(),
    model: z.string(),
    cwd: z.string(),
    tips: z.array(z.string()),
  }),
  beats: z.array(
    z.discriminatedUnion('kind', [
      promptBeatSchema,
      sayBeatSchema,
      thinkBeatSchema,
      toolBeatSchema,
    ]),
  ),
  cta: z.string(),
  // Optional runnable one-liner under the CTA on the end card, same slot LaunchVideo
  // and SocialClip already render. Nullable so a brand with no command is unchanged.
  command: z.string().nullable().default(null),
  endHoldFrames: z.number().int().positive(),
});

type Props = z.infer<typeof agentSessionSchema>;

/** The Claude Code build the scene depicts. On screen in the welcome box border. */
const CLAUDE_CODE_VERSION = 'v2.1.206';

/** Frames the terminal takes to hand over to the end card. */
const HANDOVER_FRAMES = 12;

/** Frames a transcript block takes to fade and rise into place. */
const REVEAL_FRAMES = 10;

const sessionThemeFor = (brand: Brand, mono: string): SessionTheme => ({
  mono,
  fontSize: SESSION_LAYOUT.fontSize,
  // The MCP server namespace is a label, not a verdict. Off Localhost's voice reserves
  // green for done or passing, so the prefix takes the info token instead.
  serverTint: brand.colors.info,
  success: brand.colors.safe,
  pending: defaultSessionTheme.pending,
  hold: brand.colors.loss,
});

/** Fade and rise a transcript block in, on the brand's own motion curve. */
const Reveal: React.FC<{
  at: number;
  frame: number;
  fps: number;
  motion: Brand['motion'];
  children: React.ReactNode;
}> = ({at, frame, fps, motion, children}) => {
  if (frame < at) return null;
  const p = entrance(frame, fps, motion, {delayFrames: at, durFrames: REVEAL_FRAMES});
  return <div style={{opacity: p, transform: `translateY(${(1 - p) * 8}px)`}}>{children}</div>;
};

const BeatBlock: React.FC<{
  timed: TimedBeat;
  theme: SessionTheme;
  frame: number;
  fps: number;
  motion: Brand['motion'];
}> = ({timed, theme, frame, fps, motion}) => {
  const {beat, start, done, appearAt} = timed;
  if (beat.kind === 'think') {
    // The spinner holds the slot the next beat takes over the frame it stops, so it
    // never leaves a row behind. lib/sessionTiming models it as zero height for the
    // same reason.
    if (frame < start || frame >= done) return null;
    return <ClaudeThinking theme={theme} frame={frame} fps={fps} startFrame={start} verb={beat.verb} />;
  }
  if (beat.kind === 'prompt') {
    return (
      <Reveal at={appearAt} frame={frame} fps={fps} motion={motion}>
        <ClaudeMessage theme={theme} role="user">
          {beat.text}
        </ClaudeMessage>
      </Reveal>
    );
  }
  if (beat.kind === 'say') {
    return (
      <Reveal at={appearAt} frame={frame} fps={fps} motion={motion}>
        <ClaudeMessage theme={theme} bullet>
          {beat.text}
        </ClaudeMessage>
      </Reveal>
    );
  }
  // A tool is amber for its whole run and only then flips. Green on the first frame
  // reads as fake, and a `hold` never goes green at all.
  const finished = frame >= done;
  return (
    <Reveal at={appearAt} frame={frame} fps={fps} motion={motion}>
      <ClaudeToolCall
        theme={theme}
        tool={beat.tool}
        server={beat.server}
        arg={beat.arg}
        status={finished ? beat.status : 'pending'}
        expandable={beat.expandable && finished}
        result={finished ? beat.doneText : beat.pendingText}
      />
    </Reveal>
  );
};

export const AgentSession: React.FC<Props> = ({
  brandId,
  header,
  beats,
  cta,
  command,
  endHoldFrames,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const brand = getBrand(brandId);
  const fonts = loadBrandFonts(brand);
  const theme = sessionThemeFor(brand, fonts.mono);
  const m = sessionMetrics();
  const timeline = sessionTiming(fps, beats, {
    endHoldFrames,
    welcomeHeight: welcomeBoxHeight(header.tips.length),
  });

  const scrollY = interpolate(frame, timeline.scrollFrames, timeline.scrollOffsets, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // The hand-over is a cross-fade, not a cut: the window rides this out while EndCard
  // springs itself in from its own Sequence-local frame 0. Wrapping EndCard in a
  // second opacity ramp would multiply the two and make it arrive late and dim.
  const handover = entrance(frame, fps, brand.motion, {
    delayFrames: timeline.endCardFrom,
    durFrames: HANDOVER_FRAMES,
  });

  const typing = timeline.beats.find((t) => t.beat.kind === 'prompt' && frame < t.done);
  const typingText = typing && typing.beat.kind === 'prompt' ? typing.beat.text : '';
  const typingOpts = typing ? promptTypingOptions(typing.index) : undefined;

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg}}>
      <AbsoluteFill
        style={{alignItems: 'center', justifyContent: 'center', opacity: 1 - handover}}
      >
        <ClaudeWindow
          theme={theme}
          width={SESSION_LAYOUT.windowWidth}
          height={SESSION_LAYOUT.windowHeight}
          title={header.cwd}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                transform: `translateY(${scrollY}px)`,
                paddingTop: m.transcriptPadTop,
                display: 'flex',
                flexDirection: 'column',
                gap: m.blockGap,
              }}
            >
              <ClaudeHeader
                theme={theme}
                version={CLAUDE_CODE_VERSION}
                user={header.user}
                model={header.model}
                cwd={header.cwd}
                tips={header.tips}
              />
              {timeline.beats.map((timed) => (
                <BeatBlock
                  key={timed.index}
                  timed={timed}
                  theme={theme}
                  frame={frame}
                  fps={fps}
                  motion={brand.motion}
                />
              ))}
            </div>
          </div>
          <div style={{flexShrink: 0, paddingTop: theme.fontSize * 0.8}}>
            <ClaudePrompt
              theme={theme}
              frame={frame}
              fps={fps}
              focused={
                frame >= timeline.composer.focusFrom && frame < timeline.composer.focusUntil
              }
              caretSolid={
                typing ? isTyping(typingText, frame, typing.start, fps, typingOpts) : false
              }
              text={typing ? typeHuman(typingText, frame, typing.start, fps, typingOpts) : ''}
            />
          </div>
        </ClaudeWindow>
      </AbsoluteFill>
      <Sequence from={timeline.endCardFrom}>
        <EndCard cta={cta} command={command} brand={brand} />
      </Sequence>
      <FilmGrade grade={brand.grade} accent={brand.colors.brand} />
    </AbsoluteFill>
  );
};
