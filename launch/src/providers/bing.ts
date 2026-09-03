import type { Draft, PostResult } from '../types.js';
import {
  emitPreview,
  redactEnvValues,
  type PostOptions,
  type Provider,
  type ProviderStatus,
  type RequestPreview,
} from './types.js';

/** Only the key gates the provider: the site URL falls back to GSC's, then to launch.config.json. */
const REQUIRED_KEYS = ['BING_WEBMASTER_API_KEY'] as const;
/** Every Bing env VALUE that must be swapped for its $KEY name before anything is printed. */
const REDACT_KEYS = ['BING_WEBMASTER_API_KEY', 'BING_SITE_URL', 'BING_VERIFICATION_CODE'] as const;

/**
 * JSON/HTTP is the REST surface Bing tells you to migrate TO — the August 31, 2026
 * retirement covers the SOAP and POX protocols only, and this URL format is the one
 * still documented on the (2026-08-10) protocols page:
 * https://learn.microsoft.com/en-us/bingwebmaster/api-protocols
 */
const API = 'https://ssl.bing.com/webmaster/api.svc/json';

const trimSlash = (url: string): string => url.replace(/\/$/, '');
/** Same construction GSC uses, from the same launch.config.json productUrl. */
const sitemapUrl = (productUrl: string): string => `${trimSlash(productUrl)}/sitemap.xml`;

export interface BingDeps {
  fetchImpl?: typeof fetch;
}

/** One GetUserSites row. AuthenticationCode is the account-wide msvalidate.01 token. */
interface BingSite {
  Url: string;
  IsVerified: boolean;
  AuthenticationCode: string;
}

type CallResult = { ok: true; data: unknown } | { ok: false; error: string };

