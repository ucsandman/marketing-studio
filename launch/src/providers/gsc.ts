import { GoogleAuth } from 'google-auth-library';
import type { Draft, PostResult } from '../types.js';
import {
  emitPreview,
  redactEnvValues,
  redactPreview,
  type PostOptions,
  type Provider,
  type ProviderStatus,
  type RequestPreview,
} from './types.js';

const REQUIRED_KEYS = ['GOOGLE_APPLICATION_CREDENTIALS', 'GSC_SITE_URL'] as const;
const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3';
const INSPECTION = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const SCOPE = 'https://www.googleapis.com/auth/webmasters';

export interface GscDeps {
  fetchImpl?: typeof fetch;
  /** Returns a bearer token; default uses the service account via google-auth-library. */
  tokenProvider?: () => Promise<string>;
}

export class GscProvider implements Provider {
  readonly name = 'google' as const;
  /** Draft-less provider: posts the sitemap + inspection from config, no copy involved. */
  readonly draftPlatform = undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenProvider: () => Promise<string>;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    deps: GscDeps = {},
  ) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.tokenProvider =
      deps.tokenProvider ??
      (async () => {
        const auth = new GoogleAuth({ scopes: [SCOPE], keyFilename: this.env.GOOGLE_APPLICATION_CREDENTIALS });
        const token = await (await auth.getClient()).getAccessToken();
        if (!token.token) throw new Error('service account returned no access token');
        return token.token;
      });
  }

  private missingKeys(): string[] {
    return REQUIRED_KEYS.filter((k) => !this.env[k]);
  }

  /** Env values must never reach output — swap any occurrence for its $KEY name. */
  private redact(text: string): string {
    return redactEnvValues(text, this.env, REQUIRED_KEYS);
  }

  mode(): 'api' | 'blocked' {
    return this.missingKeys().length === 0 ? 'api' : 'blocked';
  }

  private siteUrl(): string {
    return this.env.GSC_SITE_URL ?? '$GSC_SITE_URL';
  }

  async ready(): Promise<ProviderStatus> {
    const missing = this.missingKeys();
    if (missing.length > 0) {
      return {
        ok: false,
        detail: `missing keys: ${missing.join(', ')}`,
        fixHint:
          'Create a service account in Google Cloud, enable the Search Console API, download the JSON key, add the service-account email as a user on your GSC property, fill .env.',
      };
    }
    try {
      const token = await this.tokenProvider();
      const res = await this.fetchImpl(`${WEBMASTERS}/sites/${encodeURIComponent(this.siteUrl())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403 || res.status === 401) {
        return {
          ok: false,
          detail: this.redact(`service account not authorized for ${this.siteUrl()} (HTTP ${res.status})`),
          fixHint: 'Add the service-account email as a full user on the property in Search Console → Settings → Users.',
        };
      }
      if (!res.ok) return { ok: false, detail: `site check failed: HTTP ${res.status}` };
      return { ok: true, detail: this.redact(`service account authorized for ${this.siteUrl()}`) };
    } catch (err) {
      return {
        ok: false,
        detail: this.redact(`auth failed: ${err instanceof Error ? err.message : String(err)}`),
        fixHint: 'Check GOOGLE_APPLICATION_CREDENTIALS points at a valid service-account JSON key file.',
      };
    }
  }

  previews(productUrl: string): RequestPreview[] {
    const sitemapUrl = `${productUrl.replace(/\/$/, '')}/sitemap.xml`;
    return [
      {
        method: 'PUT',
        url: `${WEBMASTERS}/sites/${encodeURIComponent(this.siteUrl())}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      },
      {
        method: 'POST',
        url: INSPECTION,
        body: JSON.stringify({ inspectionUrl: productUrl, siteUrl: this.siteUrl() }),
      },
    ];
  }

  async post(_draft: Draft | undefined, opts: PostOptions): Promise<PostResult> {
    const productUrl = opts.productUrl;
    if (!productUrl) {
      return { platform: 'google', ok: false, error: 'GSC needs productUrl from launch.config.json', dryRun: opts.dryRun };
    }

    if (opts.dryRun) {
      for (const preview of this.previews(productUrl)) {
        emitPreview(redactPreview(preview, this.env, REQUIRED_KEYS), opts);
      }
      return { platform: 'google', ok: true, dryRun: true };
    }

    try {
      const token = await this.tokenProvider();
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const [sitemapPreview, inspectPreview] = this.previews(productUrl);

      const sitemapRes = await this.fetchImpl(sitemapPreview!.url, { method: 'PUT', headers });
      if (!sitemapRes.ok) {
        return { platform: 'google', ok: false, error: `GSC sitemap submit failed: HTTP ${sitemapRes.status}`, dryRun: false };
      }

      const inspectRes = await this.fetchImpl(inspectPreview!.url, {
        method: 'POST',
        headers,
        body: inspectPreview!.body,
      });
      if (!inspectRes.ok) {
        return { platform: 'google', ok: false, error: `GSC URL inspection failed: HTTP ${inspectRes.status}`, dryRun: false };
      }
      const json = (await inspectRes.json()) as {
        inspectionResult?: { inspectionResultLink?: string; indexStatusResult?: { verdict?: string } };
      };
      const verdict = json.inspectionResult?.indexStatusResult?.verdict;
      return {
        platform: 'google',
        ok: true,
        url: json.inspectionResult?.inspectionResultLink,
        error: verdict && verdict !== 'PASS' ? `index verdict: ${verdict} (sitemap submitted; indexing takes time for new domains)` : undefined,
        dryRun: false,
      };
    } catch (err) {
      return {
        platform: 'google',
        ok: false,
        error: `GSC failed: ${err instanceof Error ? err.message : String(err)}`,
        dryRun: false,
      };
    }
  }
}
