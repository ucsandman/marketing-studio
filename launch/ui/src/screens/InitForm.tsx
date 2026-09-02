import { useState } from 'react';
import { api, ApiError, type LaunchConfigView, type TargetInfo } from '../api';

interface InitFormProps {
  dir: string;
  scan: TargetInfo['scan'];
  onInitialized: (config: LaunchConfigView) => void;
}

interface FormState {
  name: string;
  tagline: string;
  description: string;
  domain: string;
  price: string;
  audience: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const FIELD_META: {
  key: keyof FormState;
  label: string;
  hint: string;
  required: boolean;
  textarea?: boolean;
}[] = [
  { key: 'name', label: 'Product name', hint: 'How it appears everywhere', required: true },
  { key: 'tagline', label: 'Tagline', hint: 'One line that sells it', required: true },
  {
    key: 'description',
    label: 'Description',
    hint: 'A short paragraph — used in posts and the Product Hunt kit',
    required: true,
    textarea: true,
  },
  { key: 'domain', label: 'Product domain', hint: 'Where people will find it, e.g. demoapp.io — no https://', required: true },
  { key: 'price', label: 'Pricing', hint: 'e.g. "$9/mo" or "free"', required: true },
  { key: 'audience', label: 'Audience', hint: 'Who it is for (optional, sharpens the copy)', required: false },
];

/** Launch-config form — replaces `launch init` and all of its flags. */
export function InitForm({ dir, scan, onInitialized }: InitFormProps) {
  const [form, setForm] = useState<FormState>({
    name: scan.scanned.name ?? '',
    tagline: scan.scanned.tagline ?? '',
    description: scan.scanned.description ?? '',
    domain: scan.scanned.domain ?? '',
    price: scan.scanned.pricing ?? '',
    audience: scan.scanned.audience ?? '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): Errors {
    const found: Errors = {};
    for (const meta of FIELD_META) {
      if (meta.required && !form[meta.key].trim()) {
        found[meta.key] = `${meta.label} is required.`;
      }
    }
    const domain = form.domain.trim();
    if (domain && !DOMAIN_RE.test(domain)) {
      found.domain = domain.includes('://')
        ? 'Just the bare domain — drop the https:// part.'
        : 'That does not look like a domain — expected something like demoapp.io.';
    }
    return found;
  }

  async function submit() {
    setBanner(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      const { config } = await api<{ config: LaunchConfigView }>('POST', '/api/target/init', {
        dir,
        name: form.name.trim(),
        tagline: form.tagline.trim(),
        description: form.description.trim(),
        domain: form.domain.trim(),
        price: form.price.trim(),
        audience: form.audience.trim() || undefined,
        force: true,
      });
      onInitialized(config);
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        const mapped: Errors = {};
        for (const fieldError of err.fields) {
          mapped[fieldError.field as keyof FormState] = fieldError.message;
        }
        setErrors(mapped);
        setBanner('Fix the highlighted fields and try again.');
      } else {
        setBanner(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel" data-testid="init-form">
      <h2 className="panel__title">Initialize launch</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Fill in what the pre-flight scan could not infer. This writes{' '}
        <code>.launch/launch.config.json</code> into the product folder.
      </p>
      {banner && (
        <div className="error-strip" role="alert" data-testid="init-banner">
          {banner}
        </div>
      )}
      <div className="form-grid">
        {FIELD_META.map((meta) => {
          const value = form[meta.key];
          const error = errors[meta.key];
          const shared = {
            id: `init-${meta.key}`,
            value,
            className: `${meta.textarea ? 'field__textarea' : 'field__input'}${error ? ` field__${meta.textarea ? 'textarea' : 'input'}--invalid` : ''}`,
            'data-testid': `init-${meta.key}`,
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              setForm((current) => ({ ...current, [meta.key]: event.target.value })),
          };
          return (
            <div className="field" key={meta.key}>
              <div className="field__head">
                <label className="field__label" htmlFor={`init-${meta.key}`}>
                  {meta.label}
                  {!meta.required && <span className="muted"> · optional</span>}
                </label>
                <span className="field__hint">{meta.hint}</span>
              </div>
              {meta.textarea ? <textarea rows={4} {...shared} /> : <input type="text" {...shared} />}
              {error && (
                <span className="field__error" data-testid={`init-error-${meta.key}`}>
                  {error}
                </span>
              )}
            </div>
          );
        })}
        <div className="form-actions">
          <button
            className="btn btn--primary"
            data-testid="init-submit"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? 'Writing config…' : 'Initialize launch'}
          </button>
          <span className="muted" style={{ fontSize: 11.5 }}>
            Product URL becomes https://{form.domain.trim() || '<domain>'}
          </span>
        </div>
      </div>
    </section>
  );
}
