import { useCallback, useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { api, type BriefEntry, type BriefsView } from '../api';

interface BriefsProps {
  dir: string;
}

/**
 * Briefs are local-authored, but defense in depth anyway: raw HTML is escaped
 * BEFORE parsing (so the only markup is marked's own output), and generated
 * link/image URLs are restricted to http(s)/mailto/# afterwards.
 */
function renderMarkdown(content: string): string {
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, '');
  const escaped = withoutFrontmatter.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = marked.parse(escaped, { async: false });
  return html.replace(/\s(href|src)="(?!https?:|mailto:|#)[^"]*"/gi, ' $1="#"');
}

/** Research-brief viewer: rendered markdown + freshness badges + live refresh. */
export function Briefs({ dir }: BriefsProps) {
  const [briefs, setBriefs] = useState<BriefEntry[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshLog, setRefreshLog] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const view = await api<BriefsView>('GET', `/api/target/briefs?dir=${encodeURIComponent(dir)}`);
      setBriefs(view.briefs);
      setActive((current) => current ?? view.briefs[0]?.platform ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [dir]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setRefreshLog(null);
    setError(null);
    try {
      const result = await api<{ messages: string[] }>('POST', '/api/target/research', { dir });
      setRefreshLog(result.messages);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  const brief = useMemo(
    () => briefs?.find((b) => b.platform === active) ?? null,
    [briefs, active],
  );

  if (briefs === null && !error) return <p className="muted">Loading briefs…</p>;

  return (
    <div data-testid="briefs-screen">
      {error && (
        <div className="error-strip" role="alert">
          {error}
        </div>
      )}

      {briefs !== null && briefs.length === 0 && (
        <section className="panel">
          <h2 className="panel__title">No research briefs yet</h2>
          <p className="muted">
            Briefs hold per-platform algorithm intel: hard rules, costs, timing, ban risks.
          </p>
          <button className="btn btn--primary" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? (
              <>
                <span className="spin">◐</span> Fetching live sources…
              </>
            ) : (
              'Run research'
            )}
          </button>
        </section>
      )}

      {briefs !== null && briefs.length > 0 && (
        <>
          <div className="tabs" role="tablist">
            {briefs.map((entry) => (
              <button
                key={entry.platform}
                role="tab"
                aria-selected={entry.platform === active}
                className={`tab${entry.platform === active ? ' tab--active' : ''}`}
                data-testid={`brief-tab-${entry.platform}`}
                onClick={() => setActive(entry.platform)}
              >
                {entry.platform}
                {entry.stale ? ' ●' : ''}
              </button>
            ))}
          </div>

          {brief && (
            <section className="panel" style={{ maxWidth: 880 }}>
              <h2 className="panel__title">
                {brief.platform} brief
                {brief.stale ? (
                  <span className="badge badge--warn" data-testid="stale-badge">
                    stale — refresh before launch
                  </span>
                ) : (
                  <span className="badge badge--ok" data-testid="fresh-badge">
                    fresh
                  </span>
                )}
                {brief.meta?.degraded && <span className="badge badge--warn">degraded fetch</span>}
              </h2>
              {brief.meta && (
                <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
                  fetched {new Date(brief.meta.fetchedAt).toLocaleString()} ·{' '}
                  {brief.meta.sources.length} live source(s)
                </p>
              )}
              <div className="form-actions" style={{ marginBottom: 12 }}>
                <button className="btn" disabled={refreshing} onClick={() => void refresh()} data-testid="briefs-refresh">
                  {refreshing ? (
                    <>
                      <span className="spin">◐</span> Fetching live sources…
                    </>
                  ) : (
                    '↻ Refresh research'
                  )}
                </button>
              </div>
              {refreshLog && (
                <details style={{ marginBottom: 12 }}>
                  <summary className="muted" style={{ cursor: 'pointer' }}>
                    per-source outcomes ({refreshLog.length})
                  </summary>
                  <ul className="muted" style={{ fontSize: 11.5 }}>
                    {refreshLog.map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div
                className="md"
                data-testid="brief-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(brief.content) }}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
