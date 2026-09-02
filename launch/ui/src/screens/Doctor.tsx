import { useEffect, useState } from 'react';
import { api, type DoctorReport, type DoctorRow } from '../api';

function modeDot(row: DoctorRow): string {
  if (row.mode === 'assist') return 'dot--assist';
  if (row.mode === 'blocked') return 'dot--bad';
  return row.fixHint ? 'dot--bad' : 'dot--ok';
}

/** Provider readiness — key NAMES only; values never leave the server. */
export function Doctor() {
  const [rows, setRows] = useState<DoctorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<DoctorReport>('GET', '/api/target/doctor')
      .then((report) => setRows(report.rows))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <div className="error-strip" role="alert">
        {error}
      </div>
    );
  }
  if (!rows) return <p className="muted">Running provider checks…</p>;

  return (
    <div data-testid="doctor-screen">
      <p className="muted" style={{ maxWidth: 720, marginTop: 0 }}>
        Credential health per provider. Missing keys are named so you know what to put in{' '}
        <code>.env</code> — values never appear here.
      </p>
      <div className="card-grid">
        {rows.map((row) => (
          <div className="card" key={row.provider} data-testid={`doctor-${row.provider}`}>
            <div className="card__head">
              <span className={`dot ${modeDot(row)}`} />
              <span className="card__name">{row.provider}</span>
              <span className="card__mode">{row.mode}</span>
            </div>
            <p className="card__detail">{row.detail}</p>
            {row.fixHint && <p className="card__fix">fix: {row.fixHint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
