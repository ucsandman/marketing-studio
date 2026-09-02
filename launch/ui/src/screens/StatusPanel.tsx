import { useEffect, useState } from 'react';
import { api, type StatusView } from '../api';

interface StatusPanelProps {
  dir: string;
}

/** Launch progress: posted (ledger) vs pending, brief freshness, remaining steps. */
export function StatusPanel({ dir }: StatusPanelProps) {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<StatusView>('GET', `/api/target/status?dir=${encodeURIComponent(dir)}`)
      .then(setStatus)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [dir]);

  if (error) {
    return (
      <div className="error-strip" role="alert">
        {error}
      </div>
    );
  }
  if (!status) return <p className="muted">Reading launch state…</p>;

  const postedPlatforms = new Set(status.posted.map((entry) => entry.platform));
  const pending = status.drafts.filter((draft) => !postedPlatforms.has(draft.platform));

  return (
    <div data-testid="status-screen">
      <section className="panel">
        <h2 className="panel__title">Posted — from the ledger</h2>
        {status.posted.length === 0 ? (
          <p className="muted" data-testid="posted-empty">
            Nothing posted yet. The ledger fills in as platforms go live.
          </p>
        ) : (
          <table className="table" data-testid="posted-table">
            <thead>
              <tr>
                <th>platform</th>
                <th>posted at</th>
                <th>url</th>
              </tr>
            </thead>
            <tbody>
              {status.posted.map((entry) => (
                <tr key={`${entry.platform}:${entry.postedAt}`} data-testid={`posted-${entry.platform}`}>
                  <td>{entry.platform}</td>
                  <td>{new Date(entry.postedAt).toLocaleString()}</td>
                  <td>
                    {entry.url ? (
                      <a href={entry.url} target="_blank" rel="noreferrer">
                        {entry.url}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Pending platforms</h2>
        {pending.length === 0 ? (
          <p className="muted">Every draft platform is posted.</p>
        ) : (
          <table className="table" data-testid="pending-table">
            <thead>
              <tr>
                <th>platform</th>
                <th>draft state</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((draft) => (
                <tr key={draft.platform} data-testid={`pending-${draft.platform}`}>
                  <td>{draft.platform}</td>
                  <td className={draft.status === 'missing' ? 'muted' : ''}>{draft.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Research freshness</h2>
        <div>
          {status.briefs.map((brief) => (
            <span key={brief.platform} className={`chip chip--${brief.state}`}>
              {brief.platform} · {brief.state}
            </span>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Remaining steps</h2>
        {status.remaining.length === 0 ? (
          <p className="muted">Launch complete. 🎉</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {status.remaining.map((step) => (
              <li key={step} style={{ margin: '4px 0' }}>
                {step}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
