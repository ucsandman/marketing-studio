import { describe, expect, it, vi } from 'vitest';
import { FacebookProvider } from '../src/providers/facebook.js';
import { LinkedInProvider, REAUTH_STEPS } from '../src/providers/linkedin.js';
import { GscProvider } from '../src/providers/gsc.js';
import { BingProvider } from '../src/providers/bing.js';
import type { Draft } from '../src/types.js';

const FB_ENV = { FB_PAGE_ID: 'page123', FB_PAGE_ACCESS_TOKEN: 'pagetok' } as NodeJS.ProcessEnv;
const LI_ENV = {
  LINKEDIN_ACCESS_TOKEN: 'litok',
  LINKEDIN_PERSON_URN: 'urn:li:person:abc',
  LINKEDIN_VERSION: '202506',
} as NodeJS.ProcessEnv;
const GSC_ENV = {
  GOOGLE_APPLICATION_CREDENTIALS: 'C:/fake/sa.json',
  GSC_SITE_URL: 'sc-domain:demoapp.io',
} as NodeJS.ProcessEnv;

const fbDraft: Draft = {
  platform: 'facebook',
  status: 'filled',
  message: 'DemoApp is live.',
  link: 'https://demoapp.io',
};

const liDraft: Draft = {
  platform: 'linkedin',
  status: 'filled',
  body: 'I built DemoApp. Link in the first comment.',
  firstComment: 'Try DemoApp: https://demoapp.io',
};

interface Recorded {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

function recordingFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body?.toString(),
      headers: init?.headers as Record<string, string> | undefined,
    });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('FacebookProvider', () => {
  it('ready() accepts a page token (me.id === FB_PAGE_ID)', async () => {
    const { fetchImpl } = recordingFetch(() => Response.json({ id: 'page123', name: 'DemoApp Page' }));
    const status = await new FacebookProvider(FB_ENV, { fetchImpl }).ready();
    expect(status.ok).toBe(true);
    expect(status.detail).toContain('LIVE mode');
  });

  it('ready() rejects a user token (me.id !== FB_PAGE_ID) with page-token instructions', async () => {
    const { fetchImpl } = recordingFetch(() => Response.json({ id: 'user999', name: 'Wes' }));
    const status = await new FacebookProvider(FB_ENV, { fetchImpl }).ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('USER token');
    expect(status.fixHint).toContain('/me/accounts');
  });

  it('posts to the page feed and returns the post URL', async () => {
    const { fetchImpl, calls } = recordingFetch(() => Response.json({ id: 'page123_456' }));
    const result = await new FacebookProvider(FB_ENV, { fetchImpl }).post(fbDraft, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://www.facebook.com/page123_456');
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v25.0/page123/feed');
    expect(calls[0]?.body).toContain('message=DemoApp+is+live.');
  });

  it('maps a 401 to an actionable auth error', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('no', { status: 401 }));
    const result = await new FacebookProvider(FB_ENV, { fetchImpl }).post(fbDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('FB_PAGE_ACCESS_TOKEN');
  });

  it('dry-run prints the payload with $FB_PAGE_ACCESS_TOKEN, never the value', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { fetchImpl, calls } = recordingFetch(() => Response.json({}));
    const result = await new FacebookProvider(FB_ENV, { fetchImpl }).post(fbDraft, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toContain('POST https://graph.facebook.com/v25.0/$FB_PAGE_ID/feed');
    expect(printed).not.toContain('page123'); // page id is an env value too — redacted
    expect(printed).toContain('%24FB_PAGE_ACCESS_TOKEN'); // url-encoded $ placeholder
    expect(printed).not.toContain('pagetok');
    log.mockRestore();
  });
});

