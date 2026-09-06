// Stat and quote cards for one brand: reads its product-owned brief.json,
// emits one Card props JSON per proof point plus one quote card from the hook
// headline, then renders each at 1080x1080 and 1080x1350 via the Card
// composition's {formatWidth, formatHeight} props (the render-matrix pattern —
// this Remotion version has no --width/--height CLI flags).
//
// Usage: node scripts/build-cards.mjs <brand> --project <repo> [--brief path] [--out dir] [--dry-run] [--skip-figureless]
//
// A missing brief is a clean skip (exit 0): cards are downstream of copy the
// agent synthesizes, and half the brands have no brief yet.
//
// --skip-figureless (default off, so existing brands render unchanged): a proof
// point whose claim carries no figure is engineering-grounding prose, not a
// marketing stat or quote, so it is dropped rather than rendered as a quote card.
import {readFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');
// Same remotionCli + process.execPath pattern as render-matrix.mjs / lib/takes.mjs:
// spawning npx(.cmd) directly with execFileSync throws EINVAL on current Node
// (the Windows shell-file spawn hardening requires shell:true for .cmd/.bat,
// and this repo's contract test forbids that flag), so every other renderer
// invokes the resolved remotion-cli.js entry point instead.
const remotionCli = join(studio, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');

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

/**
 * Brand name for the sanitized-source line, read straight from `brands/<id>.json`
 * (never a literal in this script) and falling back to the brand id capitalised
 * when the file is missing or carries no `name`.
 */
const brandDisplayName = (brandId) => {
  const brandPath = join(root, 'brands', `${brandId}.json`);
  if (existsSync(brandPath)) {
    try {
      const {name} = JSON.parse(readFileSync(brandPath, 'utf8'));
      if (typeof name === 'string' && name) return name;
    } catch {
      // Malformed brands/<id>.json is not authority to crash card rendering;
      // fall back to the capitalised id below.
    }
  }
  return brandId.charAt(0).toUpperCase() + brandId.slice(1);
};

/**
 * Whether a source citation reads as engineering grounding rather than a plain
 * human citation ("measured, iPhone 15"): a file path, a drive letter, a
 * line-number reference, a code identifier in parentheses, or a README
 * reference. Any of those is fine as an internal receipt but must never reach
 * a public card, so `displaySource` below swaps it for a sanitized line.
 */
const looksLikeCodeCitation = (source) =>
  /[A-Za-z]:[\\/]/.test(source) || // drive-letter absolute path (C:/Projects/...)
  /(?:^|[\s(])(?:\.{1,2}\/)?[\w-]+\/[\w./-]*\.\w+/.test(source) || // repo-relative file path (src/lib/foo.ts)
  /\blines?\s*\d/i.test(source) || // line-number reference ("line 13", "lines 85-119")
  /\([^()]*(?:[a-z][A-Z]|\.[a-zA-Z_])[^()]*\)/.test(source) || // code identifier in parens (offerWindows, tx.appointment.create)
  /\bREADME\b/i.test(source); // README reference

/**
 * A card footer must never print a path or code citation (Wes's non-negotiable:
 * no local file paths in public or client-facing material). A plain human
 * citation passes through unchanged; anything that reads as engineering
 * grounding is replaced with an unspecific, brand-scoped attestation.
 */
export const displaySource = (source, brandName) =>
  source && looksLikeCodeCitation(source) ? `Verified in the ${brandName} source` : source;

/** Every card's props for one brief, in render order: proof points, then the hook. */
export const cardsFor = (brief, brandId, {skipFigureless = false} = {}) => {
  const kicker = brandId;
  const cards = (brief.proofPoints ?? [])
    .map((point, i) => ({i, point, ...splitClaim(point.claim)}))
    // A figureless proof point is engineering-grounding prose, not a marketing
    // card, when the caller opts in; every existing brand keeps rendering it
    // as a quote card (skipFigureless defaults to false).
    .filter(({label}) => !skipFigureless || Boolean(label))
    .map(({i, point, value, label}) => ({
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
    }));
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
    ['--brief', '--out', '--project'].map((f) => args.indexOf(f)).filter((i) => i !== -1).map((i) => i + 1),
  );
  const brand = args.find((a, i) => !a.startsWith('--') && !taken.has(i));
  if (!brand) {
    console.error('usage: node scripts/build-cards.mjs <brand> --project <repo> [--brief path] [--out dir] [--dry-run] [--skip-figureless]');
    process.exit(1);
  }
  const workspace = resolveWorkspace(root, {brand, project: projectArg(args)});
  const briefPath = flag('brief') ? resolveWorkspacePath(workspace, flag('brief')) : join(workspace.marketingDir, 'brief.json');
  const outDir = flag('out') ? resolveWorkspacePath(workspace, flag('out')) : join(workspace.marketingDir, 'cards');
  const dryRun = args.includes('--dry-run');
  const skipFigureless = args.includes('--skip-figureless');

  if (!existsSync(briefPath)) {
    console.log(`build-cards: no brief at ${briefPath}; skipping (0 cards from 0 proof points)`);
    return;
  }
  const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
  const brandLabel = brandDisplayName(brand);
  const proofPoints = brief.proofPoints ?? [];
  if (skipFigureless) {
    const skipped = proofPoints.filter((point) => !splitClaim(point.claim).label).length;
    console.log(`build-cards: skipped ${skipped} figureless proof points`);
  }
  // Every card's source is routed through displaySource here, once, so no
  // caller of cardsFor can forget it and no path/citation reaches a footer.
  const cards = cardsFor(brief, brand, {skipFigureless}).map((card) => ({
    ...card,
    props: {...card.props, source: displaySource(card.props.source, brandLabel)},
  }));
  const proofCount = proofPoints.length;
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
      execFileSync(process.execPath, [remotionCli, 'still', 'Card', outFile, `--props=${sizedPath}`, `--public-dir=${workspace.publicDir}`], {
        cwd: studio,
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
