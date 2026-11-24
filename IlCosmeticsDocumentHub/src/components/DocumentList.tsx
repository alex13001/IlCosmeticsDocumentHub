import { useEffect, useMemo, useState } from 'react';
import { ENTITIES, RESTRICTED, STATUTS } from '../config';
import { CATEGORIES } from '../taxonomy';
import { DocItem, Library, daysUntil, fmtDate } from '../docs';
import { Badge, EmptyState, STATUT_TONE } from '../ui';
import '../referentiel.css';

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
  /** Owners only: enables multi-selection and the move action (table view). */
  canMove?: boolean;
  onMove?: (docs: DocItem[]) => void;
}

type SortKey = 'code' | 'title' | 'entite' | 'categorie' | 'statut' | 'signature' | 'echeance' | 'created';
type ViewMode = 'explorer' | 'table';
type TreeMode = 'entity' | 'category';
const EMPTY = '__not_set__';

function tidy(value?: string): string { return value?.trim() || EMPTY; }
function displayName(value: string, kind: 'entity' | 'category' | 'sub'): string {
  if (value === EMPTY) return kind === 'entity' ? 'Entité non renseignée' : kind === 'category' ? 'À classer' : 'Sans sous-catégorie';
  return kind === 'category' ? value.replace(/^\d+\s*[—–-]\s*/, '') : value;
}
function strip(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
}
function keyOf(doc: DocItem) { return `${doc.library.name}/${doc.itemId}`; }
function ordered(values: string[], known: readonly string[]): string[] {
  return [...values].sort((a, b) => {
    if (a === EMPTY) return 1;
    if (b === EMPTY) return -1;
    const ai = known.indexOf(a);
    const bi = known.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'fr');
  });
}

