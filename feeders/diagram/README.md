# Diagram feeder

Brand-colored architecture diagrams from a text spec. Compiles [D2](https://d2lang.com)
in-process (WASM, no Go binary) and rasterises the SVG with resvg.

## Install

```
cd feeders/diagram && npm install
```

## Usage

```
node feeders/diagram/render.mjs <brand> <spec.d2> [--out DIR] [--width N]
```

- `<brand>` resolves `brands/<id>.json`; the diagram takes `colors.bg` as its
  background, `colors.surface`/`colors.line`/`colors.ink` on every node, and
  `colors.brand` on every connection. D2's default theme colors the boxes but
  leaves edge strokes alone, so the feeder prepends glob rules that cover
  connections as well as shapes.
- Output defaults to `out/<brand>/marketing/diagrams/`. Each run writes
  `<name>.svg`, `<name>.png`, and a copy of `<name>.d2` so the diagram is
  regenerable from what shipped.
- `--width` (default 1600) sets the PNG width; the SVG is resolution independent.
- The run prints the node and edge counts next to the output path.

Example:

```
node feeders/diagram/render.mjs sidetap docs/diagrams/pipeline.d2 --width 1600
# diagram OK: out/sidetap/marketing/diagrams/pipeline.png (5 nodes, 4 edges, 1600px)
```

resvg does not load D2's embedded webfont, so PNG text falls back to a system
face. The SVG keeps the embedded font and is the better source for print or web.

## Tests

```
cd feeders/diagram && node --test render.test.mjs
```

No network at test time: the fixture brand JSON is written to a temp dir.

## Licence

`@d2lang/d2` and `@resvg/resvg-js` are MPL-2.0. Both are consumed unmodified,
in-process, as dependencies. No MPL-2.0 source is copied into this repo, so the
licence obligation is satisfied by leaving them unmodified in `node_modules`.
