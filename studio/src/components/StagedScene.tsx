import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Brand} from '../lib/brand';
import {loadBrandFonts} from '../lib/fonts';
import {useFormat} from '../lib/layout';
import {brandSpring, entrance, staggerDelay} from '../lib/motion';
import type {Motion} from '../lib/motion';
import {CameraRig} from './CameraRig';
import {RackFocus} from './RackFocus';
import {SpecularSweep} from './SpecularSweep';
import {StageCursor, controlPressScale} from './StageCursor';
import type {CursorWaypoint} from './StageCursor';
import {
  COMPOSER_NOMINAL,
  STAGE,
  center,
  clamp01,
  composerLayout,
  caretOn,
  originPct,
  pulse,
  pushTarget,
  resultsLayout,
  skelWidths,
  smoothstep,
  stageFit,
  stagedBeats,
  statusLayout,
  typedSlice,
} from '../lib/staged';
import type {
  ComposerBeats,
  ComposerConfig,
  Rect,
  ResultsBeats,
  ResultsConfig,
  StagedConfig,
  StatusBeats,
  StatusConfig,
} from '../lib/staged';

// Staged native-UI scene (docs/product-launch-motion-adoption.md, Phase C + shot
// catalog 4/5/7). Three data-driven constructions — `results` (a skeleton
// waterfall resolving one row at a time, the highlighted row last), `composer`
// (a deterministic typed query, a cursor that clicks submit, a run panel whose
// LAST step is deliberately still running at the cut) and `status` (a tracker
// with a real subject and states completing in sequence).
//
// Every string on screen comes from `config`; nothing here names a product.
// Every rect comes from lib/staged (never getBoundingClientRect, which lies under
// the rig's scale and rotation). The fit-to-frame scale is a STATIC third node
// above CameraRig so it never shares a matrix with the dolly or the turn.

type Fonts = ReturnType<typeof loadBrandFonts>;

type ShotProps<C, B> = {cfg: C; beats: B; brand: Brand; fonts: Fonts; len: number};

const EASE_OUT = Easing.out(Easing.cubic);
const BACK_OUT = Easing.out(Easing.back(1.8));

/** Timed reveal 0..1 through the brand's motion personality. */
const rev = (
  frame: number,
  fps: number,
  motion: Motion,
  at: number,
  dur: number,
  easing: (t: number) => number = EASE_OUT,
): number => entrance(frame, fps, motion, {delayFrames: at, durFrames: dur, easing});

/** The ONE shared driver a state flip runs off, so no column can shift mid-swap. */
const flip = (frame: number, at: number, dur: number): number =>
  smoothstep(clamp01((frame - at) / Math.max(1, dur)));

const rectStyle = (r: {x: number; y: number; w: number; h: number}): React.CSSProperties => ({
  position: 'absolute',
  left: r.x,
  top: r.y,
  width: r.w,
  height: r.h,
});

// ---------------------------------------------------------------------------
// shared parts
// ---------------------------------------------------------------------------

const Plate: React.FC<{
  rect: {x: number; y: number; w: number; h: number};
  brand: Brand;
  ground?: 'surface' | 'surface2';
  radius?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({rect, brand, ground = 'surface', radius = 22, style, children}) => (
  <div
    style={{
      ...rectStyle(rect),
      background: brand.colors[ground],
      border: `1px solid ${brand.colors.line}`,
      borderRadius: radius,
      overflow: 'hidden',
      ...style,
    }}
  >
    {children}
  </div>
);

// The bar tone is colors.line, not colors.surface2: a skeleton sits ON a surface2
// plate, so a surface2 bar is invisible (proven in out/staged/01).
const SkeletonLine: React.FC<{brand: Brand; widthPct: number; height: number}> = ({
  brand,
  widthPct,
  height,
}) => (
  <div
    style={{
      width: `${widthPct}%`,
      height,
      borderRadius: height / 2,
      background: brand.colors.line,
    }}
  />
);

/** Idle/resolved pill sharing one box, cross-faded on a single driver. */
const StatePill: React.FC<{
  rect: {x: number; y: number; w: number; h: number};
  idle: string;
  resolved: string;
  p: number;
  accent: boolean;
  brand: Brand;
  fonts: Fonts;
  scale?: number;
}> = ({rect, idle, resolved, p, accent, brand, fonts, scale = 1}) => {
  const restFill = accent ? brand.colors.brand : brand.colors.line;
  const restInk = accent ? brand.colors.bg : brand.colors.ink;
  const box: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: fonts.body,
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: 0.2,
  };
  return (
    <div
      style={{
        ...rectStyle(rect),
        borderRadius: rect.h / 2,
        border: `1px solid ${p > 0.5 && accent ? brand.colors.brand : brand.colors.line}`,
        background: p > 0.5 ? restFill : brand.colors.surface2,
        transform: `translateZ(16px) scale(${scale})`,
      }}
    >
      <div style={{...box, opacity: 1 - p, color: brand.colors.ink3}}>{idle}</div>
      <div style={{...box, opacity: p, color: restInk}}>{resolved}</div>
    </div>
  );
};

