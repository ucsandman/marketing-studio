// Pure ANSI -> HTML replay page builder for the CostClaw terminal report.
//
// CostClaw is a CLI product, so its "app screen" is a terminal report. Scraping a
// live console window is not reproducible, so instead we take the REAL ANSI bytes
// the product's formatAudit() emits (captured by costclaw-audit-evidence.mts) and
// replay them in a page: the command types itself, then the real output streams in.
//
// Palette rule: every color here is a PRODUCT value, not an invented one.
//   - the paper/ink/umber/clay/muted tokens are the audit HTML report's own CSS
//     variables (apps/cli/src/html-report.ts STYLE)
//   - the score-band colors are apps/cli/src/svg.ts bandColorForScore, which the
//     product's 256-color ANSI codes are themselves approximations of
// The brand rule (clay is graphic-only, colored TEXT is umber) is honored the same
// way the product's own HTML report honors it: bar glyphs carry the band color,
// prose and numbers carry umber.

/** The audit report's own palette (html-report.ts :root). */
export const PALETTE = {
  ink: '#251d1a',
  paper: '#fefaf7',
  card: '#fffdfb',
  umber: '#822d1d',
  clay: '#e07a5f',
  line: '#f0e2da',
  body: '#5a4a43',
  muted: '#6f5f58',
  // The unfilled part of a score bar. html-report.ts's own track tints
  // (--track, .p-na) wash out to white under the demo stage's brightness(1.12)
  // grade, so this uses the report's other product tint at that weight: the
  // .fix.other border. Same palette, still legible after the grade.
  track: '#cbb8ae',
  mono:
    'ui-monospace, SFMono-Regular, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

/** svg.ts bandColorForScore, keyed by the 256-color code ansi.ts approximates it with. */
export const BAND_BY_CODE = {
  160: '#c0392b', // burning tokens
  173: '#e07a5f', // leaky
  178: '#d99a2b', // solid
  71: '#5f8f4f', // tight
  29: '#3f7d4e', // dialed in
};

const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Applies one SGR parameter list to a style state (mutates and returns it). */
function applySgr(state, params) {
  const ps = params === '' ? [0] : params.split(';').map(Number);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p === 38 && ps[i + 1] === 5) {
      state.fg = ps[i + 2] ?? null;
      i += 2;
    } else if (p === 0) {
      state.bold = false;
      state.dim = false;
      state.fg = null;
    } else if (p === 1) state.bold = true;
    else if (p === 2) state.dim = true;
    else if (p === 22) {
      state.bold = false;
      state.dim = false;
    } else if (p === 39) state.fg = null;
  }
  return state;
}

const FILLED_BAR = /^#+$/;
const EMPTY_BAR = /^\.+$/;

/**
 * The color a run of text takes. Bar glyphs are graphic, so they keep the band
 * color; anything readable resolves to ink / muted / umber.
 */
function runStyle(text, state) {
  if (FILLED_BAR.test(text)) {
    return {color: state.fg != null ? (BAND_BY_CODE[state.fg] ?? PALETTE.clay) : PALETTE.clay, bold: false};
  }
  if (EMPTY_BAR.test(text)) return {color: PALETTE.track, bold: false};
  if (state.fg != null) return {color: PALETTE.umber, bold: true};
  if (state.dim) return {color: PALETTE.muted, bold: false};
  return {color: PALETTE.ink, bold: state.bold};
}

/** One ANSI line -> HTML spans. Style state carries across lines, as in a terminal. */
export function ansiLineToHtml(line, state) {
  let html = '';
  let last = 0;
  SGR.lastIndex = 0;
  let m;
  const emit = (text) => {
    if (text === '') return;
    const {color, bold} = runStyle(text, state);
    const weight = bold ? ';font-weight:700' : '';
    html += `<span style="color:${color}${weight}">${escapeHtml(text)}</span>`;
  };
  while ((m = SGR.exec(line)) !== null) {
    emit(line.slice(last, m.index));
    applySgr(state, m[1]);
    last = m.index + m[0].length;
  }
  emit(line.slice(last));
  return html;
}

