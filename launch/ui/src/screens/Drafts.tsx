import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  api,
  type AnyDraft,
  type DraftsView,
  type PlatformMeta,
  type RuleViolation,
} from '../api';

interface DraftsProps {
  dir: string;
}

function emptyDraft(platform: string): AnyDraft {
  switch (platform) {
    case 'x':
      return { platform: 'x', status: 'draft', thread: [''], replyWithLink: '' };
    case 'facebook':
      return { platform: 'facebook', status: 'draft', message: '', link: '' };
    case 'linkedin':
      return { platform: 'linkedin', status: 'draft', body: '', firstComment: '' };
    case 'reddit':
      return { platform: 'reddit', status: 'draft', posts: [{ sub: '', title: '', body: '' }] };
    case 'hackernews':
      return { platform: 'hackernews', status: 'draft', title: 'Show HN: ', url: '', makerComment: '' };
    case 'producthunt':
      return { platform: 'producthunt', status: 'draft', tagline: '', description: '', topics: [], firstComment: '', galleryNotes: '' };
    case 'email':
      return { platform: 'email', status: 'draft', subject: '', html: '', text: '' };
    default:
      return { platform: 'sms', status: 'draft', body: '' };
  }
}

function CharCount({ value, limit }: { value: string; limit: number }) {
  const over = value.length > limit;
  return (
    <span className={`charcount${over ? ' charcount--over' : ''}`} data-testid="charcount">
      {value.length}/{limit}
    </span>
  );
}

