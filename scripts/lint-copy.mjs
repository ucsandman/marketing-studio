#!/usr/bin/env node
// Copy voice-linter: mechanical gate that keeps AI-slop copy out of renders.
// Walks every string value in a JSON file (props, briefs, brand files, any
// shape) and flags em dashes, slop-lexicon words, breathless hype,
// mechanism-first ("feature-speak") phrasing, weak qualifiers, announcement
// openers, generic CTA labels, and (brief-shaped files only) stat claims with
// no proofPoints backing.
//
// Usage: node scripts/lint-copy.mjs <file.json> [--json] [--fix-report]
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ACRONYM_ALLOWLIST = new Set([
  'API', 'JSON', 'HTML', 'CSS', 'GPU', 'CPU', 'README', 'OG', 'CTA', 'VO', 'URL', 'SDK', 'UI', 'UX',
  'FIFO', 'MP4', 'GIF', 'PNG', 'SVG', 'SRT', 'VTT',
]);

// name: label used for grouping/reporting. re: word-boundary regex, matched case-insensitively.
const SLOP_TERMS = [
  {name: 'seamless', re: /\bseamless(ly)?\b/i},
  {name: 'elevate', re: /\belevate\b/i},
  {name: 'delve', re: /\bdelve\b/i},
  {name: 'unleash', re: /\bunleash\b/i},
  {name: 'supercharge', re: /\bsupercharge\b/i},
  {name: 'game-changing', re: /\bgame-changing\b/i},
  {name: 'revolutionize', re: /\brevolutionize\b/i},
  {name: 'cutting-edge', re: /\bcutting-edge\b/i},
  {name: 'effortless', re: /\beffortless(ly)?\b/i},
  {name: 'empower', re: /\bempower\b/i},
  {name: 'robust', re: /\brobust\b/i},
  {name: 'leverage', re: /\bleverage\b/i},
  {name: "in today's world", re: /\bin today['’]s world\b/i},
  {name: 'look no further', re: /\blook no further\b/i},
  // Buzzword additions from Corey Haines' marketingskills copywriting rules
  // (github.com/coreyhaines31/marketingskills, MIT): specific over vague,
  // simple over complex ("use" not "utilize", "help" not "facilitate").
  {name: 'streamline', re: /\bstreamlined?\b/i},
  {name: 'innovative', re: /\binnovative\b/i},
  {name: 'utilize', re: /\butiliz(e|es|ed|ing)\b/i},
  {name: 'facilitate', re: /\bfacilitat(e|es|ed|ing)\b/i},
  {name: 'best-in-class', re: /\bbest[- ]in[- ]class\b/i},
  {name: 'world-class', re: /\bworld[- ]class\b/i},
  {name: 'next-level', re: /\bnext[- ]level\b/i},
  {name: 'state-of-the-art', re: /\bstate[- ]of[- ]the[- ]art\b/i},
];

// "Confident over qualified" (same source): qualifiers that weaken copy, plus
// "optimize" which is vague-buzzword territory but too common in product copy
// to hard-fail. WARN only.
const WEAK_LANGUAGE = [
  {name: 'very', re: /\bvery\b/i},
  {name: 'really', re: /\breally\b/i},
  {name: 'almost', re: /\balmost\b/i},
  {name: 'optimize', re: /\boptimiz(e|es|ed|ing)\b/i},
];

// "We're excited to announce" openers: zero curiosity gap, scrolled past
// (launch skill virality notes + the same copywriting rules).
const ANNOUNCEMENT_OPENER =
  /^\s*(we|i)['’]?(re| am| are|m)?\s+(so\s+|very\s+|incredibly\s+)?(excited|thrilled|proud|delighted|happy|pumped|stoked)\s+to\s+(announce|share|introduce|launch|unveil)\b/i;

// Weak CTA labels (verbatim avoid-list from the copywriting skill). Checked
// only on cta-named keys; the fix is [Action Verb] + [What They Get].
const WEAK_CTAS = new Set(['submit', 'sign up', 'signup', 'learn more', 'click here', 'get started']);

// Stat-shaped claims ("58%", "3x faster", "6.5x") — only meaningful with the
// brief-level proofPoints cross-check in lintJson below.
const STAT_RE = /\b\d+(\.\d+)?\s*(%|percent\b)|\b\d+(\.\d+)?x\b/i;

const SUGGESTIONS = {
  'em-dash': 'Replace the em dash with a comma, period, or a rewritten sentence.',
  'slop-lexicon': "Cut or replace the flagged word with plain, specific language.",
  'breathless-hype': 'Drop to at most one exclamation mark and avoid all-caps emphasis.',
  'feature-speak': 'Lead with the benefit to the reader, not the mechanism.',
  'weak-language': 'Cut the qualifier; state the specific outcome instead.',
  'announcement-opener': 'Open with a hook (the surprising number, the before/after), not the announcement.',
  'weak-cta': 'Use [Action Verb] + [What They Get], e.g. "Start Free Trial", not a generic label.',
  'unsourced-stat': 'Add a proofPoints entry (claim + source) for the number, or cut it.',
};

function isSkippableKey(key) {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (['id', 'key', 'act', 'comp'].includes(lower)) return true;
  if (/Path$|Src$|File$/.test(key)) return true;
  if (/^fonts?$/i.test(key)) return true;
  return false;
}

function isPathLikeValue(str) {
  return /[\\/]/.test(str);
}

function isHexColor(str) {
  return /^#[0-9a-fA-F]{3,8}$/.test(str);
}

function isUrl(str) {
  return /^https?:\/\//i.test(str);
}

function shouldSkip(str, ownKey, containerKey) {
  if (isSkippableKey(ownKey) || isSkippableKey(containerKey)) return true;
  if (isPathLikeValue(str)) return true;
  if (isHexColor(str)) return true;
  if (isUrl(str)) return true;
  return false;
}

function lintString(str, path, ownKey, out) {
  // Rule 1: em dash.
  if (str.includes('—')) {
    out.push({
      rule: 'em-dash',
      level: 'ERROR',
      path,
      text: str,
      message: 'Contains an em dash.',
    });
  }

  // Rule 2: slop lexicon.
  for (const term of SLOP_TERMS) {
    const match = term.re.exec(str);
    if (match) {
      out.push({
        rule: 'slop-lexicon',
        level: 'ERROR',
        path,
        text: match[0],
        message: `Slop word "${term.name}" found.`,
      });
    }
  }
  const trimmed = str.trim();
  if (/^unlock\b/i.test(trimmed)) {
    out.push({
      rule: 'slop-lexicon',
      level: 'ERROR',
      path,
      text: trimmed.split(/\s+/)[0],
      message: 'Slop word "unlock" used as a verb opener.',
    });
  }

  // Rule 3: breathless hype.
  const bangCount = (str.match(/!/g) || []).length;
  if (bangCount >= 3) {
    out.push({
      rule: 'breathless-hype',
      level: 'ERROR',
      path,
      text: str,
      message: `${bangCount} exclamation marks in one string.`,
    });
  }
  const capsWords = str.match(/\b[A-Z]{4,}\b/g) || [];
  for (const word of capsWords) {
    if (ACRONYM_ALLOWLIST.has(word)) continue;
    out.push({
      rule: 'breathless-hype',
      level: 'ERROR',
      path,
      text: word,
      message: `ALL-CAPS word "${word}" is not an allowlisted acronym.`,
    });
  }

  // Rule 4: feature-speak heuristic (WARN only). Brief grounding sections are
  // descriptive facts, not rendered benefit copy — gerund openers are natural
  // there, so they are exempt from this rule (all other rules still apply).
  const inGrounding = /^(audience|customerLanguage|objections|switchingForces)\b/.test(path);
  if (trimmed.length > 30 && !inGrounding) {
    const gerundMatch = /^([A-Z][a-zA-Z]*ing)\b/.exec(trimmed);
    const opener = /^(Allows|Enables|Provides|Supports)\b/.exec(trimmed);
    if (gerundMatch || opener) {
      const word = (gerundMatch || opener)[1];
      out.push({
        rule: 'feature-speak',
        level: 'WARN',
        path,
        text: word,
        message: `Starts with mechanism-first phrasing ("${word}") instead of a benefit.`,
      });
    }
  }

  // Rule 5: weak qualifiers / vague verbs (WARN only).
  for (const term of WEAK_LANGUAGE) {
    const match = term.re.exec(str);
    if (match) {
      out.push({
        rule: 'weak-language',
        level: 'WARN',
        path,
        text: match[0],
        message: `Weak/vague word "${term.name}" qualifies instead of stating the outcome.`,
      });
    }
  }

  // Rule 6: "we're excited to announce" family of openers.
  const announce = ANNOUNCEMENT_OPENER.exec(trimmed);
  if (announce) {
    out.push({
      rule: 'announcement-opener',
      level: 'ERROR',
      path,
      text: announce[0].trim(),
      message: 'Announcement opener with no hook; the reader scrolls past it.',
    });
  }

  // Rule 7: generic CTA labels, only on cta-named keys.
  if (ownKey && /cta$/i.test(ownKey) && WEAK_CTAS.has(trimmed.toLowerCase())) {
    out.push({
      rule: 'weak-cta',
      level: 'WARN',
      path,
      text: trimmed,
      message: `Generic CTA "${trimmed}" says what to do, not what they get.`,
    });
  }
}

function walk(node, path, ownKey, containerKey, out) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, ownKey, containerKey, out));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      walk(v, path ? `${path}.${k}` : k, k, ownKey, out);
    }
    return;
  }
  if (typeof node === 'string') {
    if (shouldSkip(node, ownKey, containerKey)) return;
    lintString(node, path, ownKey, out);
  }
}

