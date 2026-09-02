import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';

interface NotifyProps {
  dir: string;
  domain: string;
}

interface NotifyView {
  live: boolean;
  messages: string[];
  consent?: {
    consented: { to: string; name?: string }[];
    excluded: { to: string; name?: string }[];
  };
  payloadCount?: number;
  payloadsPath?: string;
}

type Channel = 'email' | 'sms';

/** Contacts + consent + gated payload writing. The engine itself NEVER sends. */
export function Notify({ dir, domain }: NotifyProps) {
  const [channel, setChannel] = useState<Channel>('email');
  const [view, setView] = useState<NotifyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveResult, setLiveResult] = useState<NotifyView | null>(null);

  const loadPreview = useCallback(async (selected: Channel) => {
    setView(null);
    setError(null);
    setLiveResult(null);
    try {
      setView(await api<NotifyView>('POST', '/api/target/notify', { dir, channel: selected }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    }
  }, [dir]);

  useEffect(() => {
    void loadPreview(channel);
  }, [channel, loadPreview]);

  async function writeLive(typed: string) {
    setBusy(true);
    try {
      const result = await api<NotifyView>('POST', '/api/target/notify', {
        dir,
        channel,
        live: true,
        confirm: typed,
      });
      setLiveResult(result);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="notify-screen">
      <div className="tabs" role="tablist">
        {(['email', 'sms'] as const).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={channel === name}
            className={`tab${channel === name ? ' tab--active' : ''}`}
            data-testid={`notify-channel-${name}`}
            onClick={() => setChannel(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {error && (
        <section className="panel">
          <h2 className="panel__title">Cannot preview {channel} notifications</h2>
          <div className="error-strip" role="alert">
            {error}
          </div>
          <p className="muted">
            Notifications need <code>.launch/contacts.json</code> (with explicit consent flags) and
            a filled, valid {channel} draft. Example contacts file:
          </p>
          <pre className="preview-card__body">{`{
  "email": [{ "address": "a@b.c", "name": "Ada", "consent": true }],
  "sms":   [{ "number": "+15551234567", "consent": true }]
}`}</pre>
        </section>
      )}

      {view?.consent && (
        <>
          <section className="panel">
            <h2 className="panel__title">
              {channel} recipients
              <span className="badge badge--ok">dry-run — nothing sent, nothing written</span>
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Hard rule: only contacts with explicit consent are ever messaged. The engine renders
              payloads for DashClaw to send — it never sends directly.
            </p>
            <table className="table" data-testid="contacts-table">
              <thead>
                <tr>
                  <th>contact</th>
                  <th>consent</th>
                  <th>will receive</th>
                </tr>
              </thead>
              <tbody>
                {view.consent.consented.map((contact) => (
                  <tr key={contact.to} data-testid={`contact-consented-${contact.to}`}>
                    <td>
                      {contact.name ? `${contact.name} · ` : ''}
                      {contact.to}
                    </td>
                    <td>
                      <span className="badge badge--ok">consent</span>
                    </td>
                    <td>yes</td>
                  </tr>
                ))}
                {view.consent.excluded.map((contact) => (
                  <tr key={contact.to} className="row--excluded" data-testid={`contact-excluded-${contact.to}`}>
                    <td>
                      {contact.name ? `${contact.name} · ` : ''}
                      {contact.to}
                    </td>
                    <td>
                      <span className="badge badge--warn" data-testid={`excluded-badge-${contact.to}`}>
                        no consent — excluded
                      </span>
                    </td>
                    <td className="muted">never</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginBottom: 0 }}>
              {view.payloadCount ?? 0} payload(s) would be written for DashClaw.
            </p>
          </section>

          <section className="panel">
            <h2 className="panel__title">Write live payloads</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Writes <code>notify-payloads.json</code> for the consented contacts above. Sending
              happens later via DashClaw's governed tools — this step has its own confirm because
              it is the point of no return for the contact list.
            </p>
            {liveResult ? (
              <div className="save-note" data-testid="notify-live-done">
                {liveResult.payloadCount} payload(s) written to {liveResult.payloadsPath}
              </div>
            ) : (
              <button
                className="btn btn--primary"
                data-testid="notify-live-button"
                disabled={(view.payloadCount ?? 0) === 0}
                onClick={() => setConfirming(true)}
              >
                Write live payloads…
              </button>
            )}
          </section>
        </>
      )}

      {!view && !error && <p className="muted">Building {channel} preview…</p>}

      {confirming && (
        <ConfirmModal
          title={`Write live ${channel} payloads`}
          domain={domain}
          confirmLabel="Write payloads"
          busy={busy}
          onConfirm={(typed) => void writeLive(typed)}
          onClose={() => setConfirming(false)}
        >
          <p style={{ margin: 0 }}>
            This writes send-ready {channel} payloads for{' '}
            <strong>{view?.payloadCount ?? 0} consented contact(s)</strong> of {domain}. Excluded
            contacts stay excluded.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
