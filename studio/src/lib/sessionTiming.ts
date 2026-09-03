// The extension is deliberate, like lib/wordCues.ts's: scripts/build-offlocalhost-session-audio.mjs
// loads this file through Node type-stripping, which does no extensionless resolution.
import {settleDelayInFrames, typingDurationInFrames} from '../components/agent-session/typing.ts';

// THE timeline and layout math for the AgentSession composition. Pure: no DOM, no
// Remotion, no clock. `calculateMetadata` and the component both read this, so the
// duration a render is allocated and the frames the component draws on can never
// disagree (PLAYBOOK: duration math lives in ONE pure lib, the rule launchTiming.ts
// already follows).
//
// The layout half lives here too, because the staged buffer scroll is a function of
// how tall the transcript has grown, and a scroll offset is timeline math. ui.tsx
// writes its styles in the SAME multiples of fontSize that sessionMetrics() derives,
// so the model and the DOM stay in step without measuring anything.

export type PromptBeat = {kind: 'prompt'; text: string};
export type SayBeat = {kind: 'say'; text: string};
export type ThinkBeat = {kind: 'think'; verb: string; frames: number};
export type ToolBeat = {
  kind: 'tool';
  tool: string;
  server: string | null;
  arg: string;
  pendingText: string;
  doneText: string;
  frames: number;
  /** Where the call lands: green when it is finished, orange when it is finished but
   *  parked on a human decision. A `hold` never flips to success. */
  status: 'success' | 'hold';
  expandable: boolean;
};
export type SessionBeat = PromptBeat | SayBeat | ThinkBeat | ToolBeat;

/** Frames of dead air before the human starts typing the first prompt. */
export const OPEN_FRAMES = 30;

/** Gap between consecutive agent actions, before its own seeded jitter. */
export const AGENT_PAUSE_SECONDS = 1.2;

/** Human typing speed for a prompt, characters per second. */
export const PROMPT_CPS = 25;

/** How long an assistant line holds before the next beat: a skim rate, floored so a
 *  short line still registers and ceilinged so a long one does not stall the film. */
export const SAY_WORDS_PER_SECOND = 4;
export const SAY_MIN_SECONDS = 1.2;
export const SAY_MAX_SECONDS = 4;

/** How far above the window's bottom edge a scroll stage parks the newest line. Three
 *  lines of headroom means the next beat lands without triggering another jump, which
 *  is what makes the buffer move in stages instead of crawling on every beat. */
export const SCROLL_SLACK_LINES = 3;

/** Frames a scroll stage takes, split around the frame the new line appears on. */
export const SCROLL_LEAD = 8;
export const SCROLL_TRAIL = 10;

export type SessionLayout = {
  fontSize: number;
  windowWidth: number;
  windowHeight: number;
};

export const SESSION_LAYOUT: SessionLayout = {
  fontSize: 22,
  windowWidth: 1680,
  windowHeight: 940,
};

/** Window chrome bar height, in px. Fixed in ui.tsx, not derived from the font. */
export const CHROME_HEIGHT = 48;

/**
 * Every pixel measurement ui.tsx renders and the scroll model reasons about. The
 * multipliers mirror the style values in ui.tsx one for one; change one and change
 * the other.
 */
export const sessionMetrics = (layout: SessionLayout = SESSION_LAYOUT) => {
  const fs = layout.fontSize;
  const padX = fs * 1.3; // ClaudeWindow body padding
  const padY = fs * 1.1;
  const contentWidth = layout.windowWidth - padX * 2;
  // IBM Plex Mono's advance is exactly 600/1000 em, so this is a fact, not a guess.
  // One column of slack absorbs the difference between a greedy model wrap and the
  // browser's, and the viewport clips rather than seams if it is ever wrong.
  const charWidth = fs * 0.6;
  const cols = Math.floor(contentWidth / charWidth) - 1;
  // ClaudePrompt: effort chip, the ruled input row, the mode line, and the pad above.
  const composerHeight =
    fs * 0.92 * 1.6 +
    fs * 0.2 +
    (fs * 1.6 + fs * 0.5 + 2) +
    (fs * 0.35 + fs * 0.92 * 1.6) +
    fs * 0.8;
  const transcriptPadTop = fs * 0.75; // room for the welcome box's title-in-border
  return {
    fontSize: fs,
    padX,
    padY,
    contentWidth,
    cols,
    /** ClaudeMessage assistant lineHeight. */
    messageLine: fs * 1.6,
    /** ClaudeToolCall and the user row lineHeight. */
    toolLine: fs * 1.55,
    blockGap: fs * 0.7,
    transcriptPadTop,
    composerHeight,
    viewportHeight:
      layout.windowHeight - CHROME_HEIGHT - padY * 2 - composerHeight - transcriptPadTop,
  };
};

