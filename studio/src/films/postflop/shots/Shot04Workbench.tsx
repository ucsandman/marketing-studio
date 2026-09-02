import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {entrance} from '../../../lib/motion';
import {CameraRig} from '../../../components/CameraRig';
import {CURSOR_TIP, CursorGlyph, Figure, PANEL_BODY, Panel, RangeGrid, Rule, Stamp, bowedPosition, cellRect} from '../ui';
import type {CursorWaypoint} from '../ui';

// Shot 4 "workbench". The rebuilt solver workbench from
// studio/public/postflop/feature-tree.png + feature-lock.png: dark sidebar of
// counting figures beside the yellow-headed OOP STRATEGY panel, the 13x13 grid
// resolving as a diagonal waterfall, then a cursor click on cell 88 that opens
// the product's own combo popover. Every number is from the spec / the real
// screenshots. Density comes from a dozen small independent motions, not one
// big move: the rule draws, the panel and sidebar arrive on a stagger, each
// stat row slides, three figures count at different rates, the grid resolves
// diagonal by diagonal, the exploitability figure lands as a yellow block, the
// cursor bows across and presses, a cream ring flashes, the popover pops and
// its action bar grows. Everything is settled by frame 146; the tail is static.

// ---- layout (all px in the 1920x1080 stage) --------------------------------
const SIDEBAR_W = 420;
const GAP = 28;
const GRID = 780;
const PANEL_PAD = 12;
const HEADER_H = 40;
const PANEL_W = GRID + PANEL_PAD * 2;
const PANEL_H = HEADER_H + GRID + PANEL_PAD * 2;
const BLOCK_W = SIDEBAR_W + GAP + PANEL_W;
const BLOCK_LEFT = (1920 - BLOCK_W) / 2;
const BLOCK_TOP = 138;
const RULE_Y = BLOCK_TOP - 20;

// "cell 88" — row 6, col 6 on the A..2 grid is the 88 pair. cellRect is the
// grid's own maths, so the popover, the press ring and the camera origin land
// on exactly the cell RangeGrid draws.
const CLICK_CELL = {row: 6, col: 6};
const CLICK_RECT = cellRect(GRID, CLICK_CELL.row, CLICK_CELL.col);
const CELL = CLICK_RECT.size;
const GRID_LEFT = BLOCK_LEFT + SIDEBAR_W + GAP + PANEL_PAD;
const GRID_TOP = BLOCK_TOP + HEADER_H + PANEL_PAD;
const CELL_X = GRID_LEFT + CLICK_RECT.left + CELL / 2;
const CELL_Y = GRID_TOP + CLICK_RECT.top + CELL / 2;

const RING_LEFT = PANEL_PAD + CLICK_RECT.left;
const RING_TOP = PANEL_PAD + CLICK_RECT.top;
const CARD_LEFT = RING_LEFT + CELL + 14;
const CARD_TOP = RING_TOP - 8;
const CARD_W = 320;
const CURSOR_SCALE = 1.2;

// ---- beats (shot-local frames) ---------------------------------------------
const F_RULE = 2;
const F_PANEL = 6;
const F_SIDEBAR = 10;
const F_GRID = 16;
const F_GRID_END = 46;
const F_NODES = 22;
const F_ITERS = 28;
const F_ENGINE = 34;
const F_EXPL = 56;
const F_STAMP = 90;
const F_CLICK = 112;
const F_CARD = 116;
const F_BAR = 132;

const SIDEBAR_LINE = '#262622';
const SIDEBAR_DIM = '#6b6760';

// Rest is OFF the frame: during the 8-frame handover the outgoing composer shot
// still has its own cursor on screen, and a second one parked in the corner
// reads as a bug. It walks in from the bottom-right instead.
const CURSOR_PATH: CursorWaypoint[] = [
  {x: 2010, y: 1140, at: 0},
  {x: 1560, y: 880, at: 92},
  {x: 1330, y: 700, at: 102},
  {x: CELL_X, y: CELL_Y, at: F_CLICK},
];

const StatRow: React.FC<{
  brand: Brand;
  mono: string;
  label: string;
  delayFrames: number;
  children: React.ReactNode;
}> = ({brand, mono, label, delayFrames, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = entrance(frame, fps, brand.motion, {
    delayFrames,
    durFrames: 10,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        fontFamily: mono,
        fontSize: 23,
        opacity: p,
        transform: `translateX(${(-14 * (1 - p)).toFixed(2)}px)`,
      }}
    >
      <span style={{color: SIDEBAR_DIM, fontWeight: 500, letterSpacing: 1.8}}>{label}</span>
      <span style={{color: brand.colors.surface, fontWeight: 500, fontVariantNumeric: 'tabular-nums'}}>
        {children}
      </span>
    </div>
  );
};