export default function DocumentList({ docs, libs, tab, preset, selectedKey, onSelect, canMove = false, onMove }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [entite, setEntite] = useState('');
  const [cat, setCat] = useState('');
  const [sub, setSub] = useState('');
  const [statut, setStatut] = useState('');
  const [lib, setLib] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'created', asc: false });
  const [view, setView] = useState<ViewMode>('explorer');
  const [treeMode, setTreeMode] = useState<TreeMode>('entity');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Drop selected keys that no longer exist after a reload (moved / deleted documents).
  useEffect(() => {
    setPicked((prev) => (prev.size ? new Set([...prev].filter((k) => docs.some((d) => keyOf(d) === k))) : prev));
  }, [docs]);

  useEffect(() => {
    setStatut(preset.statut ?? '');
    setLib(preset.lib ?? '');
    setSort(tab === 'echeances' ? { key: 'echeance', asc: true } : { key: 'created', asc: false });
  }, [preset, tab]);

  // The tree is a virtual hierarchy of metadata, not SharePoint folders.
  // The underlying access controls and document URLs are unchanged.
  const base = useMemo(() => {
    const needle = strip(q.trim());
    return docs.filter((d) => {
      const f = d.fields;
      if (tab === 'atraiter' && f.Statut !== 'À signer' && f.Statut !== 'Envoyé') return false;
      if (tab === 'echeances') {
        const n = daysUntil(f.DateEcheance);
        if (n === null || n > 90 || f.Statut === 'Annulé') return false;
      }
      if (!showCancelled && !statut && f.Statut === 'Annulé') return false;
      if (statut && f.Statut !== statut) return false;
      if (lib && d.library.name !== lib) return false;
      if (!needle) return true;
      return strip([
        f.DocCode, f.Title, f.Entite, f.Categorie, f.SousCategorie, f.Contrepartie,
        f.Signataires, f.ResumeIA, f.Statut, d.fileName, fmtDate(f.DateSignature), fmtDate(f.DateEcheance),
      ].filter(Boolean).join(' ')).includes(needle);
    });
  }, [docs, q, tab, showCancelled, statut, lib]);

  const filtered = useMemo(() => {
    const val = (d: DocItem): string => {
      const f = d.fields;
      switch (sort.key) {
        case 'code': return f.DocCode ?? '';
        case 'title': return f.Title ?? '';
        case 'entite': return f.Entite ?? '';
        case 'categorie': return f.Categorie ?? '';
        case 'statut': return f.Statut ?? '';
        case 'signature': return f.DateSignature ?? '';
        case 'echeance': return f.DateEcheance ?? '9999';
        default: return d.created;
      }
    };
    return base.filter((d) => (!entite || tidy(d.fields.Entite) === entite)
      && (!cat || tidy(d.fields.Categorie) === cat)
      && (!sub || tidy(d.fields.SousCategorie) === sub))
      .sort((a, b) => (sort.asc ? 1 : -1) * val(a).localeCompare(val(b), 'fr'));
  }, [base, entite, cat, sub, sort]);

  const entities = useMemo(() => ordered([...new Set(base.map((d) => tidy(d.fields.Entite)))], ENTITIES), [base]);
  const categories = useMemo(() => ordered([...new Set(base.map((d) => tidy(d.fields.Categorie)))], CATEGORIES), [base]);
  const count = (entity = '', category = '', subcategory = '') => base.filter((d) =>
    (!entity || tidy(d.fields.Entite) === entity)
    && (!category || tidy(d.fields.Categorie) === category)
    && (!subcategory || tidy(d.fields.SousCategorie) === subcategory)).length;

  const selectPath = (entity: string, category: string, subcategory = '') => {
    setEntite(entity);
    setCat(category);
    setSub(subcategory);
  };
  const isExpanded = (id: string) => !!expanded[id];
  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const clearAll = () => { setQ(''); selectPath('', ''); setStatut(''); setLib(''); setShowCancelled(false); };
  const filtersActive = !!(q || entite || cat || sub || statut || lib);
  const selectFolder = (entity: string, category: string, subcategory: string) => {
    selectPath(entity, category, subcategory);
  };

  function treeRow(id: string, label: string, total: number, depth: number, active: boolean,
    path: { entity: string; category: string; sub: string }, hasChildren: boolean) {
    return (
      <div key={id} className={`catalog-tree-row${active ? ' active' : ''}`} style={{ paddingLeft: `${depth * 14 + 6}px` }}>
        {hasChildren ? (
          <button type="button" className="catalog-tree-arrow" aria-label={`${isExpanded(id) ? 'Replier' : 'Déplier'} ${label}`} aria-expanded={isExpanded(id)} onClick={() => toggle(id)}>
            {isExpanded(id) ? '▾' : '▸'}
          </button>
        ) : <span className="catalog-tree-arrow-spacer" />}
        <button type="button" className="catalog-tree-name" title={label} onClick={() => selectFolder(path.entity, path.category, path.sub)}>
          <span>{depth === 0 ? '📁' : hasChildren ? '📂' : '📄'}</span>
          <span className="catalog-tree-label">{label}</span>
        </button>
        <span className="catalog-tree-count">{total}</span>
      </div>
    );
  }

  const th = (key: SortKey, label: string) => (
    <th key={key} onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
      {label}{sort.key === key ? (sort.asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="card catalog-card">
      <div className="catalog-toolbar">
        <div className="catalog-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" aria-label="Rechercher un document" placeholder="Rechercher un contrat, une contrepartie, un code, un résumé IA…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" title="Effacer la recherche" onClick={() => setQ('')}>✕</button>}
        </div>
        <div className="catalog-view-switch" role="group" aria-label="Type de vue">
          <button className={view === 'explorer' ? 'on' : ''} onClick={() => setView('explorer')}>▦ Explorateur</button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>☷ Tableau</button>
        </div>
      </div>
      <div className="catalog-filter-bar">
        <select aria-label="Statut" value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">Tous statuts</option>
          {STATUTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        {libs.some((l) => l.name === RESTRICTED) && (
          <select aria-label="Bibliothèque SharePoint" value={lib} onChange={(e) => setLib(e.target.value)}>
            <option value="">Toutes bibliothèques</option>
            {libs.map((l) => <option key={l.name}>{l.name}</option>)}
          </select>
        )}
        <label className="catalog-cancelled"><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Inclure les annulés</label>
        {filtersActive && <button type="button" className="link-btn" onClick={clearAll}>Effacer les filtres</button>}
        <span className="catalog-total">{filtered.length} / {base.length} document(s)</span>
      </div>

      {view === 'explorer' ? (
        <div className="catalog-layout">
          <aside className="catalog-sidebar" aria-label="Arborescence documentaire">
            <div className="catalog-sidebar-title">Explorer par</div>
            <div className="catalog-tree-mode" role="group" aria-label="Ordre de classement">
              <button className={treeMode === 'entity' ? 'on' : ''} onClick={() => { setTreeMode('entity'); selectPath('', ''); }}>Entité</button>
              <button className={treeMode === 'category' ? 'on' : ''} onClick={() => { setTreeMode('category'); selectPath('', ''); }}>Catégorie</button>
            </div>
            <div className="catalog-tree" role="navigation" aria-label="Classement des documents">
              {treeRow('all', 'Tous les documents', base.length, 0, !entite && !cat && !sub,
                { entity: '', category: '', sub: '' }, false)}
              {treeMode === 'entity' ? entities.map((e) => {
                const eRows = base.filter((d) => tidy(d.fields.Entite) === e);
                const eCats = ordered([...new Set(eRows.map((d) => tidy(d.fields.Categorie)))], CATEGORIES);
                const eId = `e:${e}`;
                return (
                  <div key={eId}>
                    {treeRow(eId, displayName(e, 'entity'), eRows.length, 0, entite === e && !cat,
                      { entity: e, category: '', sub: '' }, true)}
                    {isExpanded(eId) && eCats.map((c) => {
                      const cRows = eRows.filter((d) => tidy(d.fields.Categorie) === c);
                      const subs = ordered([...new Set(cRows.map((d) => tidy(d.fields.SousCategorie)))], []);
                      const cId = `${eId}:c:${c}`;
                      return (
                        <div key={cId}>
                          {treeRow(cId, displayName(c, 'category'), cRows.length, 1, entite === e && cat === c && !sub,
                            { entity: e, category: c, sub: '' }, true)}
                          {isExpanded(cId) && subs.map((s) => treeRow(`${cId}:s:${s}`, displayName(s, 'sub'), count(e, c, s), 2,
                            entite === e && cat === c && sub === s, { entity: e, category: c, sub: s }, false))}
                        </div>
                      );
                    })}
                  </div>
                );
              }) : categories.map((c) => {
                const cRows = base.filter((d) => tidy(d.fields.Categorie) === c);
                const cEntities = ordered([...new Set(cRows.map((d) => tidy(d.fields.Entite)))], ENTITIES);
                const cId = `c:${c}`;
                return (
                  <div key={cId}>
                    {treeRow(cId, displayName(c, 'category'), cRows.length, 0, !entite && cat === c,
                      { entity: '', category: c, sub: '' }, true)}
                    {isExpanded(cId) && cEntities.map((e) => {
                      const eRows = cRows.filter((d) => tidy(d.fields.Entite) === e);
                      const subs = ordered([...new Set(eRows.map((d) => tidy(d.fields.SousCategorie)))], []);
                      const eId = `${cId}:e:${e}`;
                      return (
                        <div key={eId}>
                          {treeRow(eId, displayName(e, 'entity'), eRows.length, 1, entite === e && cat === c && !sub,
                            { entity: e, category: c, sub: '' }, true)}
                          {isExpanded(eId) && subs.map((s) => treeRow(`${eId}:s:${s}`, displayName(s, 'sub'), count(e, c, s), 2,
                            entite === e && cat === c && sub === s, { entity: e, category: c, sub: s }, false))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {!base.length && <div className="catalog-tree-empty">Aucun dossier pour les filtres choisis.</div>}
            </div>
            <div className="catalog-sidebar-tip">Classement virtuel basé sur les métadonnées SharePoint. Aucun fichier n'est déplacé.</div>
            {canMove && (
              <button type="button" className="link-btn" style={{ marginTop: 8 }} onClick={() => setView('table')}>
                ⇄ Déplacer plusieurs documents : passer en vue Tableau
              </button>
            )}
          </aside>
          <section className="catalog-content" aria-label="Documents du dossier">
            <div className="catalog-breadcrumb">
              <button onClick={() => selectPath('', '')}>Tous les documents</button>
              {entite && <><span>›</span><button onClick={() => selectPath(entite, '')}>{displayName(entite, 'entity')}</button></>}
              {cat && <><span>›</span><button onClick={() => selectPath(entite, cat)}>{displayName(cat, 'category')}</button></>}
              {sub && <><span>›</span><span className="catalog-breadcrumb-current">{displayName(sub, 'sub')}</span></>}
            </div>
            <div className="catalog-content-head">
              <div><strong>{sub ? displayName(sub, 'sub') : cat ? displayName(cat, 'category') : entite ? displayName(entite, 'entity') : 'Bibliothèque du groupe'}</strong>
                <span>{filtered.length} document(s) · PDF et contrats accessibles</span></div>
              <select aria-label="Trier les résultats" value={`${sort.key}:${sort.asc ? 'asc' : 'desc'}`}
                onChange={(e) => { const [key, order] = e.target.value.split(':'); setSort({ key: key as SortKey, asc: order === 'asc' }); }}>
                <option value="created:desc">Plus récents</option>
                <option value="title:asc">Objet A → Z</option>
                <option value="echeance:asc">Échéances proches</option>
                <option value="code:asc">Code A → Z</option>
              </select>
            </div>
            {filtered.length ? (
              <div className="catalog-document-list">
                {filtered.map((d) => {
                  const f = d.fields;
                  const n = f.Statut === 'Annulé' ? null : daysUntil(f.DateEcheance);
                  const key = keyOf(d);
                  return (
                    <button key={key} type="button" className={`catalog-document${selectedKey === key ? ' selected' : ''}`}
                      onClick={() => onSelect(key)} aria-label={`Ouvrir ${f.Title || d.fileName}`}>
                      <div className="catalog-document-icon" aria-hidden="true">📄</div>
                      <div className="catalog-document-main">
                        <div className="catalog-document-title">{f.Title || d.fileName}</div>
                        <div className="catalog-document-meta">
                          <span className="code">{f.DocCode || 'Sans code'}</span>
                          <span>{f.Entite || 'Sans entité'}</span>
                          {f.Contrepartie && <span>{f.Contrepartie}</span>}
                          {d.library.name === RESTRICTED && <span>🔒 Confidentiel</span>}
                        </div>
                        {f.ResumeIA && <div className="catalog-document-summary">{f.ResumeIA}</div>}
                        <div className="catalog-document-category">{displayName(tidy(f.Categorie), 'category')}{f.SousCategorie ? ` / ${f.SousCategorie}` : ''}</div>
                      </div>
                      <div className="catalog-document-side">
                        <Badge tone={STATUT_TONE[f.Statut ?? ''] ?? 'grey'}>{f.Statut || 'Sans statut'}</Badge>
                        {f.DateEcheance && <span className={`catalog-document-due${n !== null && n < 0 ? ' late' : n !== null && n <= 90 ? ' soon' : ''}`}>
                          Échéance : {fmtDate(f.DateEcheance)}
                        </span>}
                        <span className="catalog-document-open">Voir la fiche ›</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : <EmptyState icon={docs.length ? '🔎' : '🗂️'} title={docs.length ? 'Aucun document dans cette sélection' : 'Le registre est vide'}
              sub={docs.length ? 'Changez de dossier ou effacez les filtres.' : 'Déposez votre premier document.'} />}
          </section>
        </div>
      ) : (
        <>
          <div className="catalog-table-shortcuts">
            <div className="chips">
              <button className={`chip${!entite ? ' on' : ''}`} onClick={() => selectPath('', cat, '')}>Toutes entités</button>
              {ordered([...new Set(docs.map((d) => tidy(d.fields.Entite)))], ENTITIES).map((e) => (
                <button key={e} className={`chip${entite === e ? ' on' : ''}`} onClick={() => selectPath(entite === e ? '' : e, cat, '')}>
                  {displayName(e, 'entity')}
                </button>
              ))}
            </div>
            <select aria-label="Catégorie" value={cat} onChange={(e) => selectPath(entite, e.target.value, '')}>
              <option value="">Toutes catégories</option>
              {ordered([...new Set(docs.map((d) => tidy(d.fields.Categorie)))], CATEGORIES).map((c) => (
                <option key={c} value={c}>{displayName(c, 'category')}</option>
              ))}
            </select>
          </div>
          {canMove && (
            <div className="move-bar">
              <span className="small">
                {picked.size ? <><strong>{picked.size}</strong> document(s) sélectionné(s)</> : 'Cochez les documents mal classés pour les déplacer vers la bonne entité.'}
              </span>
              {picked.size > 0 && (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => onMove?.(docs.filter((d) => picked.has(keyOf(d))))}>
                    ⇄ Déplacer vers une autre entité
                  </button>
                  <button type="button" className="link-btn" onClick={() => setPicked(new Set())}>Tout désélectionner</button>
                </>
              )}
            </div>
          )}
          {filtered.length ? (
            <div className="table-wrap"><table className="grid">
              <thead><tr>{canMove && (
                <th style={{ width: 32 }} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label="Tout sélectionner"
                    checked={filtered.length > 0 && filtered.every((d) => picked.has(keyOf(d)))}
                    onChange={(e) => setPicked((prev) => {
                      const next = new Set(prev);
                      filtered.forEach((d) => (e.target.checked ? next.add(keyOf(d)) : next.delete(keyOf(d))));
                      return next;
                    })} />
                </th>
              )}{th('code', 'Code')}{th('title', 'Objet')}{th('entite', 'Entité')}{th('categorie', 'Catégorie')}<th>Contrepartie</th>{th('statut', 'Statut')}{th('signature', 'Signé le')}{th('echeance', 'Échéance')}</tr></thead>
              <tbody>{filtered.map((d) => {
                const key = keyOf(d);
                const f = d.fields;
                const n = f.Statut === 'Annulé' ? null : daysUntil(f.DateEcheance);
                return (
                  <tr key={key} className={key === selectedKey ? 'sel' : ''} onClick={() => onSelect(key)}>
                    {canMove && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Sélectionner ${f.DocCode ?? ''}`} checked={picked.has(key)}
                          onChange={(e) => setPicked((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(key); else next.delete(key);
                            return next;
                          })} />
                      </td>
                    )}
                    <td><span className="code">{f.DocCode ?? '—'}</span>{d.library.name === RESTRICTED && <Badge tone="violet" small>🔒</Badge>}</td>
                    <td><div className="cell-title">{f.Title || d.fileName}</div>{f.ResumeIA && <div className="cell-sub">{f.ResumeIA.slice(0, 90)}{f.ResumeIA.length > 90 ? '…' : ''}</div>}</td>
                    <td>{f.Entite}</td>
                    <td><div>{displayName(tidy(f.Categorie), 'category')}</div>{f.SousCategorie && <div className="cell-sub">{f.SousCategorie}</div>}</td>
                    <td>{f.Contrepartie}</td>
                    <td><Badge tone={STATUT_TONE[f.Statut ?? ''] ?? 'grey'}>{f.Statut}</Badge></td>
                    <td>{fmtDate(f.DateSignature)}</td>
                    <td className={n !== null && n < 0 ? 'late' : n !== null && n <= 90 ? 'soon' : ''}>{fmtDate(f.DateEcheance)}
                      {n !== null && n < 0 && <div className="cell-sub late">dépassée</div>}
                      {n !== null && n >= 0 && n <= 90 && <div className="cell-sub soon">dans {n} j</div>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <EmptyState icon={docs.length ? '🔎' : '🗂️'} title={docs.length ? 'Aucun document ne correspond' : 'Le registre est vide'} sub="Modifiez les filtres ou la recherche." />}
        </>
      )}
      <div className="table-foot">{filtered.length} document(s) affiché(s) sur {docs.length}. Recherche dans les métadonnées et résumés IA, pas encore dans le texte complet des PDF.</div>
    </div>
  );
}
