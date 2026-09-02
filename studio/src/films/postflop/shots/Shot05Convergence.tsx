import React from 'react';
import {AbsoluteFill, Easing, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../../../lib/brand';
import {loadBrandFonts} from '../../../lib/fonts';
import {entrance, staggerDelay} from '../../../lib/motion';
import {Figure, Rule, Stamp} from '../ui';

// Shot 05 "convergence" — the convergence report card from feature-convergence.png
// rebuilt natively on paper. The card unrolls (clip, never a fade — Film.tsx owns
// the handover), then eight independent motions run over each other: the header
// rule draws, the big exploitability figure counts 0.3124% -> 0.0471%, the decay
// curve draws left to right through its three measured points, each point lands as
// it is passed, the [measured] stamp snaps in, the three report rows waterfall, and
// the ink caption wipes in under the card. A slow 1.00 -> 1.035 dolly runs under all
// of it and settles 16 frames before the cut, so the shot's last frames are dead static.

const CARD_W = 1240;
const CARD_PAD = 36;
const CHART_W = CARD_W - CARD_PAD * 2;
const CHART_H = 260;
const CHART_INSET_X = 18;
const CHART_INSET_TOP = 30;
const CHART_INSET_BOTTOM = 34;

// The three measured reports (out/postflop/marketing screenshots): exploitability
// as % of pot at iterations 50 / 100 / 150.
const SERIES = [
  {iter: '50', bb: '0.017180', pot: '0.3124'},
  {iter: '100', bb: '0.005218', pot: '0.0949'},
  {iter: '150', bb: '0.002589', pot: '0.0471'},
] as const;

const HI = 0.3124;
const LO = 0.0471;

// Log-linear between measured points: exploitability decays multiplicatively, so a
// straight interpolation in log space is the honest curve between two reports.
const at = (t: number): number => {
  const seg = t < 0.5 ? 0 : 1;
  const lt = seg === 0 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = Math.log(Number(SERIES[seg].pot));
  const b = Math.log(Number(SERIES[seg + 1].pot));
  return Math.exp(a + (b - a) * lt);
};

const SPAN_X = CHART_W - CHART_INSET_X * 2;
const SPAN_Y = CHART_H - CHART_INSET_TOP - CHART_INSET_BOTTOM;

const CURVE = Array.from({length: 61}, (_, i) => {
  const t = i / 60;
  const v = at(t);
  return {
    x: CHART_INSET_X + t * SPAN_X,
    y: CHART_INSET_TOP + ((HI - v) / (HI - LO)) * SPAN_Y,
  };
});

const CURVE_D = CURVE.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

const CURVE_LEN = CURVE.reduce(
  (sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - CURVE[i - 1].x, p.y - CURVE[i - 1].y)),
  0,
);

const DOTS = [
  {p: CURVE[0], t: 0},
  {p: CURVE[30], t: 0.5},
  {p: CURVE[60], t: 1},
];

const COL_BB = 0.56;
const COL_POT = 0.82;

