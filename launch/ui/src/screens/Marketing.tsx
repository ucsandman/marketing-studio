import { useCallback, useEffect, useState } from 'react';
import { api, type PostKitView } from '../api';
import { FolderBrowser } from '../components/FolderBrowser';

interface MarketingProps {
  dir: string;
}

function mb(bytes: number | null): string {
  return bytes === null ? '?' : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Marketing assets panel: what the animations post kit provides, per platform. */
export function Marketing({ dir }: MarketingProps) {
  const [view, setView] = useState<PostKitView | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setView(await api<PostKitView>('GET', `/api/target/postkit?dir=${encodeURIComponent(dir)}`));
  }, [dir]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload]);

  async function setKitDir(postkitDir: string | null) {
    setBrowsing(false);
    setError(null);
    setNote(null);
    try {
      await api('PUT', '/api/target/config/postkit', { dir, postkitDir });
      setNote(postkitDir ? 'Post kit wired. X and LinkedIn posts will attach the kit video.' : 'Post kit cleared.');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openFolder(platform: string) {
    setError(null);
    try {
      await api('POST', '/api/target/postkit/open', { dir, platform });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (error && !view) {
    return (
      <div className="error-strip" role="alert">
        {error}
      </div>
    );
  }
  if (!view) return <p className="muted">Reading post kit…</p>;

  return (
    <div data-testid="marketing-screen">
      <section className="panel">
        <h2 className="panel__title">Marketing assets — rendered post kit</h2>
        {error && (
          <div className="error-strip" role="alert">
            {error}
          </div>
        )}
        {note && <div className="save-note">{note}</div>}

        {!view.configured && (
          <>
            <p className="muted">
              No post kit wired. If you rendered marketing assets with the animations studio
              (/marketing), point this product at its kit folder — usually{' '}
              <code>animations/out/&lt;brand&gt;/postkit</code>. X and LinkedIn posts then attach
              the launch video automatically; the other platforms get a ready-to-upload folder.
            </p>
            <button className="btn btn--primary" data-testid="pick-postkit" onClick={() => setBrowsing(true)}>
              + Wire a post kit…
            </button>
          </>
        )}

        {view.configured && (
          <>
            <dl className="kv">
              <dt>kit</dt>
              <dd>{view.dir}</dd>
              {view.brand && (
                <>
                  <dt>brand</dt>
                  <dd>{view.brand}</dd>
                </>
              )}
              {view.generatedAt && (
                <>
                  <dt>rendered</dt>
                  <dd>{new Date(view.generatedAt).toLocaleString()}</dd>
                </>
              )}
            </dl>
            <p>
              <button className="btn btn--ghost" onClick={() => setBrowsing(true)}>
                Change…
              </button>{' '}
              <button className="btn btn--ghost" data-testid="clear-postkit" onClick={() => void setKitDir(null)}>
                Unwire
              </button>
            </p>
          </>
        )}

        {view.manifestError && (
          <div className="field__error" data-testid="manifest-error">
            The kit at {view.dir} could not be read: {view.manifestError}
          </div>
        )}
      </section>

      {view.platforms.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">Per-platform assets</h2>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>preview</th>
                <th>platform</th>
                <th>video</th>
                <th>caption</th>
                <th>posting</th>
                <th style={{ width: 130 }}>files</th>
              </tr>
            </thead>
            <tbody>
              {view.platforms.map((p) => (
                <tr key={p.platform} data-testid={`kit-row-${p.platform}`}>
                  <td>
                    {p.thumbDataUri ? (
                      <img src={p.thumbDataUri} alt={`${p.platform} thumbnail`} style={{ width: 80, borderRadius: 4 }} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{p.platform}</td>
                  <td>
                    {p.video === null ? (
                      <span className="muted">not rendered</span>
                    ) : p.video.missing ? (
                      <span className="badge badge--warn" title="The manifest promises this file but it is missing on disk. Posting will refuse rather than go text-only.">
                        file missing
                      </span>
                    ) : (
                      <span>
                        {p.video.file} · {mb(p.video.sizeBytes)}
                      </span>
                    )}
                    {p.check && !p.check.ok && (
                      <span
                        className="badge badge--warn"
                        style={{ marginLeft: 8 }}
                        title={p.check.problems.join('; ')}
                        data-testid={`kit-overlimit-${p.platform}`}
                      >
                        over limit
                      </span>
                    )}
                  </td>
                  <td className="muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.caption ?? ''}>
                    {p.caption ?? '—'}
                  </td>
                  <td>
                    {p.autoAttach ? (
                      <span className="badge badge--ok" title="launch post attaches this video automatically">
                        auto-attach
                      </span>
                    ) : (
                      <span className="badge badge--warn" title={p.note}>
                        manual upload
                      </span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn--ghost" data-testid={`open-kit-${p.platform}`} onClick={() => void openFolder(p.platform)}>
                      Open folder
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Auto-attach platforms post through the engine with the video attached. Manual platforms
            (TikTok, Shorts, YouTube, Instagram) have no safe write API here; their folder holds the
            right-aspect video, caption, and a checklist — Open folder and upload in the app.
          </p>
        </section>
      )}

      {browsing && <FolderBrowser onSelect={(path) => void setKitDir(path)} onClose={() => setBrowsing(false)} />}
    </div>
  );
}
