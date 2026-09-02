import { useCallback, useEffect, useState } from 'react';
import { api, type FsListing } from '../api';

interface FolderBrowserProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

/** Modal folder browser over GET /api/fs — directories only, server-enforced. */
export function FolderBrowser({ onSelect, onClose }: FolderBrowserProps) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (path: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const query = path === null ? '' : `?path=${encodeURIComponent(path)}`;
      setListing(await api<FsListing>('GET', `/api/fs${query}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const atRoots = listing !== null && listing.path === null;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Browse for a product folder"
        data-testid="folder-browser"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">Browse — pick a product folder</h2>
          <button className="btn btn--ghost modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal__path" data-testid="browser-path">
          <span className="label">Location</span>
          <span>{atRoots ? 'My Computer' : (listing?.path ?? '…')}</span>
        </div>

        <div className="modal__list">
          {error && <div className="error-strip">{error}</div>}
          {loading && <div className="muted" style={{ padding: 10 }}>Reading directory…</div>}
          {!loading && listing && !atRoots && (
            <button className="fs-row" onClick={() => void load(listing.parent)}>
              <span className="fs-row__glyph">↑</span>
              <span className="muted">.. up one level</span>
            </button>
          )}
          {!loading &&
            listing?.entries.map((entry) => (
              <button
                key={entry.path}
                className="fs-row"
                data-testid={`fs-entry-${entry.name}`}
                onClick={() => void load(entry.path)}
              >
                <span className="fs-row__glyph">▸</span>
                <span>{entry.name}</span>
              </button>
            ))}
          {!loading && listing && listing.entries.length === 0 && (
            <div className="muted" style={{ padding: 10 }}>
              No subdirectories here.
            </div>
          )}
        </div>

        <div className="modal__foot">
          <span className="modal__hint">Navigate into your product, then select it.</span>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            data-testid="select-folder"
            disabled={atRoots || !listing?.path}
            onClick={() => listing?.path && onSelect(listing.path)}
          >
            Select this folder
          </button>
        </div>
      </div>
    </div>
  );
}