function ViolationList({ violations, field }: { violations: RuleViolation[]; field?: string }) {
  const shown = field === undefined ? violations : violations.filter((v) => v.field.startsWith(field));
  return (
    <>
      {shown.map((violation) => (
        <div
          key={`${violation.rule}:${violation.field}`}
          className={`violation violation--${violation.severity}`}
          data-testid={`violation-${violation.rule}`}
        >
          <span className="violation__rule">{violation.rule}</span>
          <span>{violation.message}</span>
        </div>
      ))}
    </>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  value: string;
  limit?: number;
  textarea?: boolean;
  rows?: number;
  testid?: string;
  onChange: (value: string) => void;
}

function Field({ label, hint, value, limit, textarea, rows, testid, onChange }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <div className="field__head">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {hint && <span className="field__hint">{hint}</span>}
        {limit !== undefined && <CharCount value={value} limit={limit} />}
      </div>
      {textarea ? (
        <textarea
          id={id}
          className="field__textarea"
          rows={rows ?? 4}
          value={value}
          data-testid={testid}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          className="field__input"
          value={value}
          data-testid={testid}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

/** Per-platform launch-copy editor with live limits and server rule violations. */
export function Drafts({ dir }: DraftsProps) {
  const [meta, setMeta] = useState<PlatformMeta | null>(null);
  const [stored, setStored] = useState<Map<string, AnyDraft>>(new Map());
  const [edits, setEdits] = useState<Map<string, AnyDraft>>(new Map());
  const [violations, setViolations] = useState<Map<string, RuleViolation[]>>(new Map());
  const [active, setActive] = useState('x');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const platformMeta = await api<PlatformMeta>('GET', '/api/meta/platforms');
        setMeta(platformMeta);
        const view = await api<DraftsView>('GET', `/api/target/drafts?dir=${encodeURIComponent(dir)}`);
        const byPlatform = new Map<string, AnyDraft>();
        const initialViolations = new Map<string, RuleViolation[]>();
        for (const entry of view.drafts) {
          byPlatform.set(entry.platform, entry.draft);
          initialViolations.set(entry.platform, [
            ...entry.validation.errors,
            ...entry.validation.warnings,
          ]);
        }
        setStored(byPlatform);
        setViolations(initialViolations);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [dir]);

  const draft = useMemo<AnyDraft>(() => {
    return edits.get(active) ?? stored.get(active) ?? emptyDraft(active);
  }, [edits, stored, active]);

  const update = useCallback(
    (patch: Partial<AnyDraft>) => {
      setEdits((current) => {
        const next = new Map(current);
        next.set(active, { ...draft, ...patch } as AnyDraft);
        return next;
      });
      setSavedAt(null);
    },
    [active, draft],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...draft, status: 'filled' } as AnyDraft;
      const result = await api<{ saved: boolean; violations: RuleViolation[] }>(
        'PUT',
        `/api/target/drafts/${active}`,
        { dir, draft: payload },
      );
      setStored((current) => new Map(current).set(active, payload));
      setEdits((current) => {
        const next = new Map(current);
        next.delete(active);
        return next;
      });
      setViolations((current) => new Map(current).set(active, result.violations));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!meta) return <p className="muted">Loading platform rules…</p>;

  const limits = meta.limits;
  const activeViolations = violations.get(active) ?? [];
  const isAssistOnly = meta.assistOnly.includes(active);

  return (
    <div data-testid="drafts-screen">
      <div className="tabs" role="tablist">
        {meta.draftPlatforms.map((platform) => (
          <button
            key={platform}
            role="tab"
            aria-selected={platform === active}
            className={`tab${platform === active ? ' tab--active' : ''}`}
            data-testid={`draft-tab-${platform}`}
            onClick={() => setActive(platform)}
          >
            {platform}
            {(violations.get(platform) ?? []).some((v) => v.severity === 'error') ? ' ⚠' : ''}
          </button>
        ))}
      </div>

      {error && (
        <div className="error-strip" role="alert">
          {error}
        </div>
      )}

      <section className="panel">
        <h2 className="panel__title">
          {active} draft
          {isAssistOnly && (
            <span className="badge badge--warn" title="The engine opens a prefilled page; you click submit.">
              assist-only
            </span>
          )}
        </h2>

        <div className="form-grid">
          {draft.platform === 'x' && (
            <>
              {draft.thread.map((post, index) => (
                <div key={index}>
                  <Field
                    label={`Post ${index + 1}${index === 0 ? ' — no URL here (13x cost + downrank)' : ''}`}
                    value={post}
                    limit={limits.x.post}
                    textarea
                    rows={3}
                    testid={`x-thread-${index}`}
                    onChange={(value) => {
                      const thread = [...draft.thread];
                      thread[index] = value;
                      update({ thread });
                    }}
                  />
                  <ViolationList violations={activeViolations} field={`thread[${index}]`} />
                </div>
              ))}
              <div className="form-actions">
                <button className="btn btn--ghost" onClick={() => update({ thread: [...draft.thread, ''] })}>
                  + add post
                </button>
                {draft.thread.length > 1 && (
                  <button className="btn btn--ghost" onClick={() => update({ thread: draft.thread.slice(0, -1) })}>
                    − remove last
                  </button>
                )}
              </div>
              <Field
                label="Reply with link"
                hint="Posted under the thread — the product URL goes here"
                value={draft.replyWithLink ?? ''}
                testid="x-reply"
                onChange={(value) => update({ replyWithLink: value })}
              />
            </>
          )}

          {draft.platform === 'facebook' && (
            <>
              <div>
                <Field label="Message" value={draft.message} textarea rows={6} testid="fb-message" onChange={(value) => update({ message: value })} />
                <ViolationList violations={activeViolations} field="message" />
              </div>
              <Field label="Link" hint="Attached link preview" value={draft.link ?? ''} testid="fb-link" onChange={(value) => update({ link: value })} />
            </>
          )}

          {draft.platform === 'linkedin' && (
            <>
              <div>
                <Field label="Post body" hint="No links here — ~18.8% reach cost" value={draft.body} textarea rows={8} testid="li-body" onChange={(value) => update({ body: value })} />
                <ViolationList violations={activeViolations} field="body" />
              </div>
              <Field label="First comment" hint="The product link lives here" value={draft.firstComment ?? ''} testid="li-comment" onChange={(value) => update({ firstComment: value })} />
            </>
          )}

          {draft.platform === 'reddit' && (
            <>
              {draft.posts.map((post, index) => (
                <div key={index} className="form-grid" style={{ borderLeft: '2px solid var(--line-bright)', paddingLeft: 12 }}>
                  <Field label={`Subreddit ${index + 1}`} hint="without r/" value={post.sub} testid={`reddit-sub-${index}`} onChange={(value) => {
                    const posts = draft.posts.map((p, i) => (i === index ? { ...p, sub: value } : p));
                    update({ posts });
                  }} />
                  <div>
                    <Field label="Title" value={post.title} limit={limits.reddit.title} testid={`reddit-title-${index}`} onChange={(value) => {
                      const posts = draft.posts.map((p, i) => (i === index ? { ...p, title: value } : p));
                      update({ posts });
                    }} />
                    <ViolationList violations={activeViolations} field={`posts[${index}]`} />
                  </div>
                  <Field label="Body" hint="Customize per sub — identical bodies read as spam" value={post.body} textarea testid={`reddit-body-${index}`} onChange={(value) => {
                    const posts = draft.posts.map((p, i) => (i === index ? { ...p, body: value } : p));
                    update({ posts });
                  }} />
                </div>
              ))}
              <div className="form-actions">
                <button className="btn btn--ghost" onClick={() => update({ posts: [...draft.posts, { sub: '', title: '', body: '' }] })}>
                  + add subreddit
                </button>
              </div>
            </>
          )}

          {draft.platform === 'hackernews' && (
            <>
              <div>
                <Field label="Title" hint='Must start with "Show HN: "' value={draft.title} limit={limits.hackernews.title} testid="hn-title" onChange={(value) => update({ title: value })} />
                <ViolationList violations={activeViolations} field="title" />
              </div>
              <Field label="URL" value={draft.url} testid="hn-url" onChange={(value) => update({ url: value })} />
              <div>
                <Field label="Maker comment" hint="Posted immediately after submitting — required for URL submissions" value={draft.makerComment ?? ''} textarea testid="hn-comment" onChange={(value) => update({ makerComment: value })} />
                <ViolationList violations={activeViolations} field="makerComment" />
              </div>
            </>
          )}

          {draft.platform === 'producthunt' && (
            <>
              <div>
                <Field label="Tagline" value={draft.tagline} limit={limits.producthunt.tagline} testid="ph-tagline" onChange={(value) => update({ tagline: value })} />
                <ViolationList violations={activeViolations} field="tagline" />
              </div>
              <Field label="Description" value={draft.description} textarea testid="ph-description" onChange={(value) => update({ description: value })} />
              <div>
                <Field label="Topics" hint="1–3, comma-separated" value={draft.topics.join(', ')} testid="ph-topics" onChange={(value) => update({ topics: value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                <ViolationList violations={activeViolations} field="topics" />
              </div>
              <Field label="First comment" value={draft.firstComment ?? ''} textarea testid="ph-comment" onChange={(value) => update({ firstComment: value })} />
            </>
          )}

          {draft.platform === 'email' && (
            <>
              <div>
                <Field label="Subject" value={draft.subject} limit={limits.email.subject} testid="email-subject" onChange={(value) => update({ subject: value })} />
                <ViolationList violations={activeViolations} field="subject" />
              </div>
              <div>
                <Field label="HTML body" hint="Must contain the product link and an unsubscribe link" value={draft.html} textarea rows={10} testid="email-html" onChange={(value) => update({ html: value })} />
                <ViolationList violations={activeViolations} field="html" />
              </div>
              <Field label="Plain-text body" value={draft.text} textarea rows={5} testid="email-text" onChange={(value) => update({ text: value })} />
            </>
          )}

          {draft.platform === 'sms' && (
            <div>
              <Field label="Message" hint={`${limits.sms.gsmSeptets} GSM septets max — emoji and special chars count double`} value={draft.body} textarea rows={4} testid="sms-body" onChange={(value) => update({ body: value })} />
              <ViolationList violations={activeViolations} field="body" />
            </div>
          )}

          <ViolationList
            violations={activeViolations.filter(
              (violation) => violation.rule === 'unfilled-placeholder' || violation.field === 'thread' || violation.field === 'posts',
            )}
          />

          <div className="form-actions">
            <button className="btn btn--primary" data-testid="draft-save" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            {savedAt && (
              <span className="save-note" data-testid="draft-saved">
                saved {savedAt} — {(violations.get(active) ?? []).filter((v) => v.severity === 'error').length} rule violation(s)
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
