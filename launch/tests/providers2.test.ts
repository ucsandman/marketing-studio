import { describe, expect, it, vi } from 'vitest';
import { FacebookProvider } from '../src/providers/facebook.js';
import { LinkedInProvider, REAUTH_STEPS } from '../src/providers/linkedin.js';
import { GscProvider } from '../src/providers/gsc.js';
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
