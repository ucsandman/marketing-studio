// Stat and quote cards for one brand: reads out/<brand>/marketing/brief.json,
// emits one Card props JSON per proof point plus one quote card from the hook
// headline, then renders each at 1080x1080 and 1080x1350 via the Card
// composition's {formatWidth, formatHeight} props (the render-matrix pattern —
// this Remotion version has no --width/--height CLI flags).
//
// Usage: node scripts/build-cards.mjs <brand> [--brief path] [--out dir] [--dry-run]
//
// A missing brief is a clean skip (exit 0): cards are downstream of copy the
// agent synthesizes, and half the brands have no brief yet.
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SIZES = [
  {w: 1080, h: 1080},
  {w: 1080, h: 1350},
];

/**
 * Split a proof-point claim into the hero figure and the rest of the line.
 * The first number (with its unit or symbol) becomes the figure; a claim with
 * no number keeps the whole claim as the hero and drops the label, so no proof
 * point is silently lost.
 */
export const splitClaim = (claim) => {
  // \b lives INSIDE each word-shaped unit, never after the whole group: a
  // trailing \b after "%" never matches (two non-word chars are no boundary),
  // which would strand the "%" in the label.
  const match = claim.match(/\d[\d,.]*\s?(?:%|x\b|ms\b|s\b|k\b|m\b|hours?\b|minutes?\b|seconds?\b)?/i);
  if (!match) return {value: claim.trim(), label: ''};
  const value = match[0].trim();
  const label = (claim.slice(0, match.index) + claim.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return {value, label};
};

/** Every card's props for one brief, in render order: proof points, then the hook. */
export const cardsFor = (brief, brandId) => {
  const kicker = brandId;
  const cards = (brief.proofPoints ?? []).map((point, i) => {
    const {value, label} = splitClaim(point.claim);
    return {
      id: `stat-${i + 1}`,
      props: {
        brandId,
        // A claim with no figure is a sentence, not a stat: render it as a quote card so a

        // block brand does not paint the whole sentence into its accent block (postflop stat-7).

        kind: label ? 'stat' : 'quote',
        value,
        label,
        source: point.source,
        kicker,
        ctaUrl: null,
      },
    };
  });
  if (brief.hook?.headline) {
    cards.push({
      id: 'quote-hook',
      props: {
        brandId,
        kind: 'quote',
        value: brief.hook.headline,
        label: brief.positioning?.differentiator ?? '',
        source: '',
        kicker,
        ctaUrl: null,
      },
    });
  }
  return cards;
};

const main = () => {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
  };
  // Indexes consumed as flag VALUES, so they are never mistaken for the brand.
  const taken = new Set(
    ['--brief', '--out'].map((f) => args.indexOf(f)).filter((i) => i !== -1).map((i) => i + 1),
  );
  const brand = args.find((a, i) => !a.startsWith('--') && !taken.has(i));
  if (!brand) {
    console.error('usage: node scripts/build-cards.mjs <brand> [--brief path] [--out dir] [--dry-run]');
    process.exit(1);
  }
  const briefPath = flag('brief') ?? join(root, 'out', brand, 'marketing', 'brief.json');
  const outDir = flag('out') ?? join(root, 'out', brand, 'marketing', 'cards');
  const dryRun = args.includes('--dry-run');

  if (!existsSync(briefPath)) {
    console.log(`build-cards: no brief at ${briefPath}; skipping (0 cards from 0 proof points)`);
    return;
  }
  const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
  const cards = cardsFor(brief, brand);
  const proofCount = (brief.proofPoints ?? []).length;
  if (cards.length === 0) {
    console.log(`build-cards: brief has no proof points and no hook headline; 0 cards from 0 proof points`);
    return;
  }
  mkdirSync(outDir, {recursive: true});

  let rendered = 0;
  for (const card of cards) {
    const propsPath = join(outDir, `${card.id}-props.json`);
    writeFileSync(propsPath, JSON.stringify(card.props, null, 2));
    if (dryRun) continue;
    for (const size of SIZES) {
      const outFile = join(outDir, `${card.id}-${size.w}x${size.h}.png`);
      const props = {...card.props, formatWidth: size.w, formatHeight: size.h};
      const sizedPath = join(outDir, `${card.id}-${size.w}x${size.h}-props.json`);
      writeFileSync(sizedPath, JSON.stringify(props, null, 2));
      console.log(`still: ${card.id} (${size.w}x${size.h})`);
      execSync(`npx remotion still Card "${outFile}" --props="${sizedPath}"`, {
        cwd: join(root, 'studio'),
        stdio: 'inherit',
      });
      rendered += 1;
    }
  }
  const verb = dryRun ? 'props written' : 'cards rendered';
  console.log(
    `build-cards OK: ${dryRun ? cards.length : rendered} ${verb} from ${proofCount} proof points -> ${outDir}`,
  );
};

// Import-safe: main() only runs when executed directly, matching
// build-wrap-props.mjs's isMain convention.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