// Brief-level cross-check: a brief-shaped document (brandId + hook) whose copy
// cites stat-shaped claims must carry at least one proofPoints entry — an
// unsourced number is fabrication risk, not a style choice. With proofPoints
// present, claim-to-source fidelity stays a storyboard-approval judgment.
function lintUnsourcedStats(root, out) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return;
  if (typeof root.brandId !== 'string' || root.hook == null) return;
  if (Array.isArray(root.proofPoints) && root.proofPoints.length > 0) return;
  const statHits = [];
  const collect = (node, path, ownKey, containerKey) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => collect(item, `${path}[${i}]`, ownKey, containerKey));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        collect(v, path ? `${path}.${k}` : k, k, ownKey);
      }
      return;
    }
    if (typeof node === 'string' && !shouldSkip(node, ownKey, containerKey)) {
      const m = STAT_RE.exec(node);
      if (m) statHits.push({path, text: m[0]});
    }
  };
  collect(root, '', null, null);
  for (const hit of statHits) {
    out.push({
      rule: 'unsourced-stat',
      level: 'WARN',
      path: hit.path,
      text: hit.text,
      message: `Stat-shaped claim "${hit.text}" with no proofPoints entry in the brief.`,
    });
  }
}

export function lintJson(root) {
  const violations = [];
  walk(root, '', null, null, violations);
  lintUnsourcedStats(root, violations);
  return violations;
}

