import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import { initAuth, login, logout } from './auth';
import { DocItem, Library, getLibraries, loadDocuments } from './docs';
import { GraphError } from './graph';
import DocumentList from './components/DocumentList';
import UploadDialog from './components/UploadDialog';
import DocumentPanel from './components/DocumentPanel';

export default function App() {
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined);
  const [libs, setLibs] = useState<Library[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    initAuth()
      .then(setAccount)
      .catch((e) => {
        setError(String(e?.message ?? e));
        setAccount(null);
      });
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const l = await getLibraries();
      setLibs(l);
      const all = await Promise.all(l.map(loadDocuments));
      setDocs(all.flat().sort((a, b) => b.created.localeCompare(a.created)));
    } catch (e) {
      const ge = e as GraphError;
      setError(
        ge.status === 403 || ge.status === 404
          ? "Accès au site refusé. L'application n'a pas encore reçu l'accès au site SharePoint (action IT), ou votre compte n'a aucun droit."
          : `Erreur de chargement : ${ge.message}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) void reload();
  }, [account, reload]);

  const selected = useMemo(
    () => docs.find((d) => `${d.library.name}/${d.itemId}` === selectedKey) ?? null,
    [docs, selectedKey],
  );

  if (account === undefined) return <div className="center">Chargement…</div>;

  if (!account) {
    return (
      <div className="center">
        <div className="login-card">
          <h1>IL Cosmetics Document Hub</h1>
          <p>Registre et archivage des documents officiels du groupe.</p>
          <button className="primary" onClick={() => void login()}>
            Se connecter avec Microsoft
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div className="brand">IL Cosmetics · Document Hub</div>
        <div className="user">
          <span>{account.name}</span>
          <button className="link" onClick={() => void logout()}>
            Déconnexion
          </button>
        </div>
      </header>

      <main>
        <div className="toolbar">
          <button className="primary" disabled={!libs.length} onClick={() => setShowUpload(true)}>
            + Déposer un document
          </button>
          <button onClick={() => void reload()} disabled={loading}>
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
          <span className="muted">
            {libs.length ? `Bibliothèques accessibles : ${libs.map((l) => l.name).join(', ')}` : ''}
          </span>
        </div>

        {error && <div className="banner error">{error}</div>}
        {notice && (
          <div className="banner ok" onClick={() => setNotice('')}>
            {notice}
          </div>
        )}

        <DocumentList docs={docs} libs={libs} selectedKey={selectedKey} onSelect={setSelectedKey} />
      </main>

      {showUpload && (
        <UploadDialog
          libs={libs}
          docs={docs}
          onClose={() => setShowUpload(false)}
          onDone={(msg) => {
            setShowUpload(false);
            setNotice(msg);
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
            if (msg) setNotice(msg);
            void reload();
          }}
          onOpen={setSelectedKey}
        />
      )}
    </div>
  );
}
