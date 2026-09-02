import { useEffect, useState } from 'react';
import { api, type DoctorReport } from '../api';

interface PreviewProps {
  dir: string;
}

interface RequestPreview {
  method: string;
  url: string;
  body?: string;
}

interface PreviewResult {
  platform: string;
  outcome: string;
  error?: string;
  detail?: string;
  url?: string;
  previews: RequestPreview[];
}

// Platforms come from the SAME source the Post tab renders its rows from
// (/api/target/doctor). A separate literal here drifted the moment a provider was
// added: bluesky and youtube got a live-post button and no dry-run row at all.

/** Wrap $KEY_NAME placeholders (also %24-encoded) in highlighted spans. */
function highlightKeys(text: string): React.ReactNode[] {
  const parts = text.split(/((?:\$|%24)[A-Z][A-Z0-9_]+)/g);
  return parts.map((part, index) =>
    /^(?:\$|%24)[A-Z]/.test(part) ? (
      <span key={index} className="keyname" title="env key reference — the value never leaves the server">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function outcomeBadge(outcome: string): { cls: string; label: string } {
  switch (outcome) {
    case 'dry-run':
      return { cls: 'badge--ok', label: 'previewed' };
    case 'skipped-ledger':
      return { cls: 'badge--ok', label: 'already posted' };
    case 'blocked':
      return { cls: 'badge--warn', label: 'missing keys' };
    case 'refused-validation':
      return { cls: 'badge--warn', label: 'draft fails validation' };
    case 'no-draft':
      return { cls: 'badge--warn', label: 'no draft yet' };
    default:
      return { cls: 'badge--warn', label: outcome };
  }
}

/** Dry-run previews: the exact requests a live post would send. Nothing is sent. */
export function Preview({ dir }: PreviewProps) {
  const [results, setResults] = useState<PreviewResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResults(null);
    void api<DoctorReport>('GET', '/api/target/doctor')
      .then((report) =>
        api<{ results: PreviewResult[] }>('POST', '/api/target/preview', {
          dir,
          platforms: report.rows.map((row) => row.provider),
        }),
      )
      .then((data) => setResults(data.results))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [dir]);

  if (error) {
    return (
      <div className="error-strip" role="alert">
        {error}
      </div>
    );
  }
  if (!results) return <p className="muted">Building dry-run previews…</p>;

  return (
    <div data-testid="preview-screen">
      <p className="muted" style={{ maxWidth: 720, marginTop: 0 }}>
        <span className="badge badge--ok">safe</span> Dry run — these are the exact requests a live
        post would send. Nothing is sent, nothing is written, the ledger is untouched.{' '}
        <span className="keyname">$KEY_NAME</span> marks where a credential goes; values never
        leave the server.
      </p>
      {results.map((result) => {
        const badge = outcomeBadge(result.outcome);
        return (
          <section className="panel" key={result.platform} data-testid={`preview-${result.platform}`}>
            <h2 className="panel__title">
              {result.platform}
              <span className={`badge ${badge.cls}`}>{badge.label}</span>
            </h2>
            {result.error && <p className="muted">{result.error}</p>}
            {result.previews.map((preview, index) => (
              <div className="preview-card" key={index}>
                <div className="preview-card__line">
                  <span className="preview-card__method">{preview.method}</span>{' '}
                  {highlightKeys(preview.url)}
                </div>
                {preview.body && <pre className="preview-card__body">{highlightKeys(preview.body)}</pre>}
              </div>
            ))}
            {result.previews.length === 0 && result.url && (
              <div className="preview-card">
                <div className="preview-card__line">
                  <span className="preview-card__method">OPEN</span> {result.url}
                  <span className="muted"> — assisted: the engine prefills, you click submit</span>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
