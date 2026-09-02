import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type AnyDraft,
  type DoctorReport,
  type DoctorRow,
  type DraftsView,
  type PlatformMeta,
  type PostKitView,
  type StatusView,
} from '../api';
import { ConfirmModal } from '../components/ConfirmModal';

interface PostProps {
  dir: string;
  domain: string;
}

interface PostOutcomeView {
  posted?: boolean;
  skipped?: string;
  url?: string;
  messages?: string[];
}

type KitHint =
  | { kind: 'attach'; file: string }
  | { kind: 'missing' }
  | { kind: 'none' }
  | { kind: 'unconfigured' }
  | { kind: 'broken' }
  | { kind: 'invalid'; problems: string[] };

/** Which chip/hint an x or linkedin row should show — the six states are mutually exclusive. */
function kitHint(view: PostKitView | null, platform: string): KitHint | null {
  if (!view) return null;
  if (!view.configured) return { kind: 'unconfigured' };
  if (view.manifestError) return { kind: 'broken' };
  const entry = view.platforms.find((p) => p.platform === platform);
  const video = entry?.video ?? null;
  if (video === null) return { kind: 'none' };
  if (video.missing) return { kind: 'missing' };
  if (entry?.check && !entry.check.ok) return { kind: 'invalid', problems: entry.check.problems };
  return { kind: 'attach', file: video.file };
}

