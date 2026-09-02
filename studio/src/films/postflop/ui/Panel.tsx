import React from 'react';
import type {Brand} from '../../../lib/brand';

// The workbench's dark panel: near-black body under a filled yellow header bar
// carrying ink mono text. Zero radius, zero shadow — the brand's whole identity
// is a printed spec sheet.

export const PANEL_BODY = '#101010';

export type PanelProps = {
  brand: Brand;
  mono: string;
  /** Bold left-hand header text, e.g. "OOP STRATEGY". */
  title: string;
  /** Dimmer run-on after the title, e.g. "363 combos · node 0 · turn". */
  meta?: string | null;
  /** Outlined chip pinned to the right of the header bar, e.g. "LOCK NODE". */
  chip?: string | null;
  width: number;
  height?: number;
  headerHeight?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
};

export const Panel: React.FC<PanelProps> = ({
  brand,
  mono,
  title,
  meta = null,
  chip = null,
  width,
  height,
  headerHeight = 34,
  children,
  style,
  bodyStyle,
}) => (
  <div style={{width, height, backgroundColor: PANEL_BODY, fontFamily: mono, ...style}}>
    <div
      style={{
        height: headerHeight,
        backgroundColor: brand.colors.brand,
        color: brand.colors.ink,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 12px',
        fontSize: headerHeight * 0.44,
        fontWeight: 500,
      }}
    >
      <span style={{fontWeight: 700, letterSpacing: 1.2}}>{title}</span>
      {meta ? <span style={{opacity: 0.72}}>{meta}</span> : null}
      {chip ? (
        <span
          style={{
            marginLeft: 'auto',
            border: `2px solid ${brand.colors.ink}`,
            padding: '2px 8px',
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {chip}
        </span>
      ) : null}
    </div>
    <div style={{padding: 12, color: brand.colors.surface, ...bodyStyle}}>{children}</div>
  </div>
);