export class BingProvider implements Provider {
  readonly name = 'bing' as const;
  /** Draft-less provider: submits the sitemap + URLs from config, no copy involved. */
  readonly draftPlatform = undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: BingDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.env[k]);
  }

  /**
   * Env values must never reach output — swap any occurrence for its $KEY name.
   * Bing's auth and site both ride the query string, so the percent-encoded form of a
   * value has to be swapped too: `redactEnvValues` alone only ever sees the raw one.
   */
  private redact(text: string): string {
    let out = redactEnvValues(text, this.env, REDACT_KEYS);
    for (const key of REDACT_KEYS) {
      const value = this.env[key];
      const encoded = value ? encodeURIComponent(value) : undefined;
      if (encoded && encoded !== value) out = out.split(encoded).join(`$${key}`);
    }
    return out;
  }

  private redactPreview(preview: RequestPreview): RequestPreview {
    return {
      method: preview.method,
      url: this.redact(preview.url),
      body: preview.body === undefined ? undefined : this.redact(preview.body),
    };
  }

  mode(): 'api' | 'blocked' {
    return this.missingKeys().length === 0 ? 'api' : 'blocked';
  }

  private apiKey(): string {
    return this.env.BING_WEBMASTER_API_KEY ?? '$BING_WEBMASTER_API_KEY';
  }

  /**
   * Bing wants an http(s) site URL. BING_SITE_URL wins; GSC_SITE_URL is reused when set,
   * with Google's `sc-domain:` property form rewritten (Bing rejects it as InvalidUrl).
   */
  private envSiteUrl(): string | undefined {
    const raw = this.env.BING_SITE_URL ?? this.env.GSC_SITE_URL;
    return raw ? trimSlash(raw.replace(/^sc-domain:/, 'https://')) : undefined;
  }

  private siteUrlFor(productUrl: string): string {
    return this.envSiteUrl() ?? trimSlash(productUrl);
  }

  private jsonGet(op: string, params: Record<string, string> = {}): RequestPreview {
    const query = new URLSearchParams({ ...params, apikey: this.apiKey() });
    return { method: 'GET', url: `${API}/${op}?${query.toString()}` };
  }

  private jsonPost(op: string, body: Record<string, unknown>): RequestPreview {
    return {
      method: 'POST',
      url: `${API}/${op}?${new URLSearchParams({ apikey: this.apiKey() }).toString()}`,
      body: JSON.stringify(body),
    };
  }

  /** One request. The key rides the query string (the only auth the JSON API takes). */
  private async call(op: string, req: RequestPreview): Promise<CallResult> {
    const res = await this.fetchImpl(req.url, {
      method: req.method,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      ...(req.body === undefined ? {} : { body: req.body }),
    });
    const text = await res.text();

    if (!res.ok) {
      // Errors are a FLAT body with no "d" wrapper, returned as HTTP 400:
      // {"ErrorCode":3,"Message":"ERROR!!! InvalidApiKey"} (measured 2026-09-03).
      let message = text.trim();
      try {
        const fault = JSON.parse(text) as { ErrorCode?: number; Message?: string };
        if (fault.Message) message = `${fault.Message} (ErrorCode ${fault.ErrorCode ?? '?'})`;
      } catch {
        // Non-JSON body (an edge or proxy page): keep the raw text.
      }
      return { ok: false, error: this.redact(`HTTP ${res.status} on ${op}: ${message}`) };
    }

    // Success bodies are "d"-wrapped: {"d":null} for the void writes, {"d":true} for
    // VerifySite, {"d":[...]} for GetUserSites.
    try {
      return { ok: true, data: (JSON.parse(text) as { d?: unknown }).d };
    } catch {
      return { ok: true, data: undefined };
    }
  }

  previews(productUrl: string): RequestPreview[] {
    const site = this.siteUrlFor(productUrl);
    const requests = [this.jsonGet('GetUserSites'), this.jsonPost('AddSite', { siteUrl: site })];
    if (this.env.BING_VERIFICATION_CODE) {
      requests.push(this.jsonPost('VerifySite', { siteUrl: site }));
    }
    requests.push(
      // siteUrl is the registered Bing property; the feed is the product's own sitemap,
      // the same one GSC submits — the two can differ (an sc-domain: property, a www host).
      this.jsonPost('SubmitFeed', { siteUrl: site, feedUrl: sitemapUrl(productUrl) }),
      this.jsonPost('SubmitUrlBatch', { siteUrl: site, urlList: [productUrl] }),
      this.jsonGet('GetUrlSubmissionQuota', { siteUrl: site }),
    );
    return requests;
  }

  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing keys: ${missing.join(', ')}`,
        fixHint:
          'Bing Webmaster Tools (bing.com/webmasters) → Settings gear, top right → API Access → API Key → Generate. One key per ACCOUNT covers every site; put it in .env as BING_WEBMASTER_API_KEY.',
      };
    }
    try {
      const res = await this.call('GetUserSites', this.jsonGet('GetUserSites'));
      if (!res.ok) {
        return {
          ok: false,
          detail: res.error,
          fixHint:
            'Regenerate the key: Bing Webmaster Tools → Settings → API Access → API Key (delete, then generate).',
        };
      }
      const sites = Array.isArray(res.data) ? (res.data as BingSite[]) : [];
      const site = this.envSiteUrl();
      if (!site) {
        return {
          ok: true,
          detail: `api key valid (${sites.length} site(s)); property resolved from launch.config.json at post time`,
        };
      }
      const entry = sites.find((s) => trimSlash(s.Url) === site);
      if (!entry) {
        return {
          ok: false,
          detail: this.redact(`${site} is not in this Bing account (${sites.length} site(s) found)`),
          fixHint:
            '`launch post <dir> --platform bing --live` adds the site, or add it by hand in Bing Webmaster Tools.',
        };
      }
      if (!entry.IsVerified) {
        return {
          ok: false,
          detail: this.redact(`${site} added but NOT verified`),
          fixHint: this.redact(
            `Put <meta name="msvalidate.01" content="${entry.AuthenticationCode}"> in the home page head, deploy, then set BING_VERIFICATION_CODE=${entry.AuthenticationCode} in .env.`,
          ),
        };
      }
      return { ok: true, detail: this.redact(`verified: ${site}`) };
    } catch (err) {
      return {
        ok: false,
        detail: this.redact(`Bing API call failed: ${err instanceof Error ? err.message : String(err)}`),
        fixHint: 'Check BING_WEBMASTER_API_KEY in .env — see .env.example for where the key comes from.',
      };
    }
  }

  async post(_draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    const productUrl = opts.productUrl;
    if (!productUrl) {
      return { platform: 'bing', ok: false, error: 'Bing needs productUrl from launch.config.json', dryRun: opts.dryRun };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(productUrl)) {
        emitPreview(this.redactPreview(preview), opts);
      }
      return { platform: 'bing', ok: true, dryRun: true };
    }

    const site = this.siteUrlFor(productUrl);
    const fail = (error: string): PostResult => ({ platform: 'bing', ok: false, error, dryRun: false });

    try {
      // AddSite is documented idempotent ("If the site was already added, the method
      // will not throw exception"), so it doubles as the add-if-absent step.
      const added = await this.call('AddSite', this.jsonPost('AddSite', { siteUrl: site }));
      if (!added.ok) return fail(`Bing AddSite failed: ${added.error}`);

      const listed = await this.call('GetUserSites', this.jsonGet('GetUserSites'));
      if (!listed.ok) return fail(`Bing GetUserSites failed: ${listed.error}`);
      const entry = (Array.isArray(listed.data) ? (listed.data as BingSite[]) : []).find(
        (s) => trimSlash(s.Url) === site,
      );
      let verified = entry?.IsVerified ?? false;

      // The verification code is per ACCOUNT, so one msvalidate.01 tag verifies every site.
      if (!verified && this.env.BING_VERIFICATION_CODE) {
        const checked = await this.call('VerifySite', this.jsonPost('VerifySite', { siteUrl: site }));
        if (!checked.ok) return fail(`Bing VerifySite failed: ${checked.error}`);
        verified = checked.data === true;
      }

      if (!verified) {
        // SubmitFeed and SubmitUrlBatch both reject an unverified site (NotAuthorized) —
        // say what to put on the page instead of firing two calls that cannot work.
        return fail(
          this.redact(
            `Bing has ${site} but it is NOT verified. Put <meta name="msvalidate.01" content="${entry?.AuthenticationCode ?? '<code from Bing Webmaster Tools → Verify ownership>'}"> in the home page head, deploy, then set BING_VERIFICATION_CODE in .env and re-run.`,
          ),
        );
      }

      const feed = await this.call(
        'SubmitFeed',
        this.jsonPost('SubmitFeed', { siteUrl: site, feedUrl: sitemapUrl(productUrl) }),
      );
      if (!feed.ok) return fail(`Bing sitemap submit failed: ${feed.error}`);

      const batch = await this.call(
        'SubmitUrlBatch',
        this.jsonPost('SubmitUrlBatch', { siteUrl: site, urlList: [productUrl] }),
      );
      if (!batch.ok) return fail(`Bing URL submit failed: ${batch.error}`);

      // Quota is a report, never a failure: the sitemap and the URL are already in.
      const quota = await this.call(
        'GetUrlSubmissionQuota',
        this.jsonGet('GetUrlSubmissionQuota', { siteUrl: site }),
      );
      const left = quota.ok
        ? (quota.data as { DailyQuota?: number; MonthlyQuota?: number } | undefined)
        : undefined;
      return {
        platform: 'bing',
        ok: true,
        error: left
          ? `URL submission quota left: ${left.DailyQuota ?? '?'} today, ${left.MonthlyQuota ?? '?'} this month`
          : undefined,
        dryRun: false,
      };
    } catch (err) {
      return fail(this.redact(`Bing failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}
