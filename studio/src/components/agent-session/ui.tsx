import React from 'react';
import {cc, dots} from './palette';

// Claude Code terminal UI primitives, rewritten from the `claude-code-remotion` skill
// by flocker.md (MIT, 2026) into this repo's conventions. Every component is generic:
// no product strings, no brand colours baked in. Everything animatable is derived
// from the `frame` passed in, so a distributed render is deterministic. No
// setInterval, no useState, no CSS keyframes.
//
// The palette in ./palette.ts is Claude Code's own. A BRAND enters only through the
// theme below, which is how the MCP server tint, the success green and the `hold`
// orange stay brand tokens while the terminal itself stays Claude Code.

export type SessionTheme = {
  /** Mono family, normally loadBrandFonts(brand).mono. */
  mono: string;
  /** Base terminal font size; every other size here derives from it. */
  fontSize: number;
  /** MCP server prefix tint. The one place a brand accent belongs in the transcript. */
  serverTint: string;
  /** A finished tool call: a brand's "live, done, a passing gate" token. */
  success: string;
  /** A call still running. Claude Code's own amber, deliberately not a brand token:
   *  running is not a state the brand has a colour for. */
  pending: string;
  /** Finished, but parked on a human decision: a brand's "the human still has to act"
   *  token. A hold never flips to success. */
  hold: string;
};

export const defaultSessionTheme: SessionTheme = {
  mono: "'SF Mono', 'Menlo', 'Monaco', 'Roboto Mono', 'Courier New', monospace",
  fontSize: 26,
  serverTint: cc.cyan,
  success: cc.green,
  pending: cc.amber,
  hold: cc.rose,
};

// ---------------------------------------------------------------------------
// Caret
// ---------------------------------------------------------------------------

/**
 * Block cursor, blinking on a 2Hz cycle. `solid` holds it lit: a real caret stops
 * blinking while keys are landing and resumes once the hand stops (see ./typing.ts).
 */
export const Caret: React.FC<{frame: number; fps: number; solid?: boolean}> = ({
  frame,
  fps,
  solid = false,
}) => (
  <span
    style={{
      display: 'inline-block',
      width: '0.6em',
      height: '1.05em',
      background: cc.fg,
      verticalAlign: 'text-bottom',
      opacity: solid || Math.floor((frame / fps) * 2) % 2 === 0 ? 1 : 0,
    }}
  />
);

// ---------------------------------------------------------------------------
// Welcome box
// ---------------------------------------------------------------------------

const CLAUDE_LOGO_BITS = [
  '000111111111111000',
  '000110111111011000',
  '011111111111111110',
  '000111111111111000',
  '000010100001010000',
];

/** Claude Code's launch sprite, drawn as a crisp SVG grid. */
export const ClaudeLogo: React.FC<{scale?: number; color?: string}> = ({
  scale = 5,
  color = cc.rose,
}) => {
  const w = CLAUDE_LOGO_BITS[0].length;
  const h = CLAUDE_LOGO_BITS.length;
  // Terminal cells are taller than wide; stretch each sprite pixel vertically so the
  // logo keeps its proportions instead of looking squat.
  const PH = 2.4;
  const rects: React.ReactElement[] = [];
  CLAUDE_LOGO_BITS.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      if (row[x] === '1') {
        let end = x;
        while (end < w && row[end] === '1') end += 1;
        rects.push(<rect key={`${x}-${y}`} x={x} y={y * PH} width={end - x} height={PH} />);
        x = end;
      } else {
        x += 1;
      }
    }
  });
  return (
    <svg
      width={w * scale}
      height={h * PH * scale}
      viewBox={`0 0 ${w} ${h * PH}`}
      shapeRendering="crispEdges"
      fill={color}
    >
      {rects}
    </svg>
  );
};

