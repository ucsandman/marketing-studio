import {loadFont as loadSaira} from '@remotion/google-fonts/Saira';
import {loadFont as loadHanken} from '@remotion/google-fonts/HankenGrotesk';
import {loadFont as loadGeistMono} from '@remotion/google-fonts/GeistMono';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadJetBrainsMono} from '@remotion/google-fonts/JetBrainsMono';
import {loadFont as loadLibreFranklin} from '@remotion/google-fonts/LibreFranklin';
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