/** Determinate ring: background circle plus an arc drawn by dash offset. */
const Ring: React.FC<{size: number; arc: number; color: string; track: string}> = ({
  size,
  arc,
  color,
  track,
}) => {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{display: 'block'}}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={3} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamp01(arc))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
};

const Check: React.FC<{size: number; color: string; p: number}> = ({size, color, p}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{display: 'block', opacity: p, transform: `scale(${0.7 + 0.3 * p})`}}
  >
    <path
      d="M5 12.5 L10 17.5 L19 7"
      fill="none"
      stroke={color}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

const ResultsShot: React.FC<ShotProps<ResultsConfig, ResultsBeats>> = ({
  cfg,
  beats,
  brand,
  fonts,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const m = brand.motion;
  const L = resultsLayout(cfg);
  const h = Math.min(cfg.highlightIndex, cfg.rows.length - 1);
  const cardIn = brandSpring(frame, fps, m);
  const accentText = brand.colors[brand.textAccent];
  return (
    <AbsoluteFill
      style={{
        transformStyle: 'preserve-3d',
        opacity: cardIn,
        transform: `translateY(${18 * (1 - cardIn)}px) scale(${0.978 + 0.022 * cardIn})`,
      }}
    >
      <Plate rect={L.card} brand={brand} />
      {/* query bar: the text is already typed; only the accent rim lights */}
      <Plate rect={L.bar} brand={brand} ground="surface2" radius={14}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: brand.colors.brand,
            opacity: rev(frame, fps, m, beats.barLight, 5),
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 26,
            fontFamily: fonts.body,
            fontSize: 30,
            color: brand.colors.ink2,
          }}
        >
          {cfg.query}
        </div>
      </Plate>
      <div
        style={{
          ...rectStyle(L.chipRow),
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        {cfg.chips.map((chip, i) => {
          const p = rev(frame, fps, m, beats.chip[0] + staggerDelay(i, beats.chipStep, m), 7);
          return (
            <div
              key={i}
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                border: `1px solid ${brand.colors.line}`,
                background: brand.colors.surface2,
                fontFamily: fonts.body,
                fontSize: 20,
                color: brand.colors.ink3,
                opacity: p,
                transform: `scale(${0.94 + 0.06 * p})`,
              }}
            >
              {chip}
            </div>
          );
        })}
        {cfg.countLabel ? (
          <div
            style={{
              marginLeft: 'auto',
              fontFamily: fonts.mono,
              fontVariantNumeric: 'tabular-nums',
              fontSize: 24,
              color: accentText,
              opacity: rev(frame, fps, m, beats.countAt, 8),
            }}
          >
            {cfg.countLabel}
          </div>
        ) : null}
      </div>
      {cfg.rows.map((row, i) => {
        const skelIn = rev(frame, fps, m, beats.skeleton[0] + staggerDelay(i, beats.skelStep, m), 8);
        const p = flip(frame, beats.resolve[i], beats.resolveDur);
        const w = skelWidths(i);
        const pad: React.CSSProperties = {
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 26,
          paddingRight: 214,
        };
        return (
          <Plate key={i} rect={L.rows[i]} brand={brand} ground="surface2" radius={14}>
            <div style={{...pad, opacity: skelIn * (1 - p)}}>
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12}}>
                <SkeletonLine brand={brand} widthPct={w.primary} height={16} />
                <SkeletonLine brand={brand} widthPct={w.secondary} height={12} />
              </div>
              <div
                style={{
                  width: 96,
                  height: 14,
                  borderRadius: 7,
                  background: brand.colors.line,
                }}
              />
            </div>
            <div style={{...pad, opacity: p, transform: `translateY(${(1 - p) * 6}px)`}}>
              <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6}}>
                <div
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 30,
                    fontWeight: 600,
                    color: brand.colors.ink,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.primary}
                </div>
                <div style={{fontFamily: fonts.body, fontSize: 22, color: brand.colors.ink3}}>
                  {row.secondary}
                </div>
              </div>
              {row.meta ? (
                <div
                  style={{
                    width: 96,
                    textAlign: 'right',
                    fontFamily: fonts.mono,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 24,
                    color: brand.colors.ink2,
                  }}
                >
                  {row.meta}
                </div>
              ) : null}
            </div>
          </Plate>
        );
      })}
      {cfg.rows.map((row, i) => {
        const p = flip(frame, beats.resolve[i], beats.resolveDur);
        // the shot's ONE overshoot: the highlighted row's flip
        const pop =
          i === h
            ? 0.94 + 0.06 * rev(frame, fps, m, beats.resolve[i], beats.resolveDur, BACK_OUT)
            : 1;
        const press = i === h ? controlPressScale(frame, beats.click) : 1;
        return (
          <StatePill
            key={i}
            rect={L.rowState[i]}
            idle={row.idleState}
            resolved={row.state}
            p={p}
            accent={i === h}
            brand={brand}
            fonts={fonts}
            scale={pop * press}
          />
        );
      })}
      {L.stat && cfg.stat ? (
        <div style={rectStyle(L.stat)}>
          <RackFocus at={beats.rack.at} release={beats.rack.release}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'flex-start',
                height: L.stat.h,
                gap: 10,
                opacity: rev(frame, fps, m, beats.countAt, 10),
              }}
            >
              <div
                style={{
                  fontFamily: fonts.display,
                  fontWeight: 800,
                  fontSize: 92,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  color: accentText,
                }}
              >
                {cfg.stat.value}
              </div>
              <div style={{fontFamily: fonts.body, fontSize: 24, color: brand.colors.ink3}}>
                {cfg.stat.label}
              </div>
            </div>
          </RackFocus>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// composer
