import type { Platform } from '../types.js';

export interface PlatformKnowledge {
  platform: Platform;
  /** Month the static facts were researched — always pair with a same-day live fetch. */
  asOf: string;
  strategy: 'api' | 'assist' | 'api-readonly' | 'payload';
  hardRules: string[];
  costs: string[];
  timing: string[];
  format: string[];
  banRisks: string[];
}

const AS_OF = '2026-06';

/**
 * Static 2026 platform knowledge (THINKING.md research matrix).
 * This is the floor, not the ceiling: `launch research` layers live fetches on top,
 * and the /launch skill adds same-day WebSearch synthesis into `## Session research`.
 */
export const KNOWLEDGE: Record<Platform, PlatformKnowledge> = {
  x: {
    platform: 'x',
    asOf: AS_OF,
    strategy: 'api',
    hardRules: [
      'Max 280 characters per post.',
      'Product URL goes in a reply post, never the first post (URL posts cost 13x more and rank worse).',
    ],
    costs: [
      'Pay-per-use since Feb 2026: $0.015 per text post, $0.20 per post containing a URL.',
      'No free API tier for new developers.',
    ],
    timing: ['Weekday mornings in the target audience timezone; thread hook decides the first hour.'],
    format: [
      'Thread: strong hook first post, value posts middle, product link in a reply.',
      'OAuth 1.0a user context (4 keys) via twitter-api-v2.',
    ],
    banRisks: ['Low via official API; aggressive automation outside the API risks suspension.'],
  },
  bluesky: {
    platform: 'bluesky',
    asOf: AS_OF,
    strategy: 'api',
    hardRules: [
      'Max 300 graphemes per post (an emoji with a skin tone counts as one).',
      'Links are only tappable when a richtext facet marks them, with UTF-8 BYTE offsets.',
      'Video max 100 MB, uploaded through video.bsky.app and processed asynchronously.',
      'Authenticate with an app password (Settings > App passwords), never the account password.',
    ],
    costs: ['Free: the AT Protocol write API is open, no partner review, no per-post fee.'],
    timing: ['Same weekday-morning window as X; the audience overlaps heavily.'],
    format: [
      'Single post with an app.bsky.embed.video embed; no threads needed for a launch.',
      'createSession > getServiceAuth > app.bsky.video.uploadVideo (poll the job) > com.atproto.repo.createRecord.',
    ],
    banRisks: ['Low; app passwords are revocable per-app and rate limits are generous.'],
  },
  facebook: {
    platform: 'facebook',
    asOf: AS_OF,
    strategy: 'api',
    hardRules: [
      'Post with a PAGE access token, not a user token.',
      'The Facebook app must be in LIVE mode — Dev-mode posts are invisible to the public.',
    ],
    costs: ['Free (Graph API v25 page publishing).'],
    timing: ['Midweek daytime posts perform best for page reach.'],
    format: ['Page feed post: message + link; native text outperforms bare links.'],
    banRisks: ['No ban risk via Graph API; the silent Dev-mode invisibility is the real trap.'],
  },
  linkedin: {
    platform: 'linkedin',
    asOf: AS_OF,
    strategy: 'api',
    hardRules: [
      'Product link goes in the FIRST COMMENT, not the post body (~18.8% reach penalty for body links).',
      'Pin the LinkedIn-Version header on every /rest/posts call.',
    ],
    costs: ['Free (w_member_social member posting).'],
    timing: [
      'First 90 minutes of engagement decide total reach — post when your network is online (Tue–Thu mornings).',
    ],
    format: ['Personal post (company-page API approval takes weeks — assisted draft instead).'],
    banRisks: [
      '60-day access-token expiry with NO programmatic refresh — detect and prompt re-auth before launch day.',
    ],
  },
  youtube: {
    platform: 'youtube',
    asOf: AS_OF,
    strategy: 'api',
    hardRules: [
      'Title max 100 characters, and "<" / ">" are rejected outright.',
      'Description max 5000 characters.',
      'OAuth 2.0 user consent with the youtube.upload scope; a service account cannot own an upload.',
      'Synthetic or altered footage must carry the "Altered or synthetic content" disclosure.',
    ],
    costs: ['Free, but videos.insert costs 1600 quota units against the default 10,000/day (about 6 uploads a day).'],
    timing: ['Upload PRIVATE first, watch the processed file once, then flip visibility by hand.'],
    format: ['Resumable upload: POST the snippet+status session, PUT the bytes, get the video id.'],
    banRisks: ['Undisclosed AI footage and reused/duplicate uploads are the strike risks, not the API itself.'],
  },
  reddit: {
    platform: 'reddit',
    asOf: AS_OF,
    strategy: 'api',
    hardRules: [
      "Fetch each subreddit's rules.json live on launch day before submitting.",
      'Customize title/body per subreddit; identical cross-posts read as spam.',
      'Stagger submissions across subs (hours apart, not minutes).',
    ],
    costs: ['Free (script app, password grant, 1h tokens).'],
    timing: ['Weekday mornings US time; check each sub\'s top posts for its own rhythm.'],
    format: [
      'Target maker-friendly subs first: r/SideProject, r/AlphaAndBetaUsers, r/IMadeThis.',
      'Descriptive User-Agent required on every request.',
    ],
    banRisks: ['Cross-post spam = ban; new/low-karma accounts get filtered — use an aged account.'],
  },
  hackernews: {
    platform: 'hackernews',
    asOf: AS_OF,
    strategy: 'assist',
    hardRules: [
      'Show HN title must start with "Show HN:".',
      'Link submissions are URL-only — no text body alongside a URL.',
      'The product must be tryable RIGHT NOW (no signup-walls-only, no "coming soon").',
      'Post a maker comment immediately after submitting (context, stack, asks).',
    ],
    costs: ['Free.'],
    timing: ['Tue–Thu, 9:00–12:00 ET — enough weekday traffic, less front-page competition than Monday.'],
    format: ['No write API: engine generates a prefilled submitlink URL and copies the maker comment.'],
    banRisks: ['Automation and voting rings = ban; assisted one-click submit is the safe ceiling.'],
  },
  producthunt: {
    platform: 'producthunt',
    asOf: AS_OF,
    strategy: 'assist',
    hardRules: [
      'Tagline max 60 characters.',
      'No create-post API exists, ever — launch kit + manual submit is the only path.',
      'First comment from the maker must be ready at launch moment.',
    ],
    costs: ['Free; read-only GraphQL API (developer token) for stats polling.'],
    timing: [
      'Launch at 12:01 AM PT to get the full 24h voting window; pick a low-competition day via hunted.space (often Thu).',
    ],
    format: ['Full kit: tagline, description, topics, gallery checklist, first comment, schedule.'],
    banRisks: ['Vote manipulation / fake accounts = delisting; never solicit votes directly.'],
  },
  google: {
    platform: 'google',
    asOf: AS_OF,
    strategy: 'api',
    hardRules: [
      'Service-account credentials; the account must be added as a Search Console property user.',
      'Google Business Profile is OUT OF SCOPE v1 — 60-day profile age gate makes it structurally impossible for new products.',
    ],
    costs: ['Free (Search Console API).'],
    timing: ['Submit sitemap the moment the domain serves; URL Inspection to confirm indexability.'],
    format: ['Sitemap submission + URL Inspection index-status check.'],
    banRisks: ['None notable for GSC.'],
  },
  'email-sms': {
    platform: 'email-sms',
    asOf: AS_OF,
    strategy: 'payload',
    hardRules: [
      'Every email must contain an unsubscribe link.',
      'Email subject ≤ 78 characters.',
      'SMS ≤ 160 GSM-7 characters.',
      'Only contacts with consent: true may be messaged — hard rule, no exceptions.',
    ],
    costs: ['Resend per-email and Twilio per-SMS pricing (DashClaw holds the credentials).'],
    timing: ['Launch morning, recipient-local working hours.'],
    format: ['HTML + plaintext email pair and a single SMS; CLI renders payloads, DashClaw sends.'],
    banRisks: ['Spam complaints sink sender reputation; consent and unsubscribe are non-negotiable.'],
  },
};