describe('LinkedInProvider', () => {
  it('ready() reports an expired token (>60 days) with re-auth steps, no network call', async () => {
    const { fetchImpl, calls } = recordingFetch(() => Response.json({})); // must not be hit
    const env = { ...LI_ENV, LINKEDIN_TOKEN_ISSUED_AT: '2026-01-01' } as NodeJS.ProcessEnv;
    const provider = new LinkedInProvider(env, {
      fetchImpl,
      now: () => new Date('2026-06-12T00:00:00Z'),
    });
    const status = await provider.ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('EXPIRED');
    expect(status.fixHint).toContain('linkedin.com/developers/apps');
    expect(status.fixHint).toContain('LINKEDIN_TOKEN_ISSUED_AT');
    expect(calls).toHaveLength(0);
  });

  it('ready() warns when the token is older than 55 days but still valid', async () => {
    const { fetchImpl } = recordingFetch(() => Response.json({ name: 'Wes' }));
    const env = { ...LI_ENV, LINKEDIN_TOKEN_ISSUED_AT: '2026-04-15' } as NodeJS.ProcessEnv; // 58 days
    const provider = new LinkedInProvider(env, {
      fetchImpl,
      now: () => new Date('2026-06-12T00:00:00Z'),
    });
    const status = await provider.ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('days old');
    expect(status.fixHint).toBe(REAUTH_STEPS);
  });

  it('post() refuses an expired token with re-auth steps', async () => {
    const { fetchImpl, calls } = recordingFetch(() => Response.json({}));
    const env = { ...LI_ENV, LINKEDIN_TOKEN_ISSUED_AT: '2026-01-01' } as NodeJS.ProcessEnv;
    const provider = new LinkedInProvider(env, {
      fetchImpl,
      now: () => new Date('2026-06-12T00:00:00Z'),
    });
    const result = await provider.post(liDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('expired');
    expect(result.error).toContain('linkedin.com/developers/apps');
    expect(calls).toHaveLength(0);
  });

  it('posts with the pinned LinkedIn-Version header and comments the product link', async () => {
    const { fetchImpl, calls } = recordingFetch((url) => {
      if (url.endsWith('/rest/posts')) {
        return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:777' } });
      }
      return Response.json({}, { status: 201 });
    });
    const result = await new LinkedInProvider(LI_ENV, { fetchImpl }).post(liDraft, { dryRun: false });
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://www.linkedin.com/feed/update/urn:li:share:777/');
    expect(calls[0]?.headers?.['LinkedIn-Version']).toBe('202506');
    expect(calls[0]?.headers?.['X-Restli-Protocol-Version']).toBe('2.0.0');
    expect(calls[1]?.url).toContain('/rest/socialActions/');
    expect(calls[1]?.url).toContain(encodeURIComponent('urn:li:share:777'));
    expect(calls[1]?.body).toContain('https://demoapp.io');
  });

  it('maps a 401 on post to the re-auth error', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('', { status: 401 }));
    const result = await new LinkedInProvider(LI_ENV, { fetchImpl }).post(liDraft, { dryRun: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('linkedin.com/developers/apps');
  });
});

describe('GscProvider', () => {
  const deps = (handler: (url: string, init?: RequestInit) => Response) => {
    const rec = recordingFetch(handler);
    return { ...rec, tokenProvider: async () => 'gsc-token' };
  };

  it('submits the sitemap then inspects the product URL', async () => {
    const d = deps((url) => {
      if (url.includes('/sitemaps/')) return new Response('', { status: 200 });
      return Response.json({
        inspectionResult: {
          inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=x',
          indexStatusResult: { verdict: 'PASS' },
        },
      });
    });
    const provider = new GscProvider(GSC_ENV, d);
    const result = await provider.post(undefined, { dryRun: false, productUrl: 'https://demoapp.io' });
    expect(result.ok).toBe(true);
    expect(result.url).toContain('search-console/inspect');
    expect(d.calls[0]?.method).toBe('PUT');
    expect(d.calls[0]?.url).toContain(encodeURIComponent('https://demoapp.io/sitemap.xml'));
    expect(d.calls[1]?.method).toBe('POST');
    expect(d.calls[1]?.body).toContain('"inspectionUrl":"https://demoapp.io"');
  });

  it('surfaces a sitemap submit failure', async () => {
    const d = deps(() => new Response('', { status: 403 }));
    const result = await new GscProvider(GSC_ENV, d).post(undefined, { dryRun: false, productUrl: 'https://demoapp.io' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sitemap submit failed');
  });

  it('dry-run prints both requests without auth or network', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const d = deps(() => Response.json({}));
    const provider = new GscProvider(GSC_ENV, {
      fetchImpl: d.fetchImpl,
      tokenProvider: async () => {
        throw new Error('token must not be fetched in dry-run');
      },
    });
    const result = await provider.post(undefined, { dryRun: true, productUrl: 'https://demoapp.io' });
    expect(result.ok).toBe(true);
    expect(d.calls).toHaveLength(0);
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toContain('PUT https://www.googleapis.com/webmasters/v3/sites/');
    expect(printed).toContain('POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
    log.mockRestore();
  });

  it('mode() is blocked when env keys are missing', () => {
    expect(new GscProvider({} as NodeJS.ProcessEnv).mode()).toBe('blocked');
  });
});

const BING_KEY = 'bing-key-abc123';
const BING_ENV = {
  BING_WEBMASTER_API_KEY: BING_KEY,
  BING_SITE_URL: 'https://demoapp.io',
} as NodeJS.ProcessEnv;

const BING_JSON = 'https://ssl.bing.com/webmaster/api.svc/json';

/** Bing's real fault body: flat, no "d" wrapper, served as HTTP 400. */
function bingFault(message: string): Response {
  return new Response(JSON.stringify({ ErrorCode: 3, Message: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Routes each Bing operation by name; the site row drives the verified branches. */
function bingRoutes(site: { IsVerified: boolean; AuthenticationCode?: string }) {
  return (url: string): Response => {
    if (url.includes('/GetUserSites')) {
      return Response.json({
        d: [
          {
            __type: 'Site:#Microsoft.Bing.Webmaster.Api',
            AuthenticationCode: site.AuthenticationCode ?? 'CODE0123456789ABCDEF',
            IsVerified: site.IsVerified,
            Url: 'https://demoapp.io',
          },
        ],
      });
    }
    if (url.includes('/GetUrlSubmissionQuota')) {
      return Response.json({ d: { DailyQuota: 5, MonthlyQuota: 24 } });
    }
    if (url.includes('/VerifySite')) return Response.json({ d: true });
    return Response.json({ d: null });
  };
}

describe('BingProvider', () => {
  it('mode() is blocked without the key, and ready() names where the key comes from', async () => {
    const provider = new BingProvider({} as NodeJS.ProcessEnv);
    expect(provider.mode()).toBe('blocked');
    const status = await provider.ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('BING_WEBMASTER_API_KEY');
    expect(status.fixHint).toContain('API Access');
  });

  it('ready() reports a verified site', async () => {
    const { fetchImpl } = recordingFetch(bingRoutes({ IsVerified: true }));
    const status = await new BingProvider(BING_ENV, { fetchImpl }).ready();
    expect(status.ok).toBe(true);
    // The site URL is an env VALUE, so doctor output carries its $KEY name.
    expect(status.detail).toContain('$BING_SITE_URL');
  });

  it('ready() reports an unverified site with the msvalidate.01 tag to add', async () => {
    const { fetchImpl } = recordingFetch(bingRoutes({ IsVerified: false, AuthenticationCode: 'ABC123CODE' }));
    const status = await new BingProvider(BING_ENV, { fetchImpl }).ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('NOT verified');
    expect(status.fixHint).toContain('msvalidate.01');
    expect(status.fixHint).toContain('ABC123CODE');
  });

  it('ready() surfaces the API fault message on a bad key', async () => {
    const { fetchImpl } = recordingFetch(() => bingFault('ERROR!!! InvalidApiKey'));
    const status = await new BingProvider(BING_ENV, { fetchImpl }).ready();
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('HTTP 400');
    expect(status.detail).toContain('InvalidApiKey');
  });

  it('posts the exact sequence: AddSite, GetUserSites, SubmitFeed, SubmitUrlBatch, quota', async () => {
    const { fetchImpl, calls } = recordingFetch(bingRoutes({ IsVerified: true }));
    const result = await new BingProvider(BING_ENV, { fetchImpl }).post(undefined, {
      dryRun: false,
      productUrl: 'https://demoapp.io',
    });
    expect(result.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url.split('?')[0]}`)).toEqual([
      `POST ${BING_JSON}/AddSite`,
      `GET ${BING_JSON}/GetUserSites`,
      `POST ${BING_JSON}/SubmitFeed`,
      `POST ${BING_JSON}/SubmitUrlBatch`,
      `GET ${BING_JSON}/GetUrlSubmissionQuota`,
    ]);
    expect(calls[0]?.body).toBe('{"siteUrl":"https://demoapp.io"}');
    expect(calls[2]?.body).toBe('{"siteUrl":"https://demoapp.io","feedUrl":"https://demoapp.io/sitemap.xml"}');
    expect(calls[3]?.body).toBe('{"siteUrl":"https://demoapp.io","urlList":["https://demoapp.io"]}');
    expect(calls[4]?.url).toContain(`siteUrl=${encodeURIComponent('https://demoapp.io')}`);
    // Quota rides the non-fatal note field, the way GSC reports its index verdict.
    expect(result.error).toContain('5 today');
    expect(result.error).toContain('24 this month');
  });

  it('verifies an unverified site when BING_VERIFICATION_CODE is set, then submits', async () => {
    const { fetchImpl, calls } = recordingFetch(bingRoutes({ IsVerified: false }));
    const result = await new BingProvider(
      { ...BING_ENV, BING_VERIFICATION_CODE: 'CODE0123456789ABCDEF' } as NodeJS.ProcessEnv,
      { fetchImpl },
    ).post(undefined, { dryRun: false, productUrl: 'https://demoapp.io' });
    expect(result.ok).toBe(true);
    expect(calls[2]?.url).toContain('/VerifySite');
    expect(calls[2]?.body).toBe('{"siteUrl":"https://demoapp.io"}');
    expect(calls.some((c) => c.url.includes('/SubmitFeed'))).toBe(true);
  });

  it('refuses before submitting when the site is unverified and no code is set', async () => {
    const { fetchImpl, calls } = recordingFetch(bingRoutes({ IsVerified: false, AuthenticationCode: 'ABC123CODE' }));
    const result = await new BingProvider(BING_ENV, { fetchImpl }).post(undefined, {
      dryRun: false,
      productUrl: 'https://demoapp.io',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('msvalidate.01');
    expect(result.error).toContain('ABC123CODE');
    // SubmitFeed/SubmitUrlBatch reject an unverified site, so they must never be sent.
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([
      `${BING_JSON}/AddSite`,
      `${BING_JSON}/GetUserSites`,
    ]);
  });

  it('maps an API fault on submit to a failure carrying status and message', async () => {
    const routes = bingRoutes({ IsVerified: true });
    const { fetchImpl } = recordingFetch((url) =>
      url.includes('/SubmitFeed') ? bingFault('ERROR!!! NotAuthorized') : routes(url),
    );
    const result = await new BingProvider(BING_ENV, { fetchImpl }).post(undefined, {
      dryRun: false,
      productUrl: 'https://demoapp.io',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('sitemap submit failed');
    expect(result.error).toContain('HTTP 400');
    expect(result.error).toContain('NotAuthorized');
    expect(result.error).toContain('ErrorCode 3');
  });

  it('submits the product sitemap even when the Bing property is a different host', async () => {
    const { fetchImpl, calls } = recordingFetch(bingRoutes({ IsVerified: true }));
    const result = await new BingProvider(BING_ENV, { fetchImpl }).post(undefined, {
      dryRun: false,
      productUrl: 'https://www.demoapp.io/',
    });
    expect(result.ok).toBe(true);
    // siteUrl stays the registered property; the feed is the product's own sitemap —
    // the exact URL GSC submits, so the two engines never get different sitemaps.
    expect(calls[2]?.body).toBe(
      '{"siteUrl":"https://demoapp.io","feedUrl":"https://www.demoapp.io/sitemap.xml"}',
    );
    expect(calls[3]?.body).toBe('{"siteUrl":"https://demoapp.io","urlList":["https://www.demoapp.io/"]}');
  });

  it('reuses GSC_SITE_URL, rewriting an sc-domain: property to https://', async () => {
    const provider = new BingProvider({
      BING_WEBMASTER_API_KEY: BING_KEY,
      GSC_SITE_URL: 'sc-domain:demoapp.io',
    } as NodeJS.ProcessEnv);
    const previews = provider.previews('https://demoapp.io');
    expect(previews[1]?.body).toBe('{"siteUrl":"https://demoapp.io"}');
    expect(previews.some((p) => p.body?.includes('sc-domain'))).toBe(false);
  });

  it('never leaks the api key: dry-run previews and error text carry $KEY names', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dry = recordingFetch(bingRoutes({ IsVerified: true }));
    const result = await new BingProvider(BING_ENV, { fetchImpl: dry.fetchImpl }).post(undefined, {
      dryRun: true,
      productUrl: 'https://demoapp.io',
    });
    expect(result.ok).toBe(true);
    expect(dry.calls).toHaveLength(0);
    const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
    log.mockRestore();
    expect(printed).toContain(`POST ${BING_JSON}/AddSite`);
    expect(printed).not.toContain(BING_KEY);
    expect(printed).toContain('$BING_WEBMASTER_API_KEY');
    // The quota call puts the site in the query string, so its percent-encoded form
    // has to be redacted too — a raw-value-only swap leaves it readable.
    expect(printed).not.toContain(encodeURIComponent('https://demoapp.io'));
    expect(printed).toContain('siteUrl=$BING_SITE_URL');

    // Regression case: an API fault that echoes the key back must still be redacted.
    const { fetchImpl } = recordingFetch(() => bingFault(`ERROR!!! InvalidApiKey ${BING_KEY}`));
    const failed = await new BingProvider(BING_ENV, { fetchImpl }).ready();
    expect(failed.detail).not.toContain(BING_KEY);
    expect(failed.detail).toContain('$BING_WEBMASTER_API_KEY');
  });

  // The ONE network test in the suite. Mocked fetch proves the parser against a body
  // we wrote; this proves the endpoint and its fault shape are real. Reads only, with a
  // bogus key — auth fails before routing, so nothing is ever written to any account.
  it('real Bing endpoint: a bogus key returns the 400 fault the error path parses', async (ctx) => {
    const bogus = 'launch-engine-live-check-not-a-real-key';
    const status = await new BingProvider({
      BING_WEBMASTER_API_KEY: bogus,
      BING_SITE_URL: 'https://example.com',
    } as NodeJS.ProcessEnv).ready();
    if (!status.detail.includes('InvalidApiKey')) {
      console.warn(`SKIPPED (ssl.bing.com unreachable): ${status.detail}`);
      ctx.skip();
      return;
    }
    expect(status.ok).toBe(false);
    expect(status.detail).toContain('HTTP 400 on GetUserSites');
    expect(status.detail).toContain('ErrorCode 3');
    expect(status.detail).not.toContain(bogus);
  }, 30_000);
});