/** Height of the Claude Code launch sprite in ClaudeHeader, in px. Fixed by the
 *  bitmap (5 rows x 2.4 stretch x scale 5), not derived from the font. */
const LOGO_HEIGHT = 60;

/**
 * Height of the welcome box, which sits above the first beat and therefore sets where
 * the transcript starts overflowing. Mirrors ClaudeHeader's own box model: the two
 * columns are the identity block and the tips block, and the taller one wins.
 */
export const welcomeBoxHeight = (tips: number, layout: SessionLayout = SESSION_LAYOUT): number => {
  const fs = layout.fontSize;
  const row = fs * 1.5; // ClaudeHeader lineHeight
  const identity = row + fs * 0.3 * 2 + (fs * 0.35 * 2 + LOGO_HEIGHT) + row * 2;
  return Math.max(identity, row * (1 + tips)) + fs * 0.9 + fs * 0.8 + 2;
};

/**
 * Lines a string occupies at `cols` columns, wrapped greedily on spaces the way a
 * browser does, hard-breaking any token longer than the line the way
 * `overflow-wrap: anywhere` does (paths and URLs are exactly that case).
 */
export const wrappedLines = (text: string, cols: number): number => {
  if (cols <= 0) return 1;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let col = 0;
  for (const word of words) {
    const need = col === 0 ? word.length : word.length + 1;
    if (col + need <= cols) {
      col += need;
      continue;
    }
    if (col > 0) {
      lines += 1;
      col = 0;
    }
    let rest = word;
    while (rest.length > cols) {
      rest = rest.slice(cols);
      lines += 1;
    }
    col = rest.length;
  }
  return lines;
};

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** Frames an assistant line holds before the next beat starts. */
export const sayHoldFrames = (text: string, fps: number): number =>
  Math.min(
    Math.round(SAY_MAX_SECONDS * fps),
    Math.max(
      Math.round(SAY_MIN_SECONDS * fps),
      Math.round((wordCount(text) / SAY_WORDS_PER_SECOND) * fps),
    ),
  );

export type TimedBeat = {
  beat: SessionBeat;
  index: number;
  /** Frame the beat's clock starts: typing begins, spinner spins, tool goes amber. */
  start: number;
  /** Frame the beat is finished: prompt submitted, spinner done, tool flipped. */
  done: number;
  /** Frame the beat's block joins the transcript. A prompt only appears once it is
   *  submitted, so this is its `done`; everything else appears at `start`. */
  appearAt: number;
  /** Permanent transcript height in px. A think beat is 0: the spinner occupies the
   *  slot the next beat takes over, so it never adds a row of its own. */
  height: number;
  /** Seeds this beat owns. Every pause draws its own; reusing one would defeat the
   *  jitter that stops the pacing reading as a metronome. */
  seeds: string[];
};

export type ScrollStage = {from: number; to: number; offset: number};

export type SessionTimeline = {
  beats: TimedBeat[];
  /** Composer focus window: it lights up just before the first keystroke and goes
   *  back to its unfocused placeholder on the closing assistant line. */
  composer: {focusFrom: number; focusUntil: number};
  scrollStages: ScrollStage[];
  /** Ready for a single interpolate() call: frames ascending, offsets negative px. */
  scrollFrames: number[];
  scrollOffsets: number[];
  /** Frame the terminal hands over to the end card. */
  endCardFrom: number;
  durationInFrames: number;
};

const promptTypeSeed = (index: number): string => `prompt-type-${index}`;
const promptSettleSeed = (index: number): string => `prompt-settle-${index}`;
const agentPauseSeed = (index: number): string => `agent-pause-${index}`;

/** Typing options for the prompt at `index`. The component types with these; the
 *  timeline measures with these. One source, or the caret outruns the submit. */
export const promptTypingOptions = (index: number) => ({
  cps: PROMPT_CPS,
  seed: promptTypeSeed(index),
});