// ---------------------------------------------------------------------------

const StepRow: React.FC<{
  rect: {x: number; y: number; w: number; h: number};
  label: string;
  meta: string | null;
  done: number;
  arc: number;
  ringColor: string;
  brand: Brand;
  fonts: Fonts;
  opacity: number;
}> = ({rect, label, meta, done, arc, ringColor, brand, fonts, opacity}) => (
  <div style={{...rectStyle(rect), display: 'flex', alignItems: 'center', gap: 24, opacity}}>
    <div style={{position: 'relative', width: 40, height: 40}}>
      <Ring size={40} arc={arc} color={ringColor} track={brand.colors.line} />
      <div style={{position: 'absolute', left: 8, top: 8}}>
        <Check size={24} color={brand.colors.ink} p={done} />
      </div>
    </div>
    <div
      style={{
        flex: 1,
        fontFamily: fonts.body,
        fontSize: 28,
        fontWeight: 500,
        color: done > 0.5 ? brand.colors.ink : brand.colors.ink3,
      }}
    >
      {label}
    </div>
    {meta ? (
      <div
        style={{
          fontFamily: fonts.mono,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 22,
          color: brand.colors.ink2,
          opacity: done,
        }}
      >
        {meta}
      </div>
    ) : null}
  </div>
);

