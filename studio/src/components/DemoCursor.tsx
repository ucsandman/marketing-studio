import React from 'react';
import type {Brand} from '../lib/brand';
import type {ClickEvent} from '../lib/telemetry';
import {cursorAt} from '../lib/telemetry';
import {CURSOR_TIP, CursorGlyph} from './StageCursor';

const RIPPLE_MS = 400;

export const DemoCursor: React.FC<{
  clickList: ClickEvent[];
  timeMs: number;
  brand: Brand;
  viewport: {width: number; height: number};
}> = ({clickList, timeMs, brand, viewport}) => {
  const {x, y, press} = cursorAt(clickList, timeMs, viewport);
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      {/* click ripples */}
      {clickList.map((c, i) => {
        const dt = timeMs - c.t;
        if (dt < 0 || dt > RIPPLE_MS) return null;
        const p = dt / RIPPLE_MS;
        const r = 14 + p * 36;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: c.x - r,
              top: c.y - r,
              width: r * 2,
              height: r * 2,
              borderRadius: '50%',
              border: `2.5px solid ${brand.colors.brand}`,
              opacity: 0.8 * (1 - p),
            }}
          />
        );
      })}
      {/* pointer — shared stage-prop glyph (44x54, white + heavy stroke): a
          life-size ink-colored cursor vanishes into saturated controls */}
      <div
        style={{
          position: 'absolute',
          left: x - CURSOR_TIP.x,
          top: y - CURSOR_TIP.y,
          transform: `scale(${press ? 0.86 : 1})`,
          transformOrigin: '14% 6%',
        }}
      >
        <CursorGlyph />
      </div>
    </div>
  );
};
