import {loadFont as loadSaira} from '@remotion/google-fonts/Saira';
import {loadFont as loadHanken} from '@remotion/google-fonts/HankenGrotesk';
import {loadFont as loadGeistMono} from '@remotion/google-fonts/GeistMono';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadJetBrainsMono} from '@remotion/google-fonts/JetBrainsMono';
import {loadFont as loadLibreFranklin} from '@remotion/google-fonts/LibreFranklin';
import {loadFont as loadArchivo} from '@remotion/google-fonts/Archivo';
import {loadFont as loadSourceSans3} from '@remotion/google-fonts/SourceSans3';
import {loadFont as loadSourceSerif4} from '@remotion/google-fonts/SourceSerif4';
import {loadFont as loadIBMPlexSans} from '@remotion/google-fonts/IBMPlexSans';
import {loadFont as loadIBMPlexMono} from '@remotion/google-fonts/IBMPlexMono';
import type {Brand} from './brand';

// Load once at module scope; Remotion delays render until fonts resolve.
// Keyed by the family name a brand JSON may name in its `fonts` block.
const families: Record<string, string> = {
  Saira: loadSaira('normal', {weights: ['600', '800']}).fontFamily,
  'Hanken Grotesk': loadHanken('normal', {weights: ['400', '600']}).fontFamily,
  'Geist Mono': loadGeistMono('normal', {weights: ['400', '500']}).fontFamily,
  // subsets pinned: Inter otherwise fans out to 28 font requests per render
  Inter: loadInter('normal', {weights: ['400', '600', '700', '800'], subsets: ['latin']})
    .fontFamily,
  'JetBrains Mono': loadJetBrainsMono('normal', {weights: ['400', '500'], subsets: ['latin']})
    .fontFamily,
  'Libre Franklin': loadLibreFranklin('normal', {
    weights: ['400', '600', '800'],
    subsets: ['latin'],
  }).fontFamily,
  // The loader registers one discrete FontFace per weight, so an unrequested face is
  // not inert: with 500/600/700 loaded, the 11 `fontWeight: 800` sites fall back to
  // 700; add a 900 face and CSS matching jumps them to 900 (costclaw's headings
  // re-weighted and re-broke lines in 2026-09-01's review). fonts.test.ts guards it.
  Archivo: loadArchivo('normal', {weights: ['500', '600', '700'], subsets: ['latin']})
    .fontFamily,
  'Source Sans 3': loadSourceSans3('normal', {weights: ['400', '600'], subsets: ['latin']})
    .fontFamily,
  'Source Serif 4': loadSourceSerif4('normal', {weights: ['400', '600'], subsets: ['latin']})
    .fontFamily,
  // IBM Plex tops out at 700, so EndCard/LogoReveal's `fontWeight: 800` display sites
  // match 700 and stop there; loading 700 is what keeps them from falling all the way
  // back to 600. Mono needs 600 for the welcome box's bold rows and nothing heavier.
  'IBM Plex Sans': loadIBMPlexSans('normal', {
    weights: ['400', '600', '700'],
    subsets: ['latin'],
  }).fontFamily,
  'IBM Plex Mono': loadIBMPlexMono('normal', {weights: ['400', '600'], subsets: ['latin']})
    .fontFamily,
};

const resolve = (name: string): string => {
  const family = families[name];
  if (!family) {
    throw new Error(
      `No font loader registered for "${name}". Available: ${Object.keys(families).join(', ')}`,
    );
  }
  return family;
};

export const loadBrandFonts = (brand: Brand) => ({
  display: resolve(brand.fonts.display),
  body: resolve(brand.fonts.body),
  mono: resolve(brand.fonts.mono),
});
