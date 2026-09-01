import {describe, expect, it} from 'vitest';
import {socialClipSchema} from './SocialClip';

const clip = {
  brandId: 'costclaw',
  kicker: 'k',
  headline: 'h',
  lines: ['l'],
  screenshot: null,
  cta: 'c',
  video: 'costclaw/demo.mp4',
};

describe('socialClipSchema headlineOverVideo', () => {
  it('is opt-in: a clip with footage but no flag keeps the plain headline', () => {
    // Six approved clips (costclaw, tenwords, sidetap; x + linkedin) open on footage
    // and must not grow a scrim card or a top-pinned headline. The props-side scan
    // (scripts/social-props.test.mjs) checks the actual files.
    expect(socialClipSchema.parse(clip).headlineOverVideo).toBe(false);
    expect(socialClipSchema.parse({...clip, headlineOverVideo: true}).headlineOverVideo).toBe(true);
  });
});
