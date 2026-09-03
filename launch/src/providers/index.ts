import type { Provider } from './types.js';
import { XProvider } from './x.js';
import { BlueskyProvider } from './bluesky.js';
import { YouTubeProvider } from './youtube.js';
import { RedditProvider } from './reddit.js';
import { FacebookProvider } from './facebook.js';
import { LinkedInProvider } from './linkedin.js';
import { GscProvider } from './gsc.js';
import { BingProvider } from './bing.js';
import { HackerNewsProvider } from './hackernews.js';
import { ProductHuntProvider } from './producthunt.js';

/** All posting providers, in launch order. */
export function buildProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  return [
    new XProvider(env),
    new BlueskyProvider(env),
    new FacebookProvider(env),
    new LinkedInProvider(env),
    new YouTubeProvider(env),
    new RedditProvider(env),
    new HackerNewsProvider(env),
    new ProductHuntProvider(env),
    new GscProvider(env),
    new BingProvider(env),
  ];
}