export const Shot05Convergence: React.FC<{brand: Brand; len: number}> = ({brand, len}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fonts = loadBrandFonts(brand);
  const m = brand.motion;
  const ease = Easing.out(Easing.cubic);

  const ramp = (delayFrames: number, durFrames: number): number =>
    entrance(frame, fps, m, {delayFrames, durFrames, easing: ease});

  // The card prints itself top-down: a clip, not an opacity fade.
  const unroll = ramp(2, 16);
  // Continuous dolly under the whole card; settles 16 frames before the cut so
  // the shot's last frames are dead static.
  const dolly = 1 + 0.035 * ramp(0, len - 16);

  const labelWipe = ramp(12, 12);
  const subWipe = ramp(60, 12);
  const chartWipe = ramp(20, 10);
  const headWipe = ramp(18, 10);
  const captionWipe = ramp(92, 18);

  // LINEAR on purpose: the curve plots at a machine's pace, so each report row
  // below can land on the exact frame its point is plotted (24 / 48 / 72).
  const line = entrance(frame, fps, m, {delayFrames: 24, durFrames: 48, easing: Easing.linear});

  // The report list prints top-down (newest iteration first) while the curve is
  // still drawing; landing them bottom-up instead leaves a floating row under an
  // empty band, because the slots the table reserves keep their height.
  const rowStyle = (i: number): React.CSSProperties => {
    const p = ramp(26 + staggerDelay(i, 16, m), 12);
    return {
      opacity: p,
      transform: `translateY(${((1 - p) * 14).toFixed(2)}px)`,
    };
  };

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        color: brand.colors.ink,
      }}
    >
      <div style={{transform: `scale(${dolly.toFixed(4)})`, transformOrigin: 'center center'}}>
        <div
          style={{
            width: CARD_W,
            backgroundColor: brand.colors.surface,
            borderTop: `3px solid ${brand.colors.ink}`,
            clipPath: `inset(0% 0% ${((1 - unroll) * 100).toFixed(2)}% 0%)`,
          }}
        >
          <div
            style={{
              height: 62,
              backgroundColor: brand.colors.surface2,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: `0 ${CARD_PAD}px`,
              fontFamily: fonts.mono,
            }}
          >
            <span style={{fontSize: 30, fontWeight: 500, letterSpacing: 3}}>CONVERGENCE</span>
            <span style={{fontSize: 26, fontWeight: 400, color: brand.colors.ink2, letterSpacing: 1}}>
              3 reports · 1.673 s
            </span>
          </div>
          <Rule brand={brand} delayFrames={8} durFrames={16} thickness={3} />

          <div style={{padding: CARD_PAD, display: 'flex', flexDirection: 'column'}}>
            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 26,
                fontWeight: 500,
                letterSpacing: 4,
                color: brand.colors.ink,
                clipPath: `inset(0% ${((1 - labelWipe) * 100).toFixed(2)}% 0% 0%)`,
              }}
            >
              EXPLOITABILITY
            </div>

            <div style={{display: 'flex', alignItems: 'baseline', gap: 28, marginTop: 6}}>
              <Figure
                mono={fonts.mono}
                from={HI}
                to={LO}
                delayFrames={14}
                durFrames={42}
                format={(v) => `${v.toFixed(4)}%`}
                style={{fontSize: 112, fontWeight: 500, letterSpacing: -2, lineHeight: 1.08}}
              />
              <Stamp brand={brand} mono={fonts.mono} text="[measured]" delayFrames={58} fontSize={30} />
            </div>

            <div
              style={{
                fontFamily: fonts.mono,
                fontSize: 26,
                fontWeight: 400,
                color: brand.colors.ink2,
                letterSpacing: 1,
                marginTop: 4,
                clipPath: `inset(0% ${((1 - subWipe) * 100).toFixed(2)}% 0% 0%)`,
              }}
            >
              0.002589 bb at iteration 150
            </div>

            <div
              style={{
                marginTop: 22,
                width: CHART_W,
                height: CHART_H,
                backgroundColor: brand.colors.surface2,
                border: `3px solid ${brand.colors.ink}`,
                boxSizing: 'border-box',
                position: 'relative',
                clipPath: `inset(0% ${((1 - chartWipe) * 100).toFixed(2)}% 0% 0%)`,
              }}
            >
              <svg width={CHART_W} height={CHART_H} style={{position: 'absolute', left: 0, top: 0}}>
                <path
                  d={CURVE_D}
                  fill="none"
                  stroke={brand.colors.ink}
                  strokeWidth={3}
                  strokeDasharray={CURVE_LEN}
                  strokeDashoffset={CURVE_LEN * (1 - line)}
                />
                {DOTS.map((dot) => {
                  const lo = Math.min(dot.t, 0.95);
                  const o = entrance(line, fps, m, {delayFrames: lo, durFrames: 0.05});
                  return (
                    <circle
                      key={dot.t}
                      cx={dot.p.x}
                      cy={dot.p.y}
                      r={7}
                      fill={brand.colors.ink}
                      opacity={o}
                    />
                  );
                })}
              </svg>
              <span
                style={{
                  position: 'absolute',
                  left: CHART_INSET_X + 4,
                  top: 8,
                  fontFamily: fonts.mono,
                  fontSize: 20,
                  color: brand.colors.ink2,
                }}
              >
                0.3124%
              </span>
              <span
                style={{
                  position: 'absolute',
                  left: CHART_INSET_X + 4,
                  bottom: 8,
                  fontFamily: fonts.mono,
                  fontSize: 20,
                  color: brand.colors.ink2,
                }}
              >
                0.0471%
              </span>
            </div>

            <div
              style={{
                marginTop: 24,
                display: 'flex',
                fontFamily: fonts.mono,
                fontSize: 24,
                fontWeight: 500,
                letterSpacing: 3,
                clipPath: `inset(0% ${((1 - headWipe) * 100).toFixed(2)}% 0% 0%)`,
              }}
            >
              <span style={{width: `${COL_BB * 100}%`}}>ITER</span>
              <span style={{width: `${(COL_POT - COL_BB) * 100}%`, textAlign: 'right'}}>BB</span>
              <span style={{width: `${(1 - COL_POT) * 100}%`, textAlign: 'right'}}>% OF POT</span>
            </div>
            <div style={{marginTop: 8}}>
              <Rule brand={brand} delayFrames={18} durFrames={14} thickness={3} />
            </div>

            {[...SERIES].reverse().map((row, i) => (
              <div
                key={row.iter}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 54,
                  padding: '0 8px',
                  boxSizing: 'border-box',
                  backgroundColor: i === 1 ? brand.colors.surface2 : 'transparent',
                  fontFamily: fonts.mono,
                  fontSize: 30,
                  fontVariantNumeric: 'tabular-nums',
                  color: i === 0 ? brand.colors.ink : brand.colors.ink2,
                  ...rowStyle(i),
                }}
              >
                <span style={{width: `${COL_BB * 100}%`, fontWeight: i === 0 ? 500 : 400}}>{row.iter}</span>
                <span style={{width: `${(COL_POT - COL_BB) * 100}%`, textAlign: 'right'}}>{row.bb}</span>
                <span style={{width: `${(1 - COL_POT) * 100}%`, textAlign: 'right'}}>{row.pot}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            width: CARD_W,
            marginTop: 32,
            fontFamily: fonts.display,
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: -0.2,
            color: brand.colors.ink,
            clipPath: `inset(0% ${((1 - captionWipe) * 100).toFixed(2)}% 0% 0%)`,
          }}
        >
          A separate best-response calculator. Not the solver grading itself.
        </div>
      </div>
    </AbsoluteFill>
  );
};
