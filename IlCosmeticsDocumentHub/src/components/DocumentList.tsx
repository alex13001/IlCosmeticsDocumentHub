import { useEffect, useMemo, useState } from 'react';
import { ENTITIES, RESTRICTED, STATUTS } from '../config';
import { CATEGORIES } from '../taxonomy';
import { DocItem, Library, daysUntil, fmtDate } from '../docs';
import { Badge, EmptyState, STATUT_TONE } from '../ui';

export interface Preset {
  statut?: string;
  lib?: string;
}

interface Props {
  docs: DocItem[];
  libs: Library[];
  tab: 'registre' | 'atraiter' | 'echeances';
  preset: Preset;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

type SortKey = 'code' | 'title' | 'entite' | 'categorie' | 'statut' | 'signature' | 'echeance' | 'created';

export default function DocumentList({ docs, libs, tab, preset, selectedKey, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [entite, setEntite] = useState('');
  const [cat, setCat] = useState('');
  const [statut, setStatut] = useState('');
  const [lib, setLib] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'created', asc: false });

  useEffect(() => {
    setStatut(preset.statut ?? '');
    setLib(preset.lib ?? '');
    setSort(tab === 'echeances' ? { key: 'echeance', asc: true } : { key: 'created', asc: false });
  }, [preset, tab]);

  const entityChips = useMemo(() => {
    const accessible = new Set(libs.map((l) => l.name));
    return ENTITIES.filter((e) => accessible.has(e) || docs.some((d) => d.fields.Entite === e));
  }, [libs, docs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = docs.filter((d) => {
      const f = d.fields;
      if (tab === 'atraiter' && f.Statut !== 'À signer' && f.Statut !== 'Envoyé') return false;
      if (tab === 'echeances') {
        const n = daysUntil(f.DateEcheance);
        if (n === null || n > 90 || f.Statut === 'Annulé') return false;
      }
      if (!showCancelled && !statut && f.Statut === 'Annulé') return false;
      if (entite && f.Entite !== entite) return false;
      if (cat && f.Categorie !== cat) return false;
      if (statut && f.Statut !== statut) return false;
      if (lib && d.library.name !== lib) return false;
      if (!needle) return true;
      return [f.DocCode, f.Title, f.Contrepartie, f.SousCategorie, f.Signataires, f.ResumeIA, d.fileName]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    });
    const val = (d: DocItem): string => {
      const f = d.fields;
      switch (sort.key) {
        case 'code': return f.DocCode ?? '';
        case 'title': return (f.Title ?? '').toLowerCase();
        case 'entite': return f.Entite ?? '';
        case 'categorie': return f.Categorie ?? '';
        case 'statut': return f.Statut ?? '';
        case 'signature': return f.DateSignature ?? '';
        case 'echeance': return f.DateEcheance ?? '9999';
        default: return d.created;
      }
    };
    return rows.sort((a, b) => (sort.asc ? 1 : -1) * val(a).localeCompare(val(b)));
  }, [docs, q, entite, cat, statut, lib, tab, showCancelled, sort]);

  const th = (key: SortKey, label: string) => (
    <th onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
      {label}
      {sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const anyFilter = q || entite || cat || statut || lib;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="filters">
        <div className="search">
          <input placeholder="Rechercher un code, un objet, une contrepartie, un résumé…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Toutes catégories</option>
          {CATEGORIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">Tous statuts</option>
          {STATUTS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        {libs.some((l) => l.name === RESTRICTED) && (
          <select value={lib} onChange={(e) => setLib(e.target.value)}>
            <option value="">Toutes bibliothèques</option>
            {libs.map((l) => (
              <option key={l.name}>{l.name}</option>
            ))}
          </select>
        )}
        {anyFilter && (
          <button className="link-btn" onClick={() => { setQ(''); setEntite(''); setCat(''); setStatut(''); setLib(''); }}>
            Effacer les filtres
          </button>
        )}
      </div>
      <div className="filters">
        <div className="chips">
          <button className={`chip${!entite ? ' on' : ''}`} onClick={() => setEntite('')}>
            Toutes entités
          </button>
          {entityChips.map((e) => (
            <button key={e} className={`chip${entite === e ? ' on' : ''}`} onClick={() => setEntite(entite === e ? '' : e)}>
              {e}
            </button>
          ))}
        </div>
        <label className="small muted" style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Afficher les annulés
        </label>
      </div>

      {filtered.length ? (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                {th('code', 'Code')}
                {th('title', 'Objet')}
                {th('entite', 'Entité')}
                {th('categorie', 'Catégorie')}
                <th>Contrepartie</th>
                {th('statut', 'Statut')}
                {th('signature', 'Signé le')}
                {th('echeance', 'Échéance')}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const key = `${d.library.name}/${d.itemId}`;
                const f = d.fields;
                const n = f.Statut === 'Annulé' ? null : daysUntil(f.DateEcheance);
                return (
                  <tr key={key} className={key === selectedKey ? 'sel' : ''} onClick={() => onSelect(key)}>
                    <td>
                      <span className="code">{f.DocCode ?? '—'}</span>
                      {d.library.name === RESTRICTED && (
                        <>
                          {' '}
                          <Badge tone="violet" small>🔒 confidentiel</Badge>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="cell-title">{f.Title}</div>
                      {f.ResumeIA && <div className="cell-sub">{f.ResumeIA.slice(0, 90)}{f.ResumeIA.length > 90 ? '…' : ''}</div>}
                    </td>
                    <td>{f.Entite}</td>
                    <td>
                      <div>{f.Categorie?.replace(/^\d+ — /, '')}</div>
                      {f.SousCategorie && <div className="cell-sub">{f.SousCategorie}</div>}
                    </td>
                    <td>{f.Contrepartie}</td>
                    <td>
                      <Badge tone={STATUT_TONE[f.Statut ?? ''] ?? 'grey'}>{f.Statut}</Badge>
                    </td>
                    <td>{fmtDate(f.DateSignature)}</td>
                    <td className={n !== null && n < 0 ? 'late' : n !== null && n <= 90 ? 'soon' : ''}>
                      {fmtDate(f.DateEcheance)}
                      {n !== null && n < 0 && <div className="cell-sub late">dépassée</div>}
                      {n !== null && n >= 0 && n <= 90 && <div className="cell-sub soon">dans {n} j</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={docs.length ? '🔎' : '🗂️'}
          title={docs.length ? 'Aucun document ne correspond' : 'Le registre est vide'}
          sub={docs.length ? 'Modifiez les filtres ou la recherche.' : 'Déposez un premier document avec le bouton « Déposer un document ».'}
        />
      )}
      {filtered.length > 0 && <div className="table-foot">{filtered.length} document(s) affiché(s) sur {docs.length}</div>}
    </div>
  );
}