/** Live posting — every gate the CLI enforces, made visible. */
export function Post({ dir, domain }: PostProps) {
  const [statusView, setStatusView] = useState<StatusView | null>(null);
  const [doctor, setDoctor] = useState<DoctorRow[]>([]);
  const [meta, setMeta] = useState<PlatformMeta | null>(null);
  const [drafts, setDrafts] = useState<Map<string, AnyDraft>>(new Map());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [results, setResults] = useState<Map<string, { ok: boolean; text: string; url?: string }>>(new Map());
  const [assistNote, setAssistNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postkit, setPostkit] = useState<PostKitView | null>(null);

  const reload = useCallback(async () => {
    const [status, report, platformMeta, draftsView, kitView] = await Promise.all([
      api<StatusView>('GET', `/api/target/status?dir=${encodeURIComponent(dir)}`),
      api<DoctorReport>('GET', '/api/target/doctor'),
      api<PlatformMeta>('GET', '/api/meta/platforms'),
      api<DraftsView>('GET', `/api/target/drafts?dir=${encodeURIComponent(dir)}`),
      api<PostKitView>('GET', `/api/target/postkit?dir=${encodeURIComponent(dir)}`),
    ]);
    setStatusView(status);
    setDoctor(report.rows);
    setMeta(platformMeta);
    setDrafts(new Map(draftsView.drafts.map((entry) => [entry.platform, entry.draft])));
    setPostkit(kitView);
  }, [dir]);

  useEffect(() => {
    reload().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload]);

  async function postLive(platform: string, confirm: string) {
    setPosting(true);
    try {
      const outcome = await api<PostOutcomeView>('POST', '/api/target/post', {
        dir,
        platform,
        confirm,
      });
      setResults((current) =>
        new Map(current).set(platform, {
          ok: true,
          text: outcome.posted ? `posted ${outcome.url ?? ''}` : `skipped — ${outcome.skipped}`,
          url: outcome.url,
        }),
      );
      setConfirming(null);
      await reload();
    } catch (err) {
      setResults((current) =>
        new Map(current).set(platform, {
          ok: false,
          text: err instanceof Error ? err.message : String(err),
        }),
      );
      setConfirming(null);
    } finally {
      setPosting(false);
    }
  }

  async function assist(platform: string) {
    setAssistNote(null);
    try {
      const { results: previewResults } = await api<{ results: { platform: string; url?: string; outcome: string; error?: string }[] }>(
        'POST',
        '/api/target/preview',
        { dir, platforms: [platform] },
      );
      const result = previewResults[0];
      if (!result?.url) {
        setAssistNote(`${platform}: ${result?.error ?? 'no prefilled URL — fill the draft first'}`);
        return;
      }
      window.open(result.url, '_blank', 'noopener');
      const draft = drafts.get(platform);
      const copyText =
        draft?.platform === 'hackernews'
          ? draft.makerComment
          : draft?.platform === 'producthunt'
            ? draft.tagline
            : undefined;
      if (copyText) {
        await navigator.clipboard.writeText(copyText);
        setAssistNote(
          platform === 'hackernews'
            ? 'Submission page opened. Maker comment copied — paste it as the FIRST comment right after submitting.'
            : 'Submit page opened. Tagline copied to the clipboard.',
        );
      } else {
        setAssistNote('Submission page opened in a new tab.');
      }
    } catch (err) {
      setAssistNote(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyAssistText(platform: string) {
    const draft = drafts.get(platform);
    const copyText =
      draft?.platform === 'hackernews'
        ? draft.makerComment
        : draft?.platform === 'producthunt'
          ? draft.tagline
          : undefined;
    if (!copyText) {
      setAssistNote(`${platform}: nothing to copy yet — fill the draft first.`);
      return;
    }
    await navigator.clipboard.writeText(copyText);
    setAssistNote(`${platform}: text copied to the clipboard.`);
  }

  if (error) {
    return (
      <div className="error-strip" role="alert">
        {error}
      </div>
    );
  }
  if (!statusView || !meta) return <p className="muted">Reading posting state…</p>;

  const posted = new Map(statusView.posted.map((entry) => [entry.platform, entry]));
  const apiPlatforms = doctor.filter((row) => !meta.assistOnly.includes(row.provider));
  const assistPlatforms = doctor.filter((row) => meta.assistOnly.includes(row.provider));

  return (
    <div data-testid="post-screen">
      <section className="panel">
        <h2 className="panel__title">Live posting — for {domain}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Posting is gated three ways: you type the domain to confirm, the ledger blocks
          duplicates, and drafts must pass validation. Dry-run first on the preview tab.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>platform</th>
              <th>state</th>
              <th style={{ width: 160 }}>action</th>
            </tr>
          </thead>
          <tbody>
            {apiPlatforms.map((row) => {
              const ledgerEntry = posted.get(row.provider);
              const result = results.get(row.provider);
              const hint =
                (row.provider === 'x' || row.provider === 'linkedin') && !ledgerEntry
                  ? kitHint(postkit, row.provider)
                  : null;
              return (
                <tr key={row.provider} data-testid={`post-row-${row.provider}`}>
                  <td>{row.provider}</td>
                  <td>
                    {ledgerEntry ? (
                      <span className="badge badge--ok" data-testid={`already-posted-${row.provider}`}>
                        already posted · {new Date(ledgerEntry.postedAt).toLocaleString()}
                      </span>
                    ) : row.mode === 'blocked' ? (
                      <span className="badge badge--warn" title={row.fixHint}>
                        {row.detail}
                      </span>
                    ) : (
                      <span className="badge badge--ok">ready</span>
                    )}
                    {result && (
                      <div className={result.ok ? 'save-note' : 'field__error'} data-testid={`post-result-${row.provider}`}>
                        {result.text}
                      </div>
                    )}
                    {hint?.kind === 'attach' && (
                      <div className="save-note" data-testid={`kit-attach-${row.provider}`}>
                        video attaches: {hint.file}
                      </div>
                    )}
                    {hint?.kind === 'missing' && (
                      <div className="field__error" data-testid={`kit-missing-${row.provider}`}>
                        kit video file missing — posting will refuse; rebuild the kit or unwire it
                      </div>
                    )}
                    {hint?.kind === 'invalid' && (
                      <div className="field__error" data-testid={`kit-invalid-${row.provider}`}>
                        kit video fails {row.provider} limits — posting will refuse ({hint.problems.join('; ')})
                      </div>
                    )}
                    {hint?.kind === 'broken' && (
                      <div className="field__error" data-testid={`kit-broken-${row.provider}`}>
                        kit unreadable — posting will refuse; fix or unwire it in the marketing tab
                      </div>
                    )}
                    {hint?.kind === 'none' && (
                      <div className="muted" style={{ fontSize: 12 }} data-testid={`kit-none-${row.provider}`}>
                        text-only — the kit has no video for this platform yet
                      </div>
                    )}
                    {hint?.kind === 'unconfigured' && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        text-only — wire a post kit in the marketing tab to attach the launch video
                      </div>
                    )}
                  </td>
                  <td>
                    {ledgerEntry ? (
                      <span className="muted">done</span>
                    ) : row.mode === 'blocked' ? (
                      <span className="muted">fix .env first</span>
                    ) : (
                      <button
                        className="btn"
                        data-testid={`post-live-${row.provider}`}
                        onClick={() => setConfirming(row.provider)}
                      >
                        Post live…
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel" data-testid="assist-section">
        <h2 className="panel__title">Assisted platforms — you click submit, never the engine</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Hacker News and Product Hunt have no safe write APIs — automated submission is a ban
          risk. The engine prefills everything; the final click is yours, by design.
        </p>
        {assistNote && <div className="save-note" style={{ marginBottom: 10 }}>{assistNote}</div>}
        <table className="table">
          <tbody>
            {assistPlatforms.map((row) => (
              <tr key={row.provider} data-testid={`assist-row-${row.provider}`}>
                <td>{row.provider}</td>
                <td>
                  <span className="badge badge--warn">assist-only</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn" data-testid={`assist-open-${row.provider}`} onClick={() => void assist(row.provider)}>
                    Open prefilled submission ↗
                  </button>{' '}
                  <button className="btn btn--ghost" data-testid={`assist-copy-${row.provider}`} onClick={() => void copyAssistText(row.provider)}>
                    Copy text
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {confirming && (
        <ConfirmModal
          title={`Post live to ${confirming}`}
          domain={domain}
          confirmLabel={`Post to ${confirming}`}
          busy={posting}
          onConfirm={(typed) => void postLive(confirming, typed)}
          onClose={() => setConfirming(null)}
        >
          <p style={{ margin: 0 }}>
            This sends the <strong>{confirming}</strong> draft to {confirming} for{' '}
            <strong>{domain}</strong> — a real, public post. The ledger records it so it can never
            double-post.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
