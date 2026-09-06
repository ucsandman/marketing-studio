# Brand-driven effects and FilmGrade

Read this when: tuning brand-driven washes/fonts or FilmGrade grain and halation.

## Brand-driven effects and fonts (post-DashClaw-onboarding facts)
- Backdrop wash/glow intensities are brand-driven via the optional `effects` block in
  brands/<id>.json (brand.ts has the schema + `alphaHex` helper; defaults reproduce
  the original hardcoded values). As of the paperroute run (2026-07-10) ALL five
  templates consume it — LogoReveal, ProductDemo, LaunchVideo, SocialClip, AnimatedOG;
  no hardcoded `${brand.colors.brand}<alpha>` washes remain. A saturated brand color
  as a big radial hero-wash is a known failure mode — check the brand's stated rules
  before leaning on the default (paperroute: wash MUST be 0, One Green Rule).
- `progressTreatment` defaults to `none`, so `FloatBar` returns no UI for every brand
  except NoBan. NoBan alone opts into `cs2-wear`, where the wear-zone labels and
  brand-to-profit fill are product language rather than universal decoration.
- FeaturePanel is orientation-aware (`height > width` switches row→column), so vertical
  9:16 social clips render from the SAME SocialClip comp; no separate template. Set the
  dimensions with the optional `{formatWidth, formatHeight}` PROPS that `calculateMetadata`
  reads (Root.tsx), the same mechanism `render-matrix.mjs` uses. **There are no
  `--width`/`--height` CLI flags in Remotion 4.0.486** — this line used to prescribe them
  and they silently do nothing (found the hard way on the practicalsystems run,
  2026-08-17; the export-matrix row in the table above had it right all along).
- A vertical export is a RESPONSIVE RELAYOUT, never a crop of the 16:9 master. Full-bleeding
  16:9 footage into a 9:16 frame slices the source's own text mid-word at both edges, which
  reads as a broken render rather than as background texture. Fit-to-width with the brand
  ground filling the remainder, crop to a region containing no text, or blur/dim hard enough
  that it is unmistakably texture. On screen, text is either legible or absent; half-legible
  is the one option that is not allowed.
- Fonts are per-brand: `loadBrandFonts(brand)` keyed off brand.fonts, loaders
  registered in fonts.ts. Subset new Google Fonts loaders to 'latin' — an unsubset
  family fans out to dozens of font requests per render.

## FilmGrade — halation and grain (2026-08-17, all rendered-proof facts)
- **`backdrop-filter` DOES render in Remotion's headless Chromium.** Verified with a
  rendered LogoReveal still, not assumed. This is what makes `grade.halation`
  possible: it samples the composited content underneath, so unlike `bloom` (a fixed
  radial gradient that glows the same spot whatever the frame holds) halation blooms
  wherever the frame is *actually* bright. `contrast()` inside the filter chain acts
  as the highlight threshold — it crushes darks toward black, and screen-blending
  near-black adds nothing, so only real highlights bloom.
- Halation renders FIRST in the FilmGrade stack, before the vignette. Put it after
  and it samples the darkened edges as if they were dark content.
- **Halation is the knob that turns a comp into generic AI-glow.** Measured on noban:
  0.55 grew a pronounced halo on the wordmark that read as esports-neon — the exact
  thing noban's voice forbids. 0.22 kept the mark instrument-sharp while still
  reading as photographed. judge-motion WARNs above 0.35.
- **Grain needs no luminance mask.** The colorist rule "real grain is dense in the
  midtones, thin in shadows and highlights" is already satisfied by the
  `mixBlendMode: 'overlay'` the grain layer has always used: overlay is identity at
  both ends of the base (overlay(0,x)=0, overlay(1,x)=1) and peaks at 0.5. Adding a
  tonal mask would double-apply a curve that is already correct.
- `grade.grainSize` is the feTurbulence `baseFrequency` **at 1080p**, and FilmGrade
  scales it by frame height. feTurbulence frequency is in user-space px, so a fixed
  frequency means a fixed PIXEL feature size — i.e. finer grain as a fraction of a
  taller frame. Without the normalisation the same asset carried visibly different
  grain at 1080p and 4K. Default 0.8 is the old hardcoded value, so 1080p output is
  byte-identical.
