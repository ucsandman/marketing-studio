import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type DoctorReport,
  type DoctorRow,
  type HealthInfo,
  type RecentTarget,
  type TargetInfo,
} from './api';
import { FolderBrowser } from './components/FolderBrowser';
import { InitForm } from './screens/InitForm';
import { Drafts } from './screens/Drafts';
import { Briefs } from './screens/Briefs';
import { Preview } from './screens/Preview';
import { Marketing } from './screens/Marketing';
import { Post } from './screens/Post';
import { Notify } from './screens/Notify';
import { Doctor } from './screens/Doctor';
import { StatusPanel } from './screens/StatusPanel';

interface Product {
  dir: string;
  name: string;
  domain?: string;
  initialized: boolean;
}

const TABS = ['overview', 'drafts', 'briefs', 'preview', 'marketing', 'post', 'notify', 'status', 'doctor'] as const;
type Tab = (typeof TABS)[number];

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function providerDot(row: DoctorRow): string {
  if (row.mode === 'assist') return 'dot--assist';
  if (row.mode === 'blocked') return 'dot--bad';
  return row.fixHint ? 'dot--bad' : 'dot--ok';
}

export default function App() {
  const [connected, setConnected] = useState<'checking' | 'ok' | 'fail'>('checking');
  const [version, setVersion] = useState('');
  const [recents, setRecents] = useState<RecentTarget[]>([]);
  const [picked, setPicked] = useState<Product[]>([]);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [target, setTarget] = useState<TargetInfo | null>(null);
  const [doctor, setDoctor] = useState<DoctorRow[]>([]);
  const [doctorFailed, setDoctorFailed] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    const onUnauthorized = () => setConnected('fail');
    window.addEventListener('launch:unauthorized', onUnauthorized);
    void (async () => {
      try {
        const health = await api<HealthInfo>('GET', '/api/health');
        setVersion(health.version);
        setConnected('ok');
      } catch {
        setConnected('fail');
        return;
      }
      try {
        const { targets } = await api<{ targets: RecentTarget[] }>('GET', '/api/products');
        setRecents(targets);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      try {
        const report = await api<DoctorReport>('GET', '/api/target/doctor');
        setDoctor(report.rows);
      } catch {
        setDoctorFailed(true); // informational — the shell still works without it
      }
    })();
    return () => window.removeEventListener('launch:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    setTab('overview');
    if (!selectedDir) {
      setTarget(null);
      return;
    }
    setTarget(null);
    void api<TargetInfo>('GET', `/api/target?dir=${encodeURIComponent(selectedDir)}`)
      .then(setTarget)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [selectedDir]);

  const handleInitialized = useCallback(() => {
    // Server touched recents during init — refresh both lists and the target.
    void api<{ targets: RecentTarget[] }>('GET', '/api/products')
      .then(({ targets }) => setRecents(targets))
      .catch(() => {});
    if (selectedDir) {
      setPicked((current) => current.filter((p) => p.dir !== selectedDir));
      void api<TargetInfo>('GET', `/api/target?dir=${encodeURIComponent(selectedDir)}`)
        .then(setTarget)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [selectedDir]);

  const products = useMemo<Product[]>(() => {
    const byDir = new Map<string, Product>();
    for (const recent of recents) {
      byDir.set(recent.dir, {
        dir: recent.dir,
        name: recent.name,
        domain: recent.domain,
        initialized: recent.initialized,
      });
    }
    for (const pick of picked) {
      if (!byDir.has(pick.dir)) byDir.set(pick.dir, pick);
    }
    return [...byDir.values()];
  }, [recents, picked]);

  const pickFolder = useCallback(async (path: string) => {
    setBrowsing(false);
    setError(null);
    try {
      const info = await api<TargetInfo>('GET', `/api/target?dir=${encodeURIComponent(path)}`);
      const name = info.config?.name ?? info.scan.scanned.name ?? basename(path);
      setPicked((current) => [
        ...current.filter((p) => p.dir !== path),
        { dir: path, name, domain: info.config?.domain, initialized: info.initialized },
      ]);
      setSelectedDir(path);
      setTarget(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const selected = products.find((p) => p.dir === selectedDir);

  return (
    <div className="shell">
      <header className="header">
        <span className="header__mark">
          LAUNCH<em>▲</em>ENGINE
        </span>
        {version && <span className="label">v{version}</span>}
        <span className="header__conn" data-testid="connection">
          <span
            className={`dot ${connected === 'ok' ? 'dot--ok' : connected === 'fail' ? 'dot--bad' : 'dot--idle'}`}
          />
          <span className="label">
            {connected === 'ok' ? 'console linked' : connected === 'fail' ? 'link lost — rerun launch ui' : 'linking…'}
          </span>
        </span>
      </header>

      <aside className="sidebar">
        <div className="sidebar__section" data-testid="sidebar-products">
          <div className="sidebar__head">
            <span className="label">Products</span>
            <button className="btn btn--ghost" data-testid="browse-button" onClick={() => setBrowsing(true)}>
              + Browse…
            </button>
          </div>
          {products.length === 0 && (
            <p className="muted" style={{ fontSize: 12, padding: '0 10px' }}>
              No products yet — Browse to a project folder on this machine.
            </p>
          )}
          {products.map((product) => (
            <button
              key={product.dir}
              className={`product-row${product.dir === selectedDir ? ' product-row--active' : ''}`}
              data-testid={`product-${product.name}`}
              title={product.dir}
              onClick={() => setSelectedDir(product.dir)}
            >
              <span className={`dot ${product.initialized ? 'dot--amber' : 'dot--idle'}`} />
              <span className="product-row__name">{product.name}</span>
              {product.domain && <span className="product-row__domain">{product.domain}</span>}
            </button>
          ))}
        </div>

        <div className="sidebar__section">
          <div className="sidebar__head">
            <span className="label">Providers</span>
          </div>
          {doctor.length === 0 && (
            <p className="muted" style={{ fontSize: 12, padding: '0 10px' }}>
              {doctorFailed ? 'Provider check unavailable — see the doctor tab.' : 'Checking provider readiness…'}
            </p>
          )}
          {doctor.map((row) => (
            <div key={row.provider} className="provider-row" title={row.detail}>
              <span className={`dot ${providerDot(row)}`} />
              <span>{row.provider}</span>
              <span className="provider-row__mode">{row.mode}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        {error && (
          <div className="error-strip" role="alert">
            {error}
          </div>
        )}

        {connected === 'fail' && (
          <div className="empty" data-testid="stale-token">
            <span className="empty__title">Console link lost</span>
            <hr className="empty__rule" />
            <p style={{ maxWidth: 460 }}>
              The dashboard token is per-run, and this one is no longer valid — the server probably
              restarted. Close this tab and run <code>launch ui</code> again for a fresh,
              authorized session.
            </p>
          </div>
        )}

        {connected !== 'fail' && !selected && (
          <div className="empty">
            <span className="empty__title">No product on the pad</span>
            <hr className="empty__rule" />
            <p>Pick a recent product from the sidebar, or browse to one on this machine.</p>
            <button className="btn btn--primary" onClick={() => setBrowsing(true)}>
              + Browse to a product
            </button>
          </div>
        )}

        {connected !== 'fail' && selected && target === null && <p className="muted">Reading target…</p>}

        {connected !== 'fail' && selected && target && !target.initialized && (
          <InitForm dir={selected.dir} scan={target.scan} onInitialized={handleInitialized} />
        )}

        {connected !== 'fail' && selected && target?.initialized && (
          <>
            <div className="tabs" role="tablist">
              {TABS.map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={tab === name}
                  className={`tab${tab === name ? ' tab--active' : ''}`}
                  data-testid={`tab-${name}`}
                  onClick={() => setTab(name)}
                >
                  {name}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <section className="panel" data-testid="overview">
                <h2 className="panel__title">
                  <span className="dot dot--amber" />
                  {target.config?.name ?? selected.name}
                </h2>
                <dl className="kv">
                  <dt>directory</dt>
                  <dd>{selected.dir}</dd>
                  <dt>status</dt>
                  <dd>
                    <span className="badge badge--ok" data-testid="initialized-badge">
                      initialized
                    </span>
                  </dd>
                  {target.config && (
                    <>
                      <dt>domain</dt>
                      <dd>{target.config.domain}</dd>
                      <dt>product url</dt>
                      <dd>{target.config.productUrl}</dd>
                      <dt>pricing</dt>
                      <dd>{target.config.pricing}</dd>
                      <dt>tagline</dt>
                      <dd>{target.config.tagline}</dd>
                      <dt>description</dt>
                      <dd>{target.config.description}</dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            {tab === 'drafts' && <Drafts dir={selected.dir} />}
            {tab === 'briefs' && <Briefs dir={selected.dir} />}
            {tab === 'preview' && <Preview dir={selected.dir} />}
            {tab === 'marketing' && <Marketing dir={selected.dir} />}
            {tab === 'post' && target.config && <Post dir={selected.dir} domain={target.config.domain} />}
            {tab === 'notify' && target.config && <Notify dir={selected.dir} domain={target.config.domain} />}
            {tab === 'status' && <StatusPanel dir={selected.dir} />}
            {tab === 'doctor' && <Doctor />}
          </>
        )}
      </main>

      {browsing && <FolderBrowser onSelect={(path) => void pickFolder(path)} onClose={() => setBrowsing(false)} />}
    </div>
  );
}
