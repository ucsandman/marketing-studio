import {captionFontSize, splitDisplayLines} from './captionTiming';
import type {Format} from './layout';
import {textWidthEm} from './typography';

// Per-canvas relayout decisions for the directed LaunchVideo route. layout.ts answers
// "how big is this canvas"; typography.ts answers "how does a sentence set on it"; this
// module answers the third question the export matrix asks: WHERE does a captured plate
// sit, and how wide may a burned caption line run, once the canvas stops being 16:9.
//
// Every function here is a no-op at the picture-lock master: `landscape` returns the
// values the templates already hardcoded, so the approved 1920x1080 film cannot move.
// The PLAYBOOK rule these implement: "A vertical export is a RESPONSIVE RELAYOUT, never
// a crop of the 16:9 master... Fit-to-width with the brand ground filling the remainder
// ... On screen, text is either legible or absent."

/** A captured plate's box on the canvas, in canvas pixels. */
export type PlateStage = {left: number; top: number; width: number; height: number; scale: number};

/**
 * Height a burned caption block occupies above `safe.bottom`: the gap CaptionTrack
 * floats it by, plus a three-line box at the caption's own font size. Derived from the
 * caption's real metrics rather than a picked fraction, so a canvas that changes the
 * caption size moves this with it. Landscape reserves nothing — the master keeps its
 * full-bleed plate.
 */
export const captionReserve = (format: Format): number => {
  if (format.orientation === 'landscape') return 0;
  const fontSize = captionFontSize(format.scale, format.height);
  const padding = 2 * Math.round(20 * format.scale);
  const float = Math.round(80 * format.scale);
  return Math.round(float + 3 * fontSize * 1.25 + padding);
};

/**
 * Band kept clear above a captured plate for the shot's own title. Two lines of the
 * headline's base size, which is what `headlineLayout` sets a feature title in once the
 * canvas is narrow enough to be the binding constraint.
 */
export const titleReserve = (format: Format): number =>
  format.orientation === 'landscape' ? 0 : Math.round(2.3 * Math.max(56, 120 * format.scale));

/**
 * CONTAINED placement for a captured plate on a canvas that is not the master: the plate
 * keeps its FULL width inside the safe area, scales down to fit, and sits centred in the
 * band left between the shot's title and the burned-caption zone. The brand ground fills
 * the remainder. Never called on a landscape canvas.
 */
export const containedStage = (
  format: Format,
  source: {width: number; height: number},
  {titled = false}: {titled?: boolean} = {},
): PlateStage => {
  const width = format.width - format.safe.left - format.safe.right;
  const scale = width / source.width;
  const height = Math.round(source.height * scale);
  const bandTop = format.safe.top + (titled ? titleReserve(format) : 0);
  const bandBottom = format.height - format.safe.bottom - captionReserve(format);
  const top = Math.round(bandTop + Math.max(0, (bandBottom - bandTop - height) / 2));
  return {left: format.safe.left, top, width, height, scale};
};

/**
 * Side of the square the logo mark is drawn into. The master keeps its 500px-at-1080p
 * box; a narrow canvas takes a share of the safe width instead, because `format.scale`
 * is the SMALLER of the two axis ratios and would leave the mark at 26% of a 9:16 frame.
 */
export const markBox = (format: Format): number =>
  format.orientation === 'landscape'
    ? Math.round(500 * format.scale)
    : Math.round((format.width - format.safe.left - format.safe.right) * 0.52);

// 2% back off the measured width: the renderer's own line breaking is what actually
// decides, and a line measured to land exactly on the limit is the one that wraps.
const FIT_MARGIN = 0.98;

/**
 * Greedy word wrap against a MEASURED width, then one pull-down pass so the last line is
 * never a single orphaned word. Character-count wrapping (captionTiming's
 * `splitDisplayLines`) cannot see the box, so on a 1080-wide canvas it hands the renderer
 * a line too long to fit and the renderer orphans the last word of it.
 */
export const wrapMeasuredLines = (
  text: string,
  maxWidthPx: number,
  fontSize: number,
  fontFamily?: string,
  fontWeight = 600,
): string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  const limit = maxWidthPx * FIT_MARGIN;
  const fits = (line: string) => textWidthEm(line, fontFamily, fontWeight) * fontSize <= limit;
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (fits(candidate)) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  const last = lines[lines.length - 1];
  if (lines.length > 1 && last.split(' ').length === 1) {
    const prev = lines[lines.length - 2].split(' ');
    if (prev.length > 1) {
      const moved = prev[prev.length - 1];
      const pulled = `${moved} ${last}`;
      // Only when the shorter previous line and the widened last line both still fit;
      // otherwise the orphan is the lesser of two faults.
      if (fits(pulled)) {
        lines[lines.length - 2] = prev.slice(0, -1).join(' ');
        lines[lines.length - 1] = pulled;
      }
    }
  }
  return lines;
};

/**
 * Display lines for one burned caption cue. The master keeps `splitDisplayLines` exactly
 * (42 characters, two lines), so the approved 16:9 export cannot move; every other canvas
 * wraps on the measured box width so no line is orphaned and none overflows.
 */
export const captionDisplayLines = (
  text: string,
  format: Format,
  contentWidth: number,
  fontFamily?: string,
): string[] =>
  format.orientation === 'landscape'
    ? splitDisplayLines(text)
    : wrapMeasuredLines(text, contentWidth, captionFontSize(format.scale, format.height), fontFamily);