/** Splits an ANSI report into lines, dropping a single trailing newline. */
export function toLines(ansiText) {
  const lines = ansiText.replace(/\r/g, '').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const stripAnsi = (s) => s.replace(SGR, '');

/**
 * Resolves {id, start, end} line ranges from content markers, so the camera's
 * focus groups track the report's real sections instead of hardcoded indexes.
 * `endBefore` is the marker of the NEXT section; trailing blank lines are trimmed.
 * Throws when a marker is missing (a report shape change must fail loudly).
 */
export function resolveGroups(lines, specs) {
  const plain = lines.map(stripAnsi);
  return specs.map(({id, start, endBefore}) => {
    const s = plain.findIndex((l) => l.includes(start));
    if (s < 0) throw new Error(`replay group ${id}: start marker not found: ${start}`);
    const after = plain.findIndex((l, i) => i > s && l.includes(endBefore));
    if (after < 0) throw new Error(`replay group ${id}: endBefore marker not found: ${endBefore}`);
    let e = after - 1;
    while (e > s && plain[e].trim() === '') e--;
    return {id, start: s, end: e};
  });
}

/**
 * The self-contained replay page. No network, no fonts to fetch, no OS chrome
 * beyond one titlebar strip. `groups` come from resolveGroups; each becomes a
 * shrink-to-fit wrapper the capture script measures a focus rect from.
 */
export function replayHtml({ansiText, groups, command, typeMs, lineMs, blankMs}) {
  const lines = toLines(ansiText);
  const state = {bold: false, dim: false, fg: null};
  const rendered = lines.map((l) => {
    const html = ansiLineToHtml(l, state);
    const blank = stripAnsi(l).trim() === '';
    return `<div class="ln"${blank ? ' data-blank="1"' : ''}>${blank ? '&nbsp;' : html}</div>`;
  });

  const opens = new Map(groups.map((g) => [g.start, g.id]));
  const closes = new Set(groups.map((g) => g.end));
  let out = '';
  rendered.forEach((html, i) => {
    if (opens.has(i)) out += `<div class="grp" id="${opens.get(i)}">`;
    out += html;
    if (closes.has(i)) out += '</div>';
  });

  const p = PALETTE;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>costclaw audit</title><style>
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: ${p.paper}; color: ${p.ink}; font-family: ${p.sans};
  display: flex; align-items: center; justify-content: center;
  -webkit-font-smoothing: antialiased;
}
.term {
  width: 1060px; background: ${p.card}; border: 1px solid ${p.line};
  border-radius: 14px; box-shadow: 0 10px 34px rgba(130, 45, 29, 0.07); overflow: hidden;
}
.bar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 18px; border-bottom: 1px solid ${p.line};
}
.mk { width: 28px; height: 3px; border-radius: 2px; background: ${p.clay}; }
.bar .t { font-family: ${p.mono}; font-size: 12.5px; color: ${p.muted}; letter-spacing: 0.02em; }
.body {
  height: 700px; padding: 20px 24px; overflow: hidden;
  font-family: ${p.mono}; font-size: 14.5px; line-height: 1.55;
  font-variant-numeric: tabular-nums;
}
.cmd { white-space: pre; color: ${p.ink}; margin-bottom: 6px; }
/* umber, not clay: clay is graphic-only and never carries a glyph */
.cmd .pr { color: ${p.umber}; font-weight: 700; }
.caret { display: inline-block; width: 8px; height: 1em; background: ${p.ink}; vertical-align: -0.15em; }
.ln { white-space: pre; display: none; }
.grp { width: fit-content; }
</style></head><body>
<div class="term">
  <div class="bar"><span class="mk"></span><span class="t">costclaw audit</span></div>
  <div class="body" id="body">
    <div class="cmd"><span class="pr">$</span> <span id="typed"></span><span class="caret" id="caret"></span></div>
    <div id="out">${out}</div>
  </div>
</div>
<script>
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const typed = document.getElementById('typed');
  const body = document.getElementById('body');
  await sleep(500);
  for (const ch of ${JSON.stringify(command)}) { typed.textContent += ch; await sleep(${typeMs}); }
  await sleep(380);
  document.getElementById('caret').style.display = 'none';
  for (const ln of document.querySelectorAll('.ln')) {
    ln.style.display = 'block';
    body.scrollTop = body.scrollHeight;
    await sleep(ln.dataset.blank === '1' ? ${blankMs} : ${lineMs});
  }
  window.__replayDone = true;
})();
</script>
</body></html>
`;
}
