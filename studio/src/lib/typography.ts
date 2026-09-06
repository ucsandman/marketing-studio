import type {Format} from './layout';

export type HeadlineTreatment = 'editorial' | 'precision' | 'playful';

export type HeadlineLayout = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  letterSpacing: string;
  maxWidth: number;
  textAlign: 'left' | 'center';
  maskLines: boolean;
  wordGap: number;
  contentWidth: number;
};

const PROFILE: Record<HeadlineTreatment, Pick<HeadlineLayout, 'lineHeight' | 'letterSpacing' | 'textAlign' | 'maskLines'>> = {
  editorial: {lineHeight: 0.98, letterSpacing: '-0.035em', textAlign: 'center', maskLines: true},
  precision: {lineHeight: 1.04, letterSpacing: '0.012em', textAlign: 'left', maskLines: false},
  playful: {lineHeight: 1, letterSpacing: '-0.018em', textAlign: 'center', maskLines: false},
};

const fallbackWidthEm = (text: string): number =>
  [...text].reduce((sum, char) => {
    if (char === ' ') return sum + 0.28;
    if (/[ilI1|.,'`:;]/.test(char)) return sum + 0.3;
    if (/[mwMW@%&#]/.test(char)) return sum + 0.9;
    if (/[A-Z0-9]/.test(char)) return sum + 0.64;
    return sum + 0.54;
  }, 0);

/** Uses the renderer's loaded face when a canvas is available; tests get a conservative fallback. */
export const textWidthEm = (text: string, fontFamily = 'sans-serif', fontWeight = 800): number => {
  if (typeof document === 'undefined') return fallbackWidthEm(text);
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return fallbackWidthEm(text);
  context.font = `${fontWeight} 100px ${fontFamily}`;
  return context.measureText(text).width / 100;
};

const trackedWidthEm = (text: string, trackingEm: number, fontFamily?: string): number =>
  Math.max(0.1, textWidthEm(text, fontFamily) + Math.max(0, [...text].length - 1) * trackingEm);

const balancedParagraph = (
  text: string,
  widthPx: number,
  baseSize: number,
  wordGap: number,
  trackingEm: number,
  maxLines: number,
  fontFamily?: string,
): string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  const prefix = [0];
  for (const word of words) {
    prefix.push(prefix[prefix.length - 1] + trackedWidthEm(word, trackingEm, fontFamily));
  }
  const lineWidth = (from: number, to: number) =>
    (prefix[to] - prefix[from]) * baseSize + (to - from - 1) * wordGap;
  let best: {score: number; lines: string[]} | null = null;
  for (let lineCount = 1; lineCount <= Math.min(maxLines, words.length); lineCount++) {
    const dp = Array.from({length: lineCount + 1}, () =>
      Array.from({length: words.length + 1}, () => ({score: Infinity, breaks: [] as number[]})),
    );
    dp[0][0] = {score: 0, breaks: []};
    for (let line = 1; line <= lineCount; line++) {
      for (let end = line; end <= words.length; end++) {
        for (let start = line - 1; start < end; start++) {
          const prev = dp[line - 1][start];
          if (!Number.isFinite(prev.score)) continue;
          const used = lineWidth(start, end);
          const overflow = Math.max(0, used - widthPx) / widthPx;
          const rag = Math.max(0, widthPx - used) / widthPx;
          const last = line === lineCount;
          const orphan = last && end - start === 1 && words.length > 2 ? 1.8 : 0;
          const score = prev.score + overflow * overflow * 60 + (last ? rag * rag * 0.3 : rag * rag) + orphan;
          if (score < dp[line][end].score) {
            dp[line][end] = {score, breaks: [...prev.breaks, end]};
          }
        }
      }
    }
    const solved = dp[lineCount][words.length];
    if (!Number.isFinite(solved.score)) continue;
    const lines: string[] = [];
    let start = 0;
    for (const end of solved.breaks) {
      lines.push(words.slice(start, end).join(' '));
      start = end;
    }
    // Prefer the fewest lines that fit; overflow dominates this small cadence cost.
    const score = solved.score + lineCount * 0.045;
    if (!best || score < best.score) best = {score, lines};
  }
  return best?.lines ?? [text];
};

/**
 * Intentional, deterministic headline composition. Explicit newlines are hard
 * breaks. Automatic lines are balanced and avoid one-word orphans when possible.
 */
export const headlineLayout = (
  text: string,
  format: Format,
  treatment: HeadlineTreatment = 'editorial',
  topAlign = false,
  fontFamily?: string,
  scrim = false,
): HeadlineLayout => {
  const maxWidth = Math.min(topAlign ? 1900 : 1500, format.width - format.safe.left - format.safe.right);
  const contentWidth = Math.max(1, maxWidth - (scrim ? Math.round(72 * format.scale) : 0));
  const baseSize = Math.max(56, Math.round(120 * format.scale));
  const wordGap = Math.round(28 * format.scale);
  const profile = PROFILE[treatment];
  const trackingEm = Number.parseFloat(profile.letterSpacing);
  const maxLines = format.orientation === 'portrait' ? 5 : format.orientation === 'square' ? 4 : 3;
  const paragraphs = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const lines = paragraphs.flatMap((part) =>
    balancedParagraph(part, contentWidth, baseSize, wordGap, trackingEm, maxLines, fontFamily),
  );
  const fittedSizes = lines.map((line) => {
    const words = line.split(/\s+/);
    const glyphWidth = words.reduce(
      (sum, word) => sum + trackedWidthEm(word, trackingEm, fontFamily),
      0,
    );
    return Math.floor((contentWidth - (words.length - 1) * wordGap) / Math.max(0.1, glyphWidth));
  });
  // There is deliberately no readability-breaking hard floor: even an authored
  // unbroken product name must stay inside title-safe instead of being clipped.
  const fontSize = Math.max(1, Math.min(baseSize, ...fittedSizes));
  return {lines, fontSize, maxWidth, contentWidth, wordGap, ...profile};
};

export const headlineLineWidth = (
  line: string,
  layout: HeadlineLayout,
  fontFamily?: string,
): number => {
  const trackingEm = Number.parseFloat(layout.letterSpacing);
  const words = line.split(/\s+/).filter(Boolean);
  return (
    words.reduce((sum, word) => sum + trackedWidthEm(word, trackingEm, fontFamily), 0) *
      layout.fontSize +
    Math.max(0, words.length - 1) * layout.wordGap
  );
};
