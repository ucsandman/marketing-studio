import React from 'react';
import {useCurrentFrame} from 'remotion';
import type {Brand} from '../../../lib/brand';

// The workbench's 13x13 range grid, rebuilt natively from
// studio/public/postflop/feature-tree.png. Row/column order is the poker
// convention A..2; the diagonal is pairs, ABOVE the diagonal is suited (s),
// BELOW is offsuit (o). Cell colors are transcribed from the real screenshot,
// not invented: the product draws green/red/cream/empty and nothing else.

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

export type CellState = 'green' | 'red' | 'cream' | 'empty';

// One char per cell, 13 rows x 13 chars: g green, r red, c cream, . empty (fold).
const MAP = [
  'ggggggggggggg',
  'ggggrgggggg..',
  'grgggggggg...',
  'ggggggggg....',
  'grggggggg....',
  'gg.g.cggg....',
  'g.....cgg....',
  '.......cgg...',
  '........cg...',
  '.........cg..',
  '..........c..',
  '...........g.',
  '............r',
];

const STATE_OF: Record<string, CellState> = {g: 'green', r: 'red', c: 'cream', '.': 'empty'};

/** The real hand label for a cell, e.g. (0,1) -> "AKs", (1,0) -> "AKo", (4,4) -> "TT". */
export const handLabel = (row: number, col: number): string => {
  if (row === col) return `${RANKS[row]}${RANKS[row]}`;
  if (col > row) return `${RANKS[row]}${RANKS[col]}s`;
  return `${RANKS[col]}${RANKS[row]}o`;
};

/** The state the product paints this cell once it has resolved. */
export const cellState = (row: number, col: number): CellState =>
  STATE_OF[MAP[row][col]] ?? 'empty';

/** Empty-cell ground; the panel behind the grid is darker still. */
export const GRID_EMPTY = '#1a1a1a';
const GRID_EMPTY_INK = '#4d4a44';
const GRID_GUTTER = '#262622';

const fillFor = (brand: Brand, state: CellState): string => {
  if (state === 'green') return brand.colors.profit;
  if (state === 'red') return brand.colors.loss;
  if (state === 'cream') return brand.colors.surface;
  return GRID_EMPTY;
};

const inkFor = (brand: Brand, state: CellState): string => {
  if (state === 'cream') return brand.colors.ink;
  if (state === 'empty') return GRID_EMPTY_INK;
  return brand.colors.surface;
};

/**
 * Diagonal waterfall order for a cell: 0 at the top-left corner, 1 at the
 * bottom-right. Shots that want a plain 0..1 `progress` get the reference's
 * "one cell-diagonal per frame" sweep for free.
 */
export const diagonalT = (row: number, col: number): number => (row + col) / 24;

/**
 * Where a cell sits INSIDE the grid block, in px from the block's top-left.
 * Exported because anything placed on a cell from outside — a press ring, a
 * popover, a camera dolly origin — must use the same maths the grid draws with,
 * or it silently drifts the day the header ratio changes.
 */
export const cellRect = (
  size: number,
  row: number,
  col: number,
  showHeaders = true,
): {left: number; top: number; size: number} => {
  const header = showHeaders ? Math.max(10, size * 0.05) : 0;
  const cell = (size - header) / 13;
  return {left: header + col * cell, top: header + row * cell, size: cell};
};

export type RangeGridProps = {
  brand: Brand;
  mono: string;
  /** Total px width AND height of the grid block, headers included. */
  size: number;
  /** 0..1 diagonal waterfall. Ignored when `revealFrame` is supplied. */
  progress?: number;
  /** Per-cell reveal frame (shot-local). A cell paints once frame >= its value. */
  revealFrame?: (row: number, col: number) => number;
  /** Row/column rank headers around the grid. */
  showHeaders?: boolean;
  /** The product's own magenta selection state: highlights this row + column header. */
  selected?: {row: number; col: number} | null;
  /** Cell drawn with a magenta outline as the clicked cell. */
  focusCell?: {row: number; col: number} | null;
  style?: React.CSSProperties;
};

export const RangeGrid: React.FC<RangeGridProps> = ({
  brand,
  mono,
  size,
  progress = 1,
  revealFrame,
  showHeaders = true,
  selected = null,
  focusCell = null,
  style,
}) => {
  const frame = useCurrentFrame();
  const {size: cell} = cellRect(size, 0, 0, showHeaders);
  const header = showHeaders ? Math.max(10, size * 0.05) : 0;
  const label = Math.max(6, cell * 0.36);

  const resolved = (row: number, col: number): number => {
    if (revealFrame) {
      const at = revealFrame(row, col);
      return Math.min(1, Math.max(0, (frame - at) / 3));
    }
    return Math.min(1, Math.max(0, (progress - diagonalT(row, col)) * 9));
  };

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'grid',
        gridTemplateColumns: `${header}px repeat(13, ${cell}px)`,
        gridTemplateRows: `${header}px repeat(13, ${cell}px)`,
        backgroundColor: GRID_GUTTER,
        fontFamily: mono,
        ...style,
      }}
    >
      <div />
      {RANKS.map((r, c) => (
        <div
          key={`ch-${r}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: label,
            fontWeight: 500,
            color: selected && selected.col === c ? brand.colors.ink : GRID_EMPTY_INK,
            backgroundColor: selected && selected.col === c ? brand.colors.info : 'transparent',
          }}
        >
          {r}
        </div>
      ))}
      {RANKS.map((rowRank, row) => (
        <React.Fragment key={`row-${rowRank}`}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: label,
              fontWeight: 500,
              color: selected && selected.row === row ? brand.colors.ink : GRID_EMPTY_INK,
              backgroundColor: selected && selected.row === row ? brand.colors.info : 'transparent',
            }}
          >
            {rowRank}
          </div>
          {RANKS.map((_, col) => {
            const state = cellState(row, col);
            const p = resolved(row, col);
            const focused = focusCell !== null && focusCell.row === row && focusCell.col === col;
            return (
              <div
                key={`c-${row}-${col}`}
                style={{
                  margin: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: label,
                  fontWeight: 500,
                  letterSpacing: -0.2,
                  backgroundColor: p > 0 ? fillFor(brand, state) : GRID_EMPTY,
                  color: p > 0 ? inkFor(brand, state) : GRID_EMPTY_INK,
                  opacity: state === 'empty' ? 1 : 0.35 + 0.65 * p,
                  outline: focused ? `2px solid ${brand.colors.info}` : undefined,
                  outlineOffset: focused ? -2 : undefined,
                }}
              >
                {handLabel(row, col)}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
};
