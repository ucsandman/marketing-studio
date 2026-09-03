/**
 * Claude Code's OWN terminal palette (Tokyo Night + terracotta), adapted from the
 * `claude-code-remotion` skill by flocker.md (MIT, 2026). The `flocker` brand tint
 * is dropped; the caller supplies its own accent through the theme in ui.tsx.
 *
 * THIS IS THE ONE ALLOWED HOME FOR LITERAL HEX OUTSIDE brands/*.json. Everywhere
 * else a colour comes from a brand token, because a colour in a template is a brand
 * decision. These are not: they are a third-party product's interface, the same way
 * a capture plate of an app carries that app's colours. Repainting them in brand
 * green would make the scene stop being Claude Code, which is the whole point of it.
 *
 * A brand accent enters through the SessionTheme (server tint, success, hold), never
 * by editing a value here.
 */
export const cc = {
  bg: '#1a1b26',
  chrome: '#16161e',
  border: '#2a2b3d',
  fg: '#c0caf5',
  dim: '#565f89',
  gray: '#949494',
  rose: '#cd694a', // Claude terracotta
  hilite: '#e79475', // the highlight the thinking shimmer carries
  cyan: '#7dcfff',
  green: '#4ea96f',
  amber: '#e0af68',
  error: '#f7768e',
  result: '#8b8fa3', // the ⎿ result row
  meta: '#7d7d7d', // the elapsed / esc-to-interrupt hint
  rule: '#808080', // the composer's top and bottom rules
  mode: '#ffd700', // the ⏵⏵ auto-mode line
  userRow: '#3a3a3a',
  userCaret: '#4e4e4e',
  userText: '#ffffff',
} as const;

/** macOS traffic lights, as the reference draws them. */
export const dots = ['#ff5f57', '#febc2e', '#28c840'] as const;
