import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {brandSpring, entrance, entryScale, staggerDelay} from '../../../lib/motion';
import {Figure, Rule, Stamp} from '../ui';

// Shot 6 "features" (96 frames). Four rebuilt product cards on a shared 2400px
// perspective grid, each arriving on the brand spring with an 8-frame stagger
// and then doing ONE native motion of its own: a toggle flipping, a 24-segment
// thread bar filling with its counter, an evals/sec figure with a meter ticking
// up under it, and a file chip travelling from a CLI glyph to a browser glyph.
// Density comes from the count of small independent motions, not from one big
// move. Everything settles by frame 80; frames 80..95 are static.

const CARD_W = 656;
const CARD_H = 372;
const GRID_GAP = 48;
const CARD_PAD = 30;
const CONTENT_W = CARD_W - CARD_PAD * 2 - 6; // 590, inside the 3px ink border

/** Local frame the i-th card starts arriving on. */
const cardDelay = (i: number, brand: Brand): number => 2 + staggerDelay(i, 8, brand.motion);

const Card: React.FC<{
  brand: Brand;
  mono: string;
  index: number;
  label: string;
  children: React.ReactNode;
}> = ({brand, mono, index, label, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const delayFrames = cardDelay(index, brand);
  const p = brandSpring(frame, fps, brand.motion, {delayFrames});
  const rotY = interpolate(p, [0, 1], [-7, -1.3]);
  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        boxSizing: 'border-box',
        backgroundColor: brand.colors.surface,
        border: `3px solid ${brand.colors.ink}`,
        padding: CARD_PAD,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: mono,
        color: brand.colors.ink,
        opacity: Math.min(1, Math.max(0, p)),
        transform: `rotateY(${rotY.toFixed(3)}deg) scale(${entryScale(p, brand.motion).toFixed(4)})`,
      }}
    >
      <div style={{fontSize: 21, fontWeight: 700, letterSpacing: 2.4, color: brand.colors.ink2}}>
        {label}
      </div>
      <Rule
        brand={brand}
        delayFrames={delayFrames + 6}
        durFrames={14}
        thickness={2}
        width={CONTENT_W}
        style={{marginTop: 10}}
      />
      {children}
    </div>
  );
};