const beatHeight = (beat: SessionBeat, m: ReturnType<typeof sessionMetrics>): number => {
  switch (beat.kind) {
    case 'prompt':
      // the dark row is inset by the caret glyph and one cell of gap
      return wrappedLines(beat.text, m.cols - 2) * m.toolLine;
    case 'say':
      // the rose dot and its space sit inline ahead of the first line
      return wrappedLines(beat.text, m.cols - 2) * m.messageLine;
    case 'think':
      return 0;
    case 'tool': {
      const head = `${beat.server ? `${beat.server} - ` : ''}${beat.tool}(${beat.arg})`;
      const result = beat.expandable ? `${beat.doneText} (ctrl+o to expand)` : beat.doneText;
      // the result row is inset by two glyphs and two cells of gap
      return (wrappedLines(head, m.cols - 2) + wrappedLines(result, m.cols - 4)) * m.toolLine;
    }
  }
};

/**
 * Walk the timeline forward from the first keystroke. Nothing is a fixed offset, so
 * editing one beat's `frames` reflows every beat after it by exactly that amount.
 */
export const sessionTiming = (
  fps: number,
  beats: SessionBeat[],
  opts: {endHoldFrames: number; welcomeHeight?: number; layout?: SessionLayout},
): SessionTimeline => {
  const m = sessionMetrics(opts.layout ?? SESSION_LAYOUT);
  const agentPause = (index: number): number =>
    settleDelayInFrames(fps, {seconds: AGENT_PAUSE_SECONDS, seed: agentPauseSeed(index)});

  let cursor = OPEN_FRAMES;
  const timed: TimedBeat[] = beats.map((beat, index) => {
    const start = cursor;
    let done = start;
    const seeds: string[] = [];
    if (beat.kind === 'prompt') {
      seeds.push(promptTypeSeed(index), promptSettleSeed(index));
      done =
        start +
        typingDurationInFrames(beat.text, fps, promptTypingOptions(index)) +
        settleDelayInFrames(fps, {seed: promptSettleSeed(index)});
    } else if (beat.kind === 'say') {
      done = start + sayHoldFrames(beat.text, fps);
    } else {
      done = start + beat.frames;
    }
    // A spinner is not a pause: the beat it is waiting on takes its slot the frame it
    // stops. Everything else gets its own seeded gap before the next action.
    if (beat.kind === 'think') {
      cursor = done;
    } else {
      seeds.push(agentPauseSeed(index));
      cursor = done + agentPause(index);
    }
    return {
      beat,
      index,
      start,
      done,
      appearAt: beat.kind === 'prompt' ? done : start,
      height: beatHeight(beat, m),
      seeds,
    };
  });

  // Staged buffer scroll: the transcript grows downward and the window jumps only
  // when the newest block would fall off the bottom edge.
  const stages: ScrollStage[] = [];
  const slack = SCROLL_SLACK_LINES * m.toolLine;
  let bottom = (opts.welcomeHeight ?? 0) + m.blockGap;
  let offset = 0;
  let lastTo = -Infinity;
  for (const t of timed) {
    if (t.height === 0) continue;
    bottom += t.height + m.blockGap;
    if (bottom <= offset + m.viewportHeight) continue;
    offset = Math.round(bottom - m.viewportHeight + slack);
    let from = t.appearAt - SCROLL_LEAD;
    if (from <= lastTo) from = lastTo + 1;
    const to = Math.max(t.appearAt + SCROLL_TRAIL, from + 1);
    lastTo = to;
    stages.push({from, to, offset});
  }

  const scrollFrames: number[] = [];
  const scrollOffsets: number[] = [];
  let held = 0;
  for (const stage of stages) {
    scrollFrames.push(stage.from, stage.to);
    // `-held` on the first stage would be negative zero, which is a real value in a
    // toBe() and a needless surprise in an interpolate range.
    scrollOffsets.push(held === 0 ? 0 : -held, -stage.offset);
    held = stage.offset;
  }
  if (scrollFrames.length === 0) {
    // interpolate() needs two points even when nothing ever overflows.
    scrollFrames.push(0, 1);
    scrollOffsets.push(0, 0);
  }

  const last = timed[timed.length - 1];
  const firstPrompt = timed.find((t) => t.beat.kind === 'prompt');
  const lastDone = last ? last.done : 0;
  return {
    beats: timed,
    composer: {
      focusFrom: firstPrompt ? firstPrompt.start - SCROLL_LEAD : 0,
      focusUntil: last && last.beat.kind === 'say' ? last.start : lastDone,
    },
    scrollStages: stages,
    scrollFrames,
    scrollOffsets,
    endCardFrom: lastDone,
    durationInFrames: lastDone + opts.endHoldFrames,
  };
};