function groupByRule(violations) {
  const groups = new Map();
  for (const v of violations) {
    if (!groups.has(v.rule)) groups.set(v.rule, []);
    groups.get(v.rule).push(v);
  }
  return groups;
}

export function formatReport(file, violations, {fixReport = false} = {}) {
  if (violations.length === 0) {
    return `lint-copy: ${file}: clean, no violations.`;
  }
  const lines = [`lint-copy: ${file}: ${violations.length} violation(s)`];
  const groups = groupByRule(violations);
  for (const [rule, items] of groups) {
    lines.push('');
    lines.push(`${rule} (${items.length}):`);
    for (const v of items) {
      lines.push(`  [${v.level}] ${v.path}: "${v.text}" - ${v.message}`);
      if (fixReport) {
        lines.push(`    fix: ${SUGGESTIONS[v.rule] || 'Review and rewrite.'}`);
      }
    }
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  const file = positional[0];

  if (!file) {
    console.error('Usage: node scripts/lint-copy.mjs <file.json> [--json] [--fix-report]');
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`lint-copy: failed to read ${file}: ${err.message}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`lint-copy: failed to parse ${file} as JSON: ${err.message}`);
    process.exit(1);
  }

  const violations = lintJson(data);
  const errorCount = violations.filter((v) => v.level === 'ERROR').length;
  const warnCount = violations.filter((v) => v.level === 'WARN').length;

  if (flags.has('--json')) {
    console.log(JSON.stringify({file, violations, errorCount, warnCount}, null, 2));
  } else {
    console.log(formatReport(file, violations, {fixReport: flags.has('--fix-report')}));
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