export const ClaudeHeader: React.FC<{
  theme: SessionTheme;
  version: string;
  user: string;
  model: string;
  cwd: string;
  tips: string[];
}> = ({theme, version, user, model, cwd, tips}) => {
  const fs = theme.fontSize;
  return (
    <div
      style={{
        position: 'relative',
        border: `1px solid ${cc.rose}`,
        borderRadius: 6,
        padding: `${fs * 0.9}px ${fs}px ${fs * 0.8}px`,
        fontFamily: theme.mono,
        fontSize: fs,
        lineHeight: 1.5,
        color: cc.fg,
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 1px minmax(0,1.1fr)',
        gap: fs * 1.4,
      }}
    >
      {/* title-in-the-border */}
      <span
        style={{
          position: 'absolute',
          top: -fs * 0.62,
          left: fs * 0.8,
          padding: `0 ${fs * 0.4}px`,
          background: cc.bg,
          color: cc.rose,
          whiteSpace: 'nowrap',
        }}
      >
        Claude Code <span style={{color: cc.gray}}>{version}</span>
      </span>

      {/* left: identity */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: fs * 0.3,
          textAlign: 'center',
        }}
      >
        <div style={{fontWeight: 600}}>Welcome back {user}!</div>
        <div style={{margin: `${fs * 0.35}px 0`}}>
          <ClaudeLogo />
        </div>
        <div style={{color: cc.gray}}>
          <div>{model}</div>
          <div>{cwd}</div>
        </div>
      </div>

      <div style={{background: `${cc.rose}55`}} />

      {/* right: tips */}
      <div>
        <div style={{color: cc.rose, fontWeight: 600}}>Tips for getting started</div>
        {tips.map((t) => (
          <div key={t}>{t}</div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Conversation turns
// ---------------------------------------------------------------------------

/**
 * A conversation turn. User turns get the full-width dark caret row; `bullet` puts
 * the terracotta dot Claude Code prefixes its own lines with ahead of an assistant
 * one (kept inside the kit so a template never has to reach for a raw hex).
 */
export const ClaudeMessage: React.FC<{
  theme: SessionTheme;
  role?: 'user' | 'assistant';
  bullet?: boolean;
  children: React.ReactNode;
}> = ({theme, role = 'assistant', bullet = false, children}) => {
  const fs = theme.fontSize;
  if (role === 'user') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          background: cc.userRow,
          fontFamily: theme.mono,
          fontSize: fs,
          lineHeight: 1.55,
        }}
      >
        <span style={{color: cc.userCaret, flexShrink: 0}}>❯</span>
        {/* one terminal cell of gap: a trailing space in a flex child collapses */}
        <span style={{display: 'inline-block', width: '1ch', flexShrink: 0}} />
        <span style={{color: cc.userText, flex: 1, minWidth: 0, overflowWrap: 'anywhere'}}>
          {children}
        </span>
      </div>
    );
  }
  // Laid out like the tool row rather than as inline text, so a line that wraps hangs
  // under the first line's text instead of sliding back under the bullet.
  return (
    <div
      style={{
        fontFamily: theme.mono,
        fontSize: fs,
        lineHeight: 1.6,
        color: cc.fg,
        display: 'flex',
        alignItems: 'baseline',
        gap: '1ch',
      }}
    >
      {bullet ? <span style={{color: cc.rose, flexShrink: 0}}>⏺</span> : null}
      <span style={{minWidth: 0, overflowWrap: 'anywhere'}}>{children}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tool call
// ---------------------------------------------------------------------------

export type ToolStatus = 'success' | 'error' | 'pending' | 'hold';

const statusColor = (status: ToolStatus, theme: SessionTheme): string => {
  if (status === 'success') return theme.success;
  if (status === 'pending') return theme.pending;
  if (status === 'hold') return theme.hold;
  return cc.error;
};

/**
 * A collapsed tool/result pair: the tool line over its result line.
 *
 * `server` renders the MCP server prefix (`offlocal - preflight_launch`) in the
 * theme's accent, which is what separates an MCP tool from a built-in one.
 * `expandable` shows the "(ctrl+o to expand)" hint that stands in for output we
 * deliberately do not show.
 */
export const ClaudeToolCall: React.FC<{
  theme: SessionTheme;
  tool: string;
  server?: string | null;
  arg?: string;
  result: React.ReactNode;
  status?: ToolStatus;
  expandable?: boolean;
}> = ({theme, tool, server, arg, result, status = 'success', expandable = false}) => {
  const fs = theme.fontSize;
  return (
    <div style={{fontFamily: theme.mono, fontSize: fs, lineHeight: 1.55}}>
      <div style={{display: 'flex', alignItems: 'baseline', gap: '1ch'}}>
        <span style={{color: statusColor(status, theme), flexShrink: 0}}>⏺</span>
        <span style={{minWidth: 0, overflowWrap: 'anywhere'}}>
          {server ? (
            <>
              <span style={{color: theme.serverTint}}>{server}</span>
              <span style={{color: cc.dim}}> - </span>
            </>
          ) : null}
          <span style={{color: cc.fg}}>{tool}</span>
          {arg === undefined ? null : (
            <>
              <span style={{color: cc.dim}}>(</span>
              <span style={{color: cc.cyan}}>{arg}</span>
              <span style={{color: cc.dim}}>)</span>
            </>
          )}
        </span>
      </div>
      <div style={{display: 'flex', alignItems: 'baseline', gap: '1ch', color: cc.result}}>
        {/* invisible glyph spacer aligns the result glyph under the tool name */}
        <span style={{visibility: 'hidden', flexShrink: 0}}>⏺</span>
        <span style={{color: cc.dim, flexShrink: 0}}>⎿</span>
        <span style={{minWidth: 0, overflowWrap: 'anywhere'}}>
          {result}
          {expandable ? (
            <span style={{color: cc.dim, marginLeft: '1ch'}}>(ctrl+o to expand)</span>
          ) : null}
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Thinking line
// ---------------------------------------------------------------------------

// Captured cycle from Claude Code's thinking frames.
const CLAUDE_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

/**
 * The "working" line: pulsing glyph, a verb carrying a drifting highlight, and the
 * elapsed / interrupt hint. All derived from `frame`, so the shimmer is a computed
 * backgroundPosition rather than a CSS keyframe animation, which would not be
 * deterministic across a distributed render.
 */
export const ClaudeThinking: React.FC<{
  theme: SessionTheme;
  frame: number;
  fps: number;
  /** Frame the spinner started, so the elapsed counter reads from zero. */
  startFrame: number;
  verb: string;
  tokensPerSecond?: number;
  /** Context already sent before this turn, so the counter never reads zero. */
  baseTokens?: number;
}> = ({theme, frame, fps, startFrame, verb, tokensPerSecond = 137, baseTokens = 2400}) => {
  const local = Math.max(0, frame - startFrame);
  const secs = Math.floor(local / fps);
  const glyph = CLAUDE_GLYPHS[Math.floor(local / 3.5) % CLAUDE_GLYPHS.length];
  // 2.8s per shimmer pass, right to left.
  const cycle = (local % (fps * 2.8)) / (fps * 2.8);
  return (
    <div
      style={{
        fontFamily: theme.mono,
        fontSize: theme.fontSize,
        lineHeight: 1.6,
        display: 'flex',
        alignItems: 'baseline',
        gap: '1ch',
      }}
    >
      <span style={{color: cc.rose, width: '1ch', display: 'inline-block'}}>{glyph}</span>
      <span
        style={{
          backgroundImage: `linear-gradient(100deg, ${cc.rose} 43%, ${cc.hilite} 50%, ${cc.rose} 57%)`,
          backgroundSize: '200% 100%',
          backgroundPosition: `${100 - cycle * 200}% 0`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {verb}…
      </span>
      <span style={{color: cc.meta}}>
        ({secs}s · ↑ {baseTokens + secs * tokensPerSecond} tokens · esc to interrupt)
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Prompt composer
// ---------------------------------------------------------------------------

/**
 * The input composer: effort chip, the ruled input row, and the mode line.
 *
 * `focused` models the click: unfocused shows the dim placeholder and no cursor;
 * focused clears the placeholder and blinks the block caret.
 */
export const ClaudePrompt: React.FC<{
  theme: SessionTheme;
  text: string;
  focused?: boolean;
  /** Hold the caret lit while keys are landing. */
  caretSolid?: boolean;
  frame: number;
  fps: number;
  effort?: string;
  placeholder?: string;
}> = ({
  theme,
  text,
  focused = true,
  caretSolid = false,
  frame,
  fps,
  effort = '● high · /effort',
  placeholder = 'Type a message, or / for commands',
}) => {
  const fs = theme.fontSize;
  return (
    <div style={{fontFamily: theme.mono, fontSize: fs, lineHeight: 1.6}}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: `0 ${fs * 0.2}px ${fs * 0.2}px`,
          fontSize: fs * 0.92,
          color: cc.gray,
        }}
      >
        {effort}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          borderTop: `1px solid ${cc.rule}`,
          borderBottom: `1px solid ${cc.rule}`,
          padding: `${fs * 0.25}px 0`,
        }}
      >
        <span style={{color: cc.fg, flexShrink: 0}}>❯</span>
        <span style={{display: 'inline-block', width: '1ch', flexShrink: 0}} />
        <span style={{color: focused ? cc.fg : cc.dim, minWidth: 0, flex: 1}}>
          {focused ? text : placeholder}
          {focused ? <Caret frame={frame} fps={fps} solid={caretSolid} /> : null}
        </span>
      </div>
      <div style={{marginTop: fs * 0.35, padding: `0 ${fs * 0.2}px`, fontSize: fs * 0.92}}>
        <span style={{color: cc.mode}}>⏵⏵ auto mode on</span>
        <span style={{color: cc.gray}}> (shift+tab to cycle) · ← for agents</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Window chrome
// ---------------------------------------------------------------------------

const Dot: React.FC<{color: string}> = ({color}) => (
  <span
    style={{width: 13, height: 13, borderRadius: 999, background: color, display: 'inline-block'}}
  />
);

/** macOS-style dark terminal window, sized to hold a Claude Code session. */
export const ClaudeWindow: React.FC<{
  theme: SessionTheme;
  width: number;
  height: number;
  title?: string;
  children: React.ReactNode;
}> = ({theme, width, height, title = 'claude code', children}) => {
  const fs = theme.fontSize;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 16,
        overflow: 'hidden',
        background: cc.bg,
        border: `1px solid ${cc.border}`,
        boxShadow: '0 50px 100px -24px rgba(0, 0, 0, 0.65)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 48,
          flexShrink: 0,
          background: cc.chrome,
          borderBottom: `1px solid ${cc.border}`,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 20,
          gap: 10,
        }}
      >
        {dots.map((color) => (
          <Dot key={color} color={color} />
        ))}
        <span style={{marginLeft: 16, color: cc.gray, fontFamily: theme.mono, fontSize: 18}}>
          {title}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: `${fs * 1.1}px ${fs * 1.3}px`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>
  );
};