/** (a) LOCK NODE — the toggle flips on, then the LOCK UPDATED block stamps in. */
const LockCard: React.FC<{brand: Brand; mono: string}> = ({brand, mono}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const flip = entrance(frame, fps, brand.motion, {
    delayFrames: 34,
    durFrames: 9,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <Card brand={brand} mono={mono} index={0} label="LOCK NODE">
      <div style={{display: 'flex', alignItems: 'center', gap: 26, marginTop: 28}}>
        <div
          style={{
            position: 'relative',
            width: 130,
            height: 60,
            boxSizing: 'border-box',
            border: `3px solid ${brand.colors.ink}`,
            backgroundColor: brand.colors.surface2,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${(flip * 100).toFixed(2)}%`,
              backgroundColor: brand.colors.ink,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 4,
              left: 4 + flip * 70,
              width: 46,
              height: 46,
              backgroundColor: brand.colors.bg,
            }}
          />
        </div>
        <div style={{fontSize: 24, fontWeight: 500, color: brand.colors.ink2, letterSpacing: 1}}>
          node 0 · turn
        </div>
      </div>
      <div style={{marginTop: 20, width: CONTENT_W, fontSize: 25, fontWeight: 500}}>
        <div style={{display: 'flex', alignItems: 'baseline', borderBottom: `2px solid ${brand.colors.surface2}`, padding: '6px 0'}}>
          <span style={{color: brand.colors.ink2, letterSpacing: 2}}>COMBOS</span>
          <Figure mono={mono} from={0} to={363} delayFrames={30} durFrames={12} style={{marginLeft: 'auto'}} />
        </div>
        <div style={{display: 'flex', alignItems: 'baseline', borderBottom: `2px solid ${brand.colors.surface2}`, padding: '6px 0'}}>
          <span style={{color: brand.colors.ink2, letterSpacing: 2}}>ITERS</span>
          <Figure mono={mono} from={0} to={150} delayFrames={38} durFrames={12} style={{marginLeft: 'auto'}} />
        </div>
      </div>
      <div style={{marginTop: 'auto', display: 'flex'}}>
        <Stamp brand={brand} mono={mono} text="LOCK UPDATED" delayFrames={48} fontSize={30} padding="8px 18px" />
      </div>
    </Card>
  );
};

const THREAD_SEGMENTS = 24;

/** (b) THREADS 1 -> 24 with a 24-segment bar filling in step with the counter. */
const ThreadsCard: React.FC<{brand: Brand; mono: string}> = ({brand, mono}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pop = brandSpring(frame, fps, brand.motion, {delayFrames: 50});
  return (
    <Card brand={brand} mono={mono} index={1} label="THREADS">
      <div style={{display: 'flex', alignItems: 'baseline', marginTop: 26}}>
        <Figure
          mono={mono}
          from={1}
          to={24}
          delayFrames={26}
          durFrames={20}
          style={{fontSize: 96, lineHeight: 1, letterSpacing: -2}}
        />
        <span style={{fontSize: 26, fontWeight: 500, color: brand.colors.ink2, marginLeft: 16, letterSpacing: 1}}>
          worker threads
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 50,
            fontWeight: 700,
            letterSpacing: -1,
            opacity: Math.min(1, Math.max(0, pop)),
            transform: `scale(${entryScale(pop, brand.motion).toFixed(4)})`,
            transformOrigin: 'right bottom',
          }}
        >
          6.8x
        </span>
      </div>
      <div
        style={{
          marginTop: 30,
          width: CONTENT_W,
          boxSizing: 'border-box',
          border: `3px solid ${brand.colors.ink}`,
          padding: 4,
          display: 'flex',
          gap: 3,
          height: 44,
        }}
      >
        {Array.from({length: THREAD_SEGMENTS}, (_, i) => {
          const at = 26 + (i * 20) / THREAD_SEGMENTS;
          const on = interpolate(frame, [at, at + 3], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.out(Easing.cubic),
          });
          return (
            <div
              key={i}
              style={{
                flex: 1,
                backgroundColor: brand.colors.ink,
                opacity: 0.1 + on * 0.9,
              }}
            />
          );
        })}
      </div>
    </Card>
  );
};

const METER_BARS = [22, 40, 31, 58, 44, 70, 52, 76, 61, 74, 55, 68, 72, 76];

/** (c) EVALS/SEC counting to 77,000,000 over a meter that ticks up under it. */
const EvalsCard: React.FC<{brand: Brand; mono: string}> = ({brand, mono}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <Card brand={brand} mono={mono} index={2} label="EVALS/SEC">
      <div style={{marginTop: 24}}>
        <Figure
          mono={mono}
          from={0}
          to={77000000}
          delayFrames={34}
          durFrames={30}
          format={(v) => Math.round(v).toLocaleString('en-US')}
          style={{fontSize: 76, lineHeight: 1.1, letterSpacing: -2}}
        />
      </div>
      <div style={{marginTop: 'auto', display: 'flex', alignItems: 'flex-end', gap: 12, height: 76}}>
        {METER_BARS.map((h, i) => {
          const at = 34 + staggerDelay(i, 2, brand.motion);
          const g = entrance(frame, fps, brand.motion, {
            delayFrames: at,
            durFrames: 6,
            easing: Easing.out(Easing.cubic),
          });
          return (
            <div
              key={i}
              style={{width: 26, height: h * g, backgroundColor: brand.colors.ink}}
            />
          );
        })}
      </div>
      <div style={{marginTop: 14, fontSize: 20, fontWeight: 500, color: brand.colors.ink2, letterSpacing: 1.4}}>
        rust · wasm · web worker
      </div>
    </Card>
  );
};

const GLYPH_W = 118;
const GLYPH_H = 86;
const RAIL_X = GLYPH_W + 18;
const RAIL_W = CONTENT_W - (GLYPH_W + 18) * 2;
const CHIP_W = 152;
/** Chip docks 8px short of the browser glyph rather than stopping mid-rail. */
const CHIP_END = CONTENT_W - GLYPH_W - CHIP_W - 8;

/** (d) spot.pfs travelling from the CLI glyph to the browser glyph. */
const FileCard: React.FC<{brand: Brand; mono: string}> = ({brand, mono}) => {
  const frame = useCurrentFrame();
  const chipX = interpolate(frame, [52, 74], [RAIL_X, CHIP_END], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const landed = interpolate(frame, [74, 78], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const glyphBox: React.CSSProperties = {
    position: 'absolute',
    top: 17,
    width: GLYPH_W,
    height: GLYPH_H,
    boxSizing: 'border-box',
    border: `3px solid ${brand.colors.ink}`,
    backgroundColor: brand.colors.surface,
  };
  return (
    <Card brand={brand} mono={mono} index={3} label="SPOT FILE">
      <div style={{position: 'relative', width: CONTENT_W, height: 120, marginTop: 'auto', marginBottom: 'auto'}}>
        <div style={{...glyphBox, left: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <span style={{fontSize: 36, fontWeight: 700, letterSpacing: 1}}>&gt;_</span>
        </div>
        <div style={{...glyphBox, left: CONTENT_W - GLYPH_W}}>
          <div
            style={{
              height: 24,
              backgroundColor: brand.colors.ink,
              opacity: 0.16 + landed * 0.84,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              paddingLeft: 9,
            }}
          >
            <div style={{width: 8, height: 8, backgroundColor: brand.colors.surface}} />
            <div style={{width: 8, height: 8, backgroundColor: brand.colors.surface}} />
            <div style={{width: 8, height: 8, backgroundColor: brand.colors.surface}} />
          </div>
          <div style={{height: 3, marginTop: 15, marginLeft: 11, width: 66, backgroundColor: brand.colors.ink2}} />
          <div style={{height: 3, marginTop: 10, marginLeft: 11, width: 44, backgroundColor: brand.colors.ink2}} />
        </div>
        <Rule
          brand={brand}
          delayFrames={38}
          durFrames={14}
          thickness={3}
          width={RAIL_W}
          style={{position: 'absolute', left: RAIL_X, top: 59}}
        />
        <div
          style={{
            position: 'absolute',
            top: 33,
            left: chipX,
            width: CHIP_W,
            boxSizing: 'border-box',
            border: `3px solid ${brand.colors.ink}`,
            backgroundColor: brand.colors.surface,
            padding: '9px 0',
            textAlign: 'center',
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: 1,
          }}
        >
          spot.pfs
        </div>
      </div>
      <div style={{fontSize: 24, fontWeight: 500, color: brand.colors.ink2, letterSpacing: 1.2}}>
        same file, anywhere
      </div>
    </Card>
  );
};

export const Shot06Features: React.FC<{brand: Brand; len: number}> = ({brand, len}) => {
  const {mono} = loadBrandFonts(brand);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  // Continuous camera: a gentle dolly that finishes 16 frames before the cut so
  // the shot's last frames are dead still.
  const dolly = entrance(frame, fps, brand.motion, {
    durFrames: len - 16,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{transform: `scale(${(1 + dolly * 0.035).toFixed(4)})`}}>
        <div
          style={{
            perspective: 2400,
            display: 'grid',
            gridTemplateColumns: `${CARD_W}px ${CARD_W}px`,
            gridTemplateRows: `${CARD_H}px ${CARD_H}px`,
            gap: GRID_GAP,
          }}
        >
          <LockCard brand={brand} mono={mono} />
          <ThreadsCard brand={brand} mono={mono} />
          <EvalsCard brand={brand} mono={mono} />
          <FileCard brand={brand} mono={mono} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