export const Shot04Workbench: React.FC<{brand: Brand; len: number}> = ({brand, len}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  void len;

  const arrive = (delayFrames: number): number =>
    entrance(frame, fps, brand.motion, {delayFrames, durFrames: 16, easing: Easing.out(Easing.cubic)});
  const panelP = arrive(F_PANEL);
  const sidebarP = arrive(F_SIDEBAR);

  // Diagonal waterfall: RangeGrid resolves a cell once progress passes its
  // diagonal, and the last diagonal needs progress past 1 + 1/9 to finish.
  const gridProgress = interpolate(frame, [F_GRID, F_GRID_END], [0, 1.12], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const clicked = frame >= F_CLICK;
  const ringP = interpolate(frame, [F_CLICK, F_CLICK + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const press = interpolate(frame, [F_CLICK, F_CLICK + 7], [0.9, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const cardP = entrance(frame, fps, brand.motion, {
    delayFrames: F_CARD,
    durFrames: 9,
    easing: Easing.out(Easing.cubic),
  });
  const barP = entrance(frame, fps, brand.motion, {
    delayFrames: F_BAR,
    durFrames: 14,
    easing: Easing.out(Easing.cubic),
  });
  const cursor = bowedPosition(frame, CURSOR_PATH);

  return (
    <AbsoluteFill style={{backgroundColor: brand.colors.bg, fontFamily: fonts.mono}}>
      <CameraRig
        dollyOrigin={`${((CELL_X / 1920) * 100).toFixed(2)}% ${((CELL_Y / 1080) * 100).toFixed(2)}%`}
        dolly={[{at: 30, dur: 60, to: 1.08}]}
      >
        <div style={{position: 'absolute', left: BLOCK_LEFT, top: RULE_Y, width: BLOCK_W}}>
          <Rule brand={brand} delayFrames={F_RULE} durFrames={16} thickness={3} />
        </div>

        {/* sidebar: SOLVE / ABOUT / LOADED with the counting figures. It SLIDES
            up inside a clipping box rather than fading: a half-opacity dark slab
            over bone paper is a wash, and the panel's yellow header may never be
            anything but solid. */}
        <div
          style={{
            position: 'absolute',
            left: BLOCK_LEFT,
            top: BLOCK_TOP,
            width: SIDEBAR_W,
            height: PANEL_H,
            overflow: 'hidden',
          }}
        >
        <div
          style={{
            width: SIDEBAR_W,
            height: PANEL_H,
            backgroundColor: PANEL_BODY,
            display: 'flex',
            flexDirection: 'column',
            transform: `translateY(${(PANEL_H * (1 - sidebarP)).toFixed(2)}px)`,
          }}
        >
          {['SOLVE', 'ABOUT'].map((item) => (
            <div
              key={item}
              style={{
                height: 54,
                display: 'flex',
                alignItems: 'center',
                padding: '0 22px',
                borderBottom: `1px solid ${SIDEBAR_LINE}`,
                color: brand.colors.surface,
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: 2.6,
              }}
            >
              {item}
            </div>
          ))}
          <div style={{padding: '22px 22px 0', display: 'flex', flexDirection: 'column', gap: 15}}>
            <div style={{color: SIDEBAR_DIM, fontSize: 21, fontWeight: 700, letterSpacing: 2.6}}>
              LOADED
            </div>
            <div style={{color: brand.colors.surface, fontSize: 22, fontWeight: 500}}>
              browser solve (1.67s)
            </div>
            <div style={{height: 8}} />
            <StatRow
              brand={brand}
              mono={fonts.mono}
              label="NODES"
              delayFrames={F_NODES}
            >
              <Figure
                mono={fonts.mono}
                from={0}
                to={1161}
                delayFrames={F_NODES}
                durFrames={22}
                format={(v) => Math.round(v).toLocaleString('en-US')}
              />
            </StatRow>
            <StatRow brand={brand} mono={fonts.mono} label="ENGINE" delayFrames={F_ENGINE}>
              0.1.0
            </StatRow>
            <StatRow brand={brand} mono={fonts.mono} label="ITERS" delayFrames={F_ITERS}>
              <Figure mono={fonts.mono} from={0} to={150} delayFrames={F_ITERS} durFrames={22} />
            </StatRow>
            <div style={{height: 14}} />
            <div style={{color: SIDEBAR_DIM, fontSize: 21, fontWeight: 700, letterSpacing: 2.6}}>
              EXPLOITABILITY
            </div>
            <div style={{position: 'relative', height: 62, display: 'flex', flexDirection: 'column'}}>
              {frame < F_STAMP ? (
                <Figure
                  mono={fonts.mono}
                  from={0.3124}
                  to={0.0471}
                  delayFrames={F_EXPL}
                  durFrames={30}
                  format={(v) => `${v.toFixed(4)}%`}
                  style={{
                    color: brand.colors.surface,
                    fontSize: 46,
                    fontWeight: 700,
                    // matches the Stamp's padding exactly: the numeral is the
                    // same glyph before and after the block lands on it, so it
                    // must not jump sideways on the swap frame.
                    padding: '6px 16px',
                    opacity: entrance(frame, fps, brand.motion, {
                      delayFrames: F_EXPL,
                      durFrames: 8,
                      easing: Easing.out(Easing.cubic),
                    }),
                  }}
                />
              ) : (
                <Stamp
                  brand={brand}
                  mono={fonts.mono}
                  text="0.0471%"
                  delayFrames={F_STAMP}
                  fontSize={46}
                  padding="6px 16px"
                  // This block LANDS on a numeral that is already on screen —
                  // the Figure above unmounts on this exact frame — so it must
                  // be at full width the moment it mounts. Cancel the kit's
                  // mask wipe (which would leave the slot empty for its first
                  // frames); the entry scale + settle drop still animate.
                  style={{clipPath: 'none'}}
                />
              )}
            </div>
          </div>
        </div>
        </div>

        {/* the workbench panel */}
        <div
          style={{
            position: 'absolute',
            left: BLOCK_LEFT + SIDEBAR_W + GAP,
            top: BLOCK_TOP,
            width: PANEL_W,
            height: PANEL_H,
            overflow: 'hidden',
          }}
        >
        <div style={{transform: `translateY(${(PANEL_H * (1 - panelP)).toFixed(2)}px)`}}>
          <Panel
            brand={brand}
            mono={fonts.mono}
            title="OOP STRATEGY"
            meta="363 combos · node 0 · turn"
            chip="LOCK NODE"
            width={PANEL_W}
            height={PANEL_H}
            headerHeight={HEADER_H}
            bodyStyle={{position: 'relative'}}
          >
            <RangeGrid
              brand={brand}
              mono={fonts.mono}
              size={GRID}
              progress={gridProgress}
              selected={clicked ? CLICK_CELL : null}
              focusCell={clicked ? CLICK_CELL : null}
            />

            {/* press feedback: a cream ring off the panel's own foreground,
                never a yellow bloom */}
            {clicked && ringP < 1 ? (
              <div
                style={{
                  position: 'absolute',
                  left: RING_LEFT,
                  top: RING_TOP,
                  width: CELL,
                  height: CELL,
                  border: `3px solid ${brand.colors.surface}`,
                  opacity: 1 - ringP,
                  transform: `scale(${(1 + 0.45 * ringP).toFixed(3)})`,
                }}
              />
            ) : null}

            {/* the product's own combo popover */}
            {frame >= F_CARD ? (
              <div
                style={{
                  position: 'absolute',
                  left: CARD_LEFT,
                  top: CARD_TOP,
                  width: CARD_W,
                  overflow: 'hidden',
                }}
              >
              <div
                style={{
                  width: CARD_W,
                  backgroundColor: brand.colors.surface,
                  border: `3px solid ${brand.colors.ink}`,
                  padding: '14px 16px',
                  color: brand.colors.ink,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxSizing: 'border-box',
                  // it UNFURLS out of the cell inside a clip box instead of
                  // fading: a half-opacity cream card over the dark grid lets
                  // the cells read through it and looks like a render fault.
                  transform: `translateX(${(-CARD_W * (1 - cardP)).toFixed(2)}px)`,
                }}
              >
                <div style={{fontSize: 30, fontWeight: 700, letterSpacing: 1.4}}>8h8d</div>
                <div style={{fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums'}}>
                  EV +0.31 bb
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 19,
                    fontWeight: 500,
                    color: brand.colors.ink2,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span>bet 66%</span>
                  <span>check 34%</span>
                </div>
                <div style={{height: 12, backgroundColor: brand.colors.surface2, display: 'flex'}}>
                  <div
                    style={{
                      width: `${(66 * barP).toFixed(2)}%`,
                      height: '100%',
                      backgroundColor: brand.colors.ink,
                    }}
                  />
                </div>
              </div>
              </div>
            ) : null}
          </Panel>
        </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: cursor.x - CURSOR_TIP.x * CURSOR_SCALE,
            top: cursor.y - CURSOR_TIP.y * CURSOR_SCALE,
            transform: `scale(${press.toFixed(3)})`,
            transformOrigin: `${(CURSOR_TIP.x * CURSOR_SCALE).toFixed(2)}px ${(CURSOR_TIP.y * CURSOR_SCALE).toFixed(2)}px`,
          }}
        >
          {/* the shared glyph ships a drop-shadow; this brand has zero shadows */}
          <CursorGlyph scale={CURSOR_SCALE} />
        </div>
      </CameraRig>
    </AbsoluteFill>
  );
};
