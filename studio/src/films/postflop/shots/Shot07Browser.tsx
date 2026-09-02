import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entrance, staggerDelay} from '../../../lib/motion';
import {Figure, PANEL_BODY, Panel, RangeGrid, Rule, Stamp} from '../ui';

// Shot 7 "browser" — the hardware-hero equivalent. The reference parks a monitor
// on a plinth; postflop has no hardware, so the hero object is the product
// running WHERE the claim says it runs: a browser window on bone paper, turning
// out of a shallow rotateY while a slow dolly pushes in. Inside it is the real
// workbench rebuilt small (black sidebar + yellow-headed OOP STRATEGY panel +
// the resolved 13x13 grid), transcribed from studio/public/postflop/feature-lock.png.
//
// The window arrives already resolved (this is the same solve, seen somewhere
// else), so the small motions are the ones a loaded page still makes: the page
// rule drawing under the url, the sidebar stats landing, two counters running,
// the exploitability block stamping, the frequency bars growing, and the caption
// arriving word by word. Nothing fades itself in or out — Film.tsx owns the cut.

const WINDOW_W = 1240;
const WINDOW_H = 736;
const BORDER = 3;
const CHROME_H = 52;
const SIDEBAR_W = 288;
const INNER_W = WINDOW_W - BORDER * 2;
const INNER_H = WINDOW_H - BORDER * 2;
const CONTENT_H = INNER_H - CHROME_H - BORDER;
const PANEL_W = INNER_W - SIDEBAR_W;
const GRID = CONTENT_H - 34 - 24; // panel header + body padding
const READOUT_W = PANEL_W - 24 - GRID - 18;

// Product chrome greys, transcribed from the screenshot: the sidebar's dim label
// ink and the hairline it rules its sections with.
const SIDE_DIM = '#6f6a60';
const SIDE_LINE = '#33312c';
const BAR_TRACK = '#262622';

const CELL_88 = {row: 6, col: 6} as const;

const CAPTION = [
  'Rust engine, compiled to WebAssembly, in a Web Worker.',
  'Nothing to install.',
];

const STATS: {label: string; render: (mono: string) => React.ReactNode}[] = [
  {
    label: 'NODES',
    render: (mono) => (
      <Figure
        mono={mono}
        from={0}
        to={1161}
        delayFrames={8}
        durFrames={26}
        format={(v) => Math.round(v).toLocaleString('en-US')}
      />
    ),
  },
  {label: 'ENGINE', render: () => '0.1.0'},
  {
    label: 'ITERS',
    render: (mono) => <Figure mono={mono} from={0} to={150} delayFrames={14} durFrames={26} />,
  },
];

const FREQS: {label: string; pct: number; fill: (brand: Brand) => string}[] = [
  // Ink readout, not grid colours: green/red/cream belong to the grid cells only,
  // and the workbench shot draws this same popover bar the same way.
  {label: 'BET', pct: 66, fill: (brand) => brand.colors.surface},
  {label: 'CHECK', pct: 34, fill: () => SIDE_DIM},
];

