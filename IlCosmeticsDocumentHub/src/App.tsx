import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import { initAuth, login, logout } from './auth';
import { DocItem, Library, NoLibraryError, daysUntil, getLibraries, loadDocuments } from './docs';
import { GraphError } from './graph';
import { RESTRICTED } from './config';
import { EmptyState, StatTile } from './ui';
import DocumentList, { Preset } from './components/DocumentList';
import UploadDialog from './components/UploadDialog';
import DocumentPanel from './components/DocumentPanel';

type Tab = 'registre' | 'atraiter' | 'echeances';

export default function App() {
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined);
  const [libs, setLibs] = useState<Library[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('registre');
  const [preset, setPreset] = useState<Preset>({});

  useEffect(() => {
    initAuth()
      .then(setAccount)
      .catch((e) => {
        setError(String(e?.message ?? e));
        setAccount(null);
      });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const l = await getLibraries();
      setLibs(l);
      const all = await Promise.all(l.map(loadDocuments));
      setDocs(all.flat().sort((a, b) => b.created.localeCompare(a.created)));
    } catch (e) {
      setLibs([]);
      if (e instanceof NoLibraryError) setError(e.message);
      else {
        const ge = e as GraphError;
        setError(
          ge.status === 403 || ge.status === 404
            ? "Accès au site refusé : l'application n'a pas l'accès au site SharePoint, ou votre compte n'a aucun droit."
            : `Erreur de chargement : ${ge.message}`,
        );
      }
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (account) void reload();
  }, [account, reload]);

  const stats = useMemo(() => {
    const live = docs.filter((d) => d.fields.Statut !== 'Annulé');
    return {
      total: live.length,
      aSigner: live.filter((d) => d.fields.Statut === 'À signer').length,
      envoye: live.filter((d) => d.fields.Statut === 'Envoyé').length,
      echeances: live.filter((d) => {
        const n = daysUntil(d.fields.DateEcheance);
        return n !== null && n <= 90;
      }).length,
      confidentiels: live.filter((d) => d.library.name === RESTRICTED).length,
    };
  }, [docs]);

  const selected = useMemo(() => docs.find((d) => `${d.library.name}/${d.itemId}` === selectedKey) ?? null, [docs, selectedKey]);

  const go = (t: Tab, p: Preset = {}) => {
    setTab(t);
    setPreset(p);
  };

  if (account === undefined) {
    return (
      <div className="login">
        <div className="spinner" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="login">
        <div className="login-logo">📁</div>
        <div className="login-title">IL Cosmetics Document Hub</div>
        <div className="login-sub">Registre et archivage des documents officiels du groupe</div>
        <button className="btn-login" onClick={() => void login()}>
          Se connecter avec Microsoft
        </button>
        <div className="login-note">Accès réservé aux collaborateurs autorisés d'IL Cosmetics.</div>
        {error && <div className="login-note">{error}</div>}
      </div>
    );
  }

  const heroTitle = tab === 'registre' ? 'Registre documentaire' : tab === 'atraiter' ? 'Documents à traiter' : 'Échéances contractuelles';
  const heroSub =
    tab === 'registre'
      ? `${stats.total} document(s) actif(s) · ${libs.length} bibliothèque(s) accessible(s)`
      : tab === 'atraiter'
        ? 'Documents à signer ou en attente de retour signé'
        : 'Documents dont l’échéance tombe dans les 90 jours ou est dépassée';

  return (
    <div>
      <div className="header">
        <div className="header-title">📁 Document Hub</div>
        <div className="tabs">
          <button className={`tab${tab === 'registre' ? ' on' : ''}`} onClick={() => go('registre')}>
            Registre
          </button>
          <button className={`tab${tab === 'atraiter' ? ' on' : ''}`} onClick={() => go('atraiter')}>
            À traiter
            {stats.aSigner + stats.envoye > 0 && <span className="tab-badge">{stats.aSigner + stats.envoye}</span>}
          </button>
          <button className={`tab${tab === 'echeances' ? ' on' : ''}`} onClick={() => go('echeances')}>
            Échéances
            {stats.echeances > 0 && <span className="tab-badge red">{stats.echeances}</span>}
          </button>
        </div>
        <div className="header-right">
          <span className="user-pill">{account.name}</span>
          <button className="header-link" onClick={() => void logout()}>
            Déconnexion
          </button>
        </div>
      </div>

      <div className="page">
        <div className="hero">
          <div>
            <div className="hero-kicker">IL Cosmetics Group</div>
            <div className="hero-title">{heroTitle}</div>
            <div className="hero-sub">{heroSub}</div>
          </div>
          <div className="hero-actions">
            <button className="btn btn-ghost" onClick={() => void reload()} disabled={loading}>
              {loading ? 'Chargement…' : '↻ Actualiser'}
            </button>
            <button className="btn btn-primary" disabled={!libs.length} onClick={() => setShowUpload(true)} title={libs.length ? '' : 'Aucune bibliothèque accessible'}>
              + Déposer un document
            </button>
          </div>
        </div>

        {error && <div className="alert t-red">{error}</div>}

        <div className="tiles">
          <StatTile label="Documents" value={stats.total} sub="actifs" tone="grey" icon="📄" onClick={() => go('registre')} active={tab === 'registre' && !preset.statut} />
          <StatTile label="À signer" value={stats.aSigner} sub="code apposé, non envoyés" tone={stats.aSigner ? 'orange' : 'grey'} icon="✍️" onClick={() => go('atraiter', { statut: 'À signer' })} active={preset.statut === 'À signer'} />
          <StatTile label="Envoyés" value={stats.envoye} sub="en attente de retour" tone={stats.envoye ? 'blue' : 'grey'} icon="📨" onClick={() => go('atraiter', { statut: 'Envoyé' })} active={preset.statut === 'Envoyé'} />
          <StatTile label="Échéances ≤ 90 j" value={stats.echeances} sub="dont dépassées" tone={stats.echeances ? 'red' : 'grey'} icon="⏳" onClick={() => go('echeances')} active={tab === 'echeances'} />
          <StatTile label="Confidentiels" value={stats.confidentiels} sub="bibliothèque Restricted" tone={stats.confidentiels ? 'violet' : 'grey'} icon="🔒" onClick={() => go('registre', { lib: RESTRICTED })} active={preset.lib === RESTRICTED} />
        </div>

        {!loaded && loading ? (
          <div className="card" style={{ marginTop: 16 }}>
            <EmptyState title="Chargement des documents…" icon="⏳" />
          </div>
        ) : loaded && !libs.length ? (
          <div className="card" style={{ marginTop: 16 }}>
            <EmptyState
              icon="🔐"
              title="Aucune bibliothèque accessible"
              sub="Votre compte n'a accès à aucune bibliothèque du Document Hub, ou l'application n'a pas encore l'accès au site. Contactez Alex Boyadjian."
            />
          </div>
        ) : (
          <DocumentList docs={docs} libs={libs} tab={tab} preset={preset} selectedKey={selectedKey} onSelect={setSelectedKey} />
        )}
      </div>

      {showUpload && (
        <UploadDialog
          libs={libs}
          docs={docs}
          onClose={() => setShowUpload(false)}
          onDone={(msg) => {
            setShowUpload(false);
            setToast(msg);
            void reload();
          }}
        />
      )}

      {selected && (
        <DocumentPanel
          doc={selected}
          docs={docs}
          onClose={() => setSelectedKey(null)}
          onChanged={(msg) => {
            if (msg) setToast(msg);
            void reload();
          }}
          onOpen={setSelectedKey}
        />
      )}

      {toast && (
        <div className="toast" onClick={() => setToast('')}>
          {toast}
        </div>
      )}
    </div>
  );
}
