import { useMemo, useState } from 'react';
import { ENTITIES, STATUTS } from '../config';
import { CATEGORIES } from '../taxonomy';
import { DocItem, Library, fmtDate } from '../docs';

interface Props {
  docs: DocItem[];
  libs: Library[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

export default function DocumentList({ docs, libs, selectedKey, onSelect }: Props) {
  const [q, setQ] = useState('');
  const [entite, setEntite] = useState('');
  const [cat, setCat] = useState('');
  const [statut, setStatut] = useState('');
  const [lib, setLib] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter((d) => {
      const f = d.fields;
      if (entite && f.Entite !== entite) return false;
      if (cat && f.Categorie !== cat) return false;
      if (statut && f.Statut !== statut) return false;
      if (lib && d.library.name !== lib) return false;
      if (!needle) return true;
      return [f.DocCode, f.Title, f.Contrepartie, f.SousCategorie, f.Signataires, f.ResumeIA, d.fileName]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    });
  }, [docs, q, entite, cat, statut, lib]);

  return (
    <>
      <div className="filters">
        <input placeholder="Rechercher (code, objet, contrepartie, résumé…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={entite} onChange={(e) => setEntite(e.target.value)}>
          <option value="">Toutes entités</option>
          {ENTITIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
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
        <select value={lib} onChange={(e) => setLib(e.target.value)}>
          <option value="">Toutes bibliothèques</option>
          {libs.map((l) => (
            <option key={l.name}>{l.name}</option>
          ))}
        </select>
        <span className="muted">{filtered.length} document(s)</span>
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>Code</th>
            <th>Objet</th>
            <th>Entité</th>
            <th>Catégorie</th>
            <th>Contrepartie</th>
            <th>Statut</th>
            <th>Signé le</th>
            <th>Échéance</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((d) => {
            const key = `${d.library.name}/${d.itemId}`;
            const f = d.fields;
            const expired = f.DateEcheance && new Date(f.DateEcheance) < new Date() && f.Statut !== 'Annulé';
            return (
              <tr key={key} className={key === selectedKey ? 'sel' : ''} onClick={() => onSelect(key)}>
                <td className="mono">
                  {f.DocCode ?? <i className="muted">sans code</i>}
                  {d.library.name === 'Restricted' && <span className="tag">confidentiel</span>}
                </td>
                <td>{f.Title}</td>
                <td>{f.Entite}</td>
                <td title={f.SousCategorie}>{f.Categorie?.replace(/^\d+ — /, '')}</td>
                <td>{f.Contrepartie}</td>
                <td>
                  <span className={`status s-${(f.Statut ?? '').normalize('NFD').replace(/[^a-zA-Z]/g, '')}`}>{f.Statut}</span>
                </td>
                <td>{fmtDate(f.DateSignature)}</td>
                <td className={expired ? 'warn' : ''}>{fmtDate(f.DateEcheance)}</td>
              </tr>
            );
          })}
          {!filtered.length && (
            <tr>
              <td colSpan={8} className="muted center-cell">
                Aucun document.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