export const Shot07Browser: React.FC<{brand: Brand; len: number}> = ({brand, len}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);

  // Continuous camera: one eased push that finishes before the cut so the last
  // frames of the shot are static under the incoming handover.
  const cam = entrance(frame, fps, brand.motion, {
    delayFrames: 2,
    durFrames: len - 14,
    easing: Easing.out(Easing.cubic),
  });
  const rotY = -8 + 6.5 * cam;
  const dolly = 0.96 + 0.04 * cam;

  const words = CAPTION.map((line) => line.split(' '));
  let wordIndex = -1;

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg, color: brand.colors.ink}}>
      <AbsoluteFill style={{perspective: 2400}}>
        <div
          style={{
            position: 'absolute',
            left: (1920 - WINDOW_W) / 2,
            top: 78,
            width: WINDOW_W,
            height: WINDOW_H,
            boxSizing: 'border-box',
            border: `${BORDER}px solid ${brand.colors.ink}`,
            backgroundColor: brand.colors.surface,
            display: 'flex',
            flexDirection: 'column',
            transform: `rotateY(${rotY.toFixed(3)}deg) scale(${dolly.toFixed(4)})`,
            transformOrigin: '50% 50%',
          }}
        >
          {/* chrome bar: window squares (zero radius), url field, and the page
              rule that draws in and stays as the chrome/content divider. */}
          <div style={{height: CHROME_H, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px'}}>
            {[0, 1, 2].map((i) => (
              <div key={`dot-${i}`} style={{width: 12, height: 12, backgroundColor: brand.colors.ink}} />
            ))}
            <div
              style={{
                marginLeft: 8,
                flex: 1,
                height: 30,
                border: `2px solid ${brand.colors.ink}`,
                backgroundColor: brand.colors.surface2,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                fontFamily: fonts.mono,
                fontSize: 17,
                fontWeight: 500,
                letterSpacing: 0.6,
              }}
            >
              {brand.url}
            </div>
          </div>
          <Rule brand={brand} delayFrames={4} durFrames={20} thickness={BORDER} />

          <div style={{height: CONTENT_H, display: 'flex', backgroundColor: PANEL_BODY}}>
            <div
              style={{
                width: SIDEBAR_W,
                height: CONTENT_H,
                boxSizing: 'border-box',
                padding: 16,
                fontFamily: fonts.mono,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {['SOLVE', 'ABOUT'].map((item) => (
                <div
                  key={item}
                  style={{
                    padding: '10px 0',
                    borderBottom: `1px solid ${SIDE_LINE}`,
                    color: SIDE_DIM,
                    fontSize: 15,
                    fontWeight: 500,
                    letterSpacing: 2,
                  }}
                >
                  {item}
                </div>
              ))}
              <div style={{height: 22}} />
              <div style={{color: SIDE_DIM, fontSize: 13, fontWeight: 500, letterSpacing: 2}}>LOADED</div>
              <div style={{marginTop: 8, color: brand.colors.surface, fontSize: 16, fontWeight: 500}}>
                browser solve (1.67 s)
              </div>
              <div style={{height: 26}} />
              {STATS.map((stat, i) => {
                const p = brandSpring(frame, fps, brand.motion, {
                  delayFrames: 6 + staggerDelay(i, 3, brand.motion),
                });
                return (
                  <div
                    key={stat.label}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      padding: '7px 0',
                      opacity: p,
                      transform: `translateY(${((1 - p) * 8).toFixed(2)}px)`,
                    }}
                  >
                    <span style={{color: SIDE_DIM, fontSize: 14, fontWeight: 500, letterSpacing: 1.6}}>
                      {stat.label}
                    </span>
                    <span
                      style={{
                        color: brand.colors.surface,
                        fontSize: 19,
                        fontWeight: 500,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {stat.render(fonts.mono)}
                    </span>
                  </div>
                );
              })}
              <div style={{height: 26}} />
              {/* the label arrives with its block; on its own it reads as a hole. */}
              <div
                style={{
                  color: SIDE_DIM,
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: 2,
                  opacity: brandSpring(frame, fps, brand.motion, {delayFrames: 38}),
                }}
              >
                EXPLOITABILITY
              </div>
              <Stamp
                brand={brand}
                mono={fonts.mono}
                text="0.0471%"
                delayFrames={44}
                fontSize={34}
                padding="8px 14px"
                style={{marginTop: 10}}
              />
            </div>

            <Panel
              brand={brand}
              mono={fonts.mono}
              title="OOP STRATEGY"
              meta="363 combos · node 0 · turn"
              chip="LOCK NODE"
              width={PANEL_W}
              height={CONTENT_H}
              bodyStyle={{display: 'flex', gap: 18, padding: 12}}
            >
              <RangeGrid
                brand={brand}
                mono={fonts.mono}
                size={GRID}
                progress={1}
                selected={CELL_88}
                focusCell={CELL_88}
              />
              <div style={{width: READOUT_W, display: 'flex', flexDirection: 'column'}}>
                <div style={{color: SIDE_DIM, fontSize: 13, fontWeight: 500, letterSpacing: 2}}>SELECTED</div>
                <div style={{marginTop: 8, color: brand.colors.surface, fontSize: 34, fontWeight: 500}}>8h8d</div>
                <Rule
                  brand={brand}
                  delayFrames={10}
                  durFrames={14}
                  thickness={2}
                  color={SIDE_LINE}
                  style={{marginTop: 14}}
                />
                <div style={{marginTop: 14, color: brand.colors.surface, fontSize: 20, fontWeight: 500}}>
                  EV +0.31 bb
                </div>
                <div style={{height: 26}} />
                {FREQS.map((freq, i) => {
                  // one ramp drives the row's arrival AND the bar's growth, so a
                  // percentage never sits over an empty track.
                  const p = entrance(frame, fps, brand.motion, {
                    delayFrames: 22 + staggerDelay(i, 5, brand.motion),
                    durFrames: 20,
                    easing: Easing.out(Easing.cubic),
                  });
                  return (
                    <div key={freq.label} style={{marginBottom: 16, opacity: Math.min(1, p * 3)}}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          color: SIDE_DIM,
                          fontSize: 14,
                          fontWeight: 500,
                          letterSpacing: 1.6,
                        }}
                      >
                        <span>{freq.label}</span>
                        <span style={{color: brand.colors.surface, fontVariantNumeric: 'tabular-nums'}}>
                          {freq.pct}%
                        </span>
                      </div>
                      <div style={{marginTop: 6, height: 12, backgroundColor: BAR_TRACK}}>
                        <div
                          style={{
                            width: `${(freq.pct * p).toFixed(2)}%`,
                            height: '100%',
                            backgroundColor: freq.fill(brand),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div style={{marginTop: 'auto', color: SIDE_DIM, fontSize: 14, fontWeight: 500, letterSpacing: 1.4}}>
                  node 0 · turn
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </AbsoluteFill>

      <div
        style={{
          position: 'absolute',
          left: (1920 - WINDOW_W) / 2,
          top: 852,
          width: WINDOW_W,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Rule brand={brand} delayFrames={36} durFrames={20} thickness={3} width={WINDOW_W} />
        <div
          style={{
            marginTop: 26,
            fontFamily: fonts.display,
            fontWeight: 600,
            fontSize: 42,
            lineHeight: 1.32,
            letterSpacing: -0.4,
            textAlign: 'center',
          }}
        >
          {words.map((line, li) => (
            <div key={`line-${li}`}>
              {line.map((word) => {
                wordIndex += 1;
                const p = brandSpring(frame, fps, brand.motion, {
                  delayFrames: 42 + staggerDelay(wordIndex, 1.5, brand.motion),
                });
                return (
                  <span
                    key={`w-${wordIndex}`}
                    style={{
                      display: 'inline-block',
                      marginRight: 12,
                      opacity: p,
                      transform: `translateY(${((1 - p) * 14).toFixed(2)}px)`,
                    }}
                  >
                    {word}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