const ComposerShot: React.FC<ShotProps<ComposerConfig, ComposerBeats>> = ({
  cfg,
  beats,
  brand,
  fonts,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const m = brand.motion;
  const L = composerLayout(cfg);
  const cardIn = brandSpring(frame, fps, m);
  const accentText = brand.colors[brand.textAccent];
  const focus = flip(frame, beats.click1, beats.focusDur);
  const typed = typedSlice(cfg.query, frame, beats.typeStart, beats.typeDur);
  const caret = caretOn(frame, beats.click1, beats.typeEnd, fps);
  const fill = flip(frame, beats.click2, beats.fillDur);
  const submitted = fill >= COMPOSER_NOMINAL.labelSwapP;
  const panel = flip(frame, beats.panelAt, beats.panelDur);
  const last = cfg.steps.length - 1;
  const stepsIn = rev(frame, fps, m, beats.panelAt + Math.round(beats.panelDur * 0.7), 8);
  return (
    <AbsoluteFill
      style={{
        transformStyle: 'preserve-3d',
        opacity: cardIn,
        transform: `translateY(${18 * (1 - cardIn)}px) scale(${0.978 + 0.022 * cardIn})`,
      }}
    >
      <Plate rect={L.card} brand={brand} />
      {/* focus rim behind the field: a ~3px accent band shows around the plate */}
      <div
        style={{
          ...rectStyle({x: L.field.x - 3, y: L.field.y - 3, w: L.field.w + 6, h: L.field.h + 6}),
          borderRadius: 17,
          background: brand.colors.brand,
          opacity: focus,
        }}
      />
      <Plate
        rect={L.field}
        brand={brand}
        ground="surface2"
        radius={14}
        style={{transform: 'translateZ(16px)'}}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 26,
            fontFamily: fonts.body,
            fontSize: 32,
            color: brand.colors.ink3,
            opacity: 1 - focus,
          }}
        >
          {cfg.placeholder}
        </div>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 26,
            fontFamily: fonts.body,
            fontSize: 32,
            color: brand.colors.ink,
            opacity: focus,
            whiteSpace: 'nowrap',
          }}
        >
          {typed}
          <span
            style={{
              display: 'inline-block',
              width: 3,
              height: 34,
              marginLeft: 3,
              background: accentText,
              opacity: caret ? 1 : 0,
            }}
          />
        </div>
      </Plate>
      <div
        style={{
          ...rectStyle(L.submit),
          borderRadius: 14,
          border: `1.5px solid ${brand.colors.brand}`,
          overflow: 'hidden',
          transform: `translateZ(16px) scale(${controlPressScale(frame, beats.click2)})`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: brand.colors.brand,
            transformOrigin: 'left center',
            transform: `scaleX(${fill})`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.body,
            fontSize: 26,
            fontWeight: 700,
            color: submitted ? brand.colors.bg : brand.colors.ink,
          }}
        >
          {submitted ? (cfg.submittedLabel ?? cfg.submitLabel) : cfg.submitLabel}
        </div>
      </div>
      <Plate
        rect={L.panel}
        brand={brand}
        style={{transformOrigin: 'top center', transform: `scaleY(${panel})`, opacity: panel}}
      />
      {cfg.runTitle ? (
        <div
          style={{
            position: 'absolute',
            left: L.panel.x + 36,
            top: L.panel.y + 40,
            fontFamily: fonts.body,
            fontSize: 24,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            color: brand.colors.ink3,
            opacity: stepsIn,
          }}
        >
          {cfg.runTitle}
        </div>
      ) : null}
      {cfg.steps.map((step, j) => {
        if (j === last) {
          // deliberately LEFT RUNNING at the cut: a determinate arc that grows to
          // `runningArc` and holds. No spinner, no loop, no rotation.
          const grow = rev(frame, fps, m, beats.lastGrowthAt, beats.lastGrowthDur);
          const tint = rev(frame, fps, m, beats.stepAt[j], beats.stepDur);
          return (
            <StepRow
              key={j}
              rect={L.steps[j]}
              label={step.label}
              meta={step.meta}
              done={0}
              arc={beats.runningArc * grow}
              ringColor={tint > 0 ? brand.colors.brand : brand.colors.line}
              brand={brand}
              fonts={fonts}
              opacity={stepsIn}
            />
          );
        }
        const p = flip(frame, beats.stepAt[j], beats.stepDur);
        return (
          <StepRow
            key={j}
            rect={L.steps[j]}
            label={step.label}
            meta={step.meta}
            done={p}
            arc={p}
            ringColor={brand.colors.ink2}
            brand={brand}
            fonts={fonts}
            opacity={stepsIn}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

const StatusShot: React.FC<ShotProps<StatusConfig, StatusBeats>> = ({
  cfg,
  beats,
  brand,
  fonts,
  len,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const m = brand.motion;
  const L = statusLayout(cfg);
  const cardIn = brandSpring(frame, fps, m);
  const accentText = brand.colors[brand.textAccent];
  // two-plane parallax, one slow move each across the whole shot
  const far = interpolate(frame, [0, len], [6, -6], {easing: Easing.inOut(Easing.quad)});
  const near = interpolate(frame, [0, len], [-14, 14], {easing: Easing.inOut(Easing.quad)});
  const badgeIn = brandSpring(frame, fps, m, {delayFrames: beats.badgeAt}); // the shot's ONE overshoot
  const swell = beats.pulseAt === null ? 1 : pulse(frame, beats.pulseAt, beats.pulseDur);
  return (
    <AbsoluteFill style={{transformStyle: 'preserve-3d', opacity: cardIn}}>
      <AbsoluteFill
        style={{
          transformStyle: 'preserve-3d',
          transform: `translateY(${far + 18 * (1 - cardIn)}px) scale(${0.978 + 0.022 * cardIn})`,
        }}
      >
        <Plate rect={L.card} brand={brand} />
        <div
          style={{
            position: 'absolute',
            left: L.badge.x + L.badge.w + 28,
            top: L.card.y + 52,
            right: 0,
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 44,
            color: brand.colors.ink,
            opacity: rev(frame, fps, m, beats.titleAt, 10),
          }}
        >
          {cfg.subject.title}
        </div>
        {cfg.subject.sub ? (
          <div
            style={{
              position: 'absolute',
              left: L.badge.x + L.badge.w + 28,
              top: L.card.y + 108,
              right: 0,
              fontFamily: fonts.body,
              fontSize: 24,
              color: brand.colors.ink3,
              opacity: rev(frame, fps, m, beats.subAt, 10),
            }}
          >
            {cfg.subject.sub}
          </div>
        ) : null}
        {L.connectors.map((conn, j) => {
          const p = flip(frame, beats.connectorAt[j], beats.connectorDur);
          return (
            <div
              key={j}
              style={{
                ...rectStyle(conn),
                borderRadius: 2,
                background: brand.colors.brand,
                transformOrigin: 'top center',
                transform: `scaleY(${p})`,
              }}
            />
          );
        })}
        {cfg.states.map((state, j) => {
          const p = flip(frame, beats.stateAt[j], beats.stateDur);
          const ping = clamp01((frame - beats.stateAt[j]) / 12);
          const circle = L.circles[j];
          return (
            <React.Fragment key={j}>
              <Plate
                rect={L.states[j]}
                brand={brand}
                ground="surface2"
                radius={14}
                style={{transform: `scale(${swell})`, transformOrigin: 'center center'}}
              />
              <div
                style={{
                  ...rectStyle(circle),
                  borderRadius: '50%',
                  border: `2.5px solid ${p > 0.5 ? brand.colors.brand : brand.colors.line}`,
                  background: p > 0.5 ? brand.colors.brand : 'transparent',
                  transform: `scale(${0.6 + 0.4 * p})`,
                }}
              >
                <div style={{position: 'absolute', left: 8, top: 8}}>
                  <Check size={24} color={brand.colors.bg} p={p} />
                </div>
              </div>
              {ping > 0 && ping < 1 ? (
                <div
                  style={{
                    ...rectStyle(circle),
                    borderRadius: '50%',
                    border: `2px solid ${brand.colors.brand}`,
                    opacity: 0.7 * (1 - ping),
                    transform: `scale(${0.6 + 1.3 * ping})`,
                  }}
                />
              ) : null}
              <div
                style={{
                  position: 'absolute',
                  left: circle.x + circle.w + 26,
                  top: L.states[j].y + 20,
                  fontFamily: fonts.body,
                  fontSize: 28,
                  fontWeight: 500,
                  color: p > 0.5 ? brand.colors.ink : brand.colors.ink3,
                }}
              >
                {state.label}
              </div>
              {state.meta ? (
                <div
                  style={{
                    position: 'absolute',
                    left: L.states[j].x + L.states[j].w - 160,
                    top: L.states[j].y + 24,
                    width: 130,
                    textAlign: 'right',
                    fontFamily: fonts.mono,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 22,
                    color: brand.colors.ink2,
                    opacity: p,
                  }}
                >
                  {state.meta}
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
        {L.action && cfg.action && beats.click !== null ? (
          <div
            style={{
              ...rectStyle(L.action),
              borderRadius: 14,
              border: `1.5px solid ${brand.colors.brand}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: fonts.body,
              fontSize: 26,
              fontWeight: 700,
              color: brand.colors.ink,
              transform: `translateZ(16px) scale(${controlPressScale(frame, beats.click)})`,
            }}
          >
            {cfg.action.label}
          </div>
        ) : null}
      </AbsoluteFill>
      <AbsoluteFill style={{transformStyle: 'preserve-3d', transform: `translateY(${near}px)`}}>
        <div
          style={{
            ...rectStyle(L.badge),
            borderRadius: 20,
            background: brand.colors.surface2,
            border: `1px solid ${brand.colors.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 34,
            color: brand.colors.ink,
            opacity: badgeIn,
            transform: `translateZ(18px) scale(${0.9 + 0.1 * badgeIn})`,
          }}
        >
          {cfg.subject.badge}
        </div>
        {L.counter && cfg.counter && beats.counterAt !== null ? (
          <div
            style={{
              ...rectStyle(L.counter),
              borderRadius: 20,
              background: brand.colors.surface2,
              border: `1px solid ${brand.colors.line}`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              opacity: rev(frame, fps, m, beats.counterAt, 10),
              transform: `translateZ(18px) scale(${swell})`,
            }}
          >
            <div
              style={{
                fontFamily: fonts.mono,
                fontVariantNumeric: 'tabular-nums',
                fontSize: 56,
                lineHeight: 1,
                color: accentText,
              }}
            >
              {cfg.counter.value}
            </div>
            <div style={{fontFamily: fonts.body, fontSize: 20, color: brand.colors.ink3}}>
              {cfg.counter.label}
            </div>
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// camera + cursor choreography (derived, never hand placed)
// ---------------------------------------------------------------------------

type Rig = {
  turn: {fromY: number; toY: number; fromX: number; toX: number; perspective: number; len: number};
  dolly: {at: number; dur: number; to: number}[];
  origin: string;
  path: CursorWaypoint[];
  clicks: {at: number}[];
  appearAt: number;
  exitAt: number | null;
  sweep: number[];
  // the sweep is clipped to the shot's card: across the bare stage box it reads as
  // a grey slab floating on the brand ground (proven in out/staged/01).
  sweepBox: Rect;
};

const rigFor = (cfg: StagedConfig, beats: ReturnType<typeof stagedBeats>, len: number, seat: number): Rig => {
  // adjacent staged acts never turn the same way
  const dir = seat % 2 === 0 ? -1 : 1;
  const target = pushTarget(cfg);
  const origin = target ? originPct(target.origin) : '50% 50%';
  if (cfg.kind === 'results' && beats.kind === 'results') {
    const L = resultsLayout(cfg);
    const h = Math.min(cfg.highlightIndex, cfg.rows.length - 1);
    return {
      turn: {fromY: -6.5 * dir, toY: -1.4 * dir, fromX: 1.6, toX: 0.4, perspective: 2600, len},
      dolly: [beats.push, beats.release],
      origin,
      path: [
        {x: L.card.x + 120, y: L.card.y + L.card.h - 60, at: 0},
        {...center(L.rowState[h]), at: beats.arrive[0]},
      ],
      clicks: [{at: beats.click}],
      appearAt: beats.cursorAppear,
      exitAt: beats.cursorExit,
      sweep: beats.sweep,
      sweepBox: L.card,
    };
  }
  if (cfg.kind === 'composer' && beats.kind === 'composer') {
    const L = composerLayout(cfg);
    return {
      turn: {fromY: -3.2 * dir, toY: -0.9 * dir, fromX: 1.0, toX: 0.3, perspective: 2800, len},
      dolly: [beats.push, beats.release],
      origin,
      path: [
        {x: L.field.x - 90, y: L.field.y + 150, at: 0},
        {...center(L.field), at: beats.arrive[0]},
        {...center(L.submit), at: beats.arrive[1]},
      ],
      clicks: [{at: beats.click1}, {at: beats.click2}],
      appearAt: beats.cursorAppear,
      exitAt: beats.cursorExit,
      sweep: beats.sweep,
      sweepBox: L.card,
    };
  }
  const cfgStatus = cfg as StatusConfig;
  const b = beats as StatusBeats;
  const L = statusLayout(cfgStatus);
  const turn = {fromY: -4.6 * dir, toY: -1.1 * dir, fromX: 1.4, toX: 0.35, perspective: 2600, len};
  if (!L.action || b.click === null || b.push === null || b.release === null) {
    // no action: two-plane parallax carries the shot, no push and no cursor
    return {turn, dolly: [], origin: '50% 50%', path: [], clicks: [], appearAt: 0, exitAt: null, sweep: b.sweep, sweepBox: L.card};
  }
  return {
    turn,
    dolly: [b.push, b.release],
    origin,
    path: [
      {x: L.card.x + 120, y: L.card.y + L.card.h - 40, at: 0},
      {...center(L.action), at: b.arrive[0]},
    ],
    clicks: [{at: b.click}],
    appearAt: b.cursorAppear ?? 0,
    exitAt: b.cursorExit,
    sweep: b.sweep,
    sweepBox: L.card,
  };
};

// ---------------------------------------------------------------------------
// public shape
// ---------------------------------------------------------------------------

export const StagedScene: React.FC<{
  config: StagedConfig;
  len: number; // act length in frames; drives beat scaling
  brand: Brand;
  seat?: number; // feature index; mirrors the turn direction on odd seats
}> = ({config, len, brand, seat = 0}) => {
  const {fps} = useVideoConfig();
  const format = useFormat();
  const fonts = loadBrandFonts(brand);
  const beats = stagedBeats(config, len, fps);
  const {fit, cx, cy} = stageFit(format);
  const rig = rigFor(config, beats, len, seat);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: cx - STAGE.w / 2,
          top: cy - STAGE.h / 2,
          width: STAGE.w,
          height: STAGE.h,
          transform: `scale(${fit})`,
          transformOrigin: '50% 50%',
        }}
      >
        <CameraRig turn={rig.turn} dollyOrigin={rig.origin} dolly={rig.dolly}>
          {config.kind === 'results' && beats.kind === 'results' ? (
            <ResultsShot cfg={config} beats={beats} brand={brand} fonts={fonts} len={len} />
          ) : null}
          {config.kind === 'composer' && beats.kind === 'composer' ? (
            <ComposerShot cfg={config} beats={beats} brand={brand} fonts={fonts} len={len} />
          ) : null}
          {config.kind === 'status' && beats.kind === 'status' ? (
            <StatusShot cfg={config} beats={beats} brand={brand} fonts={fonts} len={len} />
          ) : null}
          {rig.path.length ? (
            <StageCursor
              path={rig.path}
              clicks={rig.clicks}
              brand={brand}
              appearAt={rig.appearAt}
              exitAt={rig.exitAt}
            />
          ) : null}
        </CameraRig>
        <div style={{...rectStyle(rig.sweepBox), overflow: 'hidden'}}>
          <SpecularSweep beats={rig.sweep} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
