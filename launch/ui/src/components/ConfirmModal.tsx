import { useEffect, useState } from 'react';

interface ConfirmModalProps {
  title: string;
  /** What exactly is about to happen — shown above the input. */
  children: React.ReactNode;
  /** The product domain the user must type, exactly. */
  domain: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (typed: string) => void;
  onClose: () => void;
}

/** Type-to-confirm gate for anything that publishes or spends. */
export function ConfirmModal({ title, children, domain, confirmLabel, busy, onConfirm, onClose }: ConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const matches = typed === domain;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="confirm-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button className="btn btn--ghost modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {children}
          <div className="field" style={{ marginTop: 14 }}>
            <div className="field__head">
              <label className="field__label" htmlFor="confirm-domain">
                Type <strong style={{ color: 'var(--amber)' }}>{domain}</strong> to confirm
              </label>
            </div>
            <input
              id="confirm-domain"
              type="text"
              className="field__input"
              data-testid="confirm-input"
              value={typed}
              autoFocus
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        </div>
        <div className="modal__foot">
          <span className="modal__hint">Nothing happens until the domain matches exactly.</span>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            data-testid="confirm-submit"
            disabled={!matches || busy}
            onClick={() => onConfirm(typed)}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
