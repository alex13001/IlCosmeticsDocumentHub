import { useMemo, useState, type DragEvent } from 'react';
import { ENTITIES, ORIGINES, RESTRICTED, TYPES_SIGNATURE } from '../config';
import { CATEGORIES, HR_CATEGORY, subsOf } from '../taxonomy';
import { DocItem, Library, createDocument, parseEmails } from '../docs';
import { isPdf } from '../pdf';
import { analyzeDocument, type AnalysisResult } from '../ai';
import { Badge, Field, Section } from '../ui';

interface Props {
  libs: Library[];
  docs: DocItem[];
  onClose: () => void;
  onDone: (message: string) => void;
}

/** One file of the batch: what differs from one document to the next (objet, date, résumé). */
interface Item {
  id: string;
  file: File;
  title: string;
  dateSignature: string;
  resumeIA: string;
  status: 'pending' | 'analyzing' | 'saving' | 'done' | 'error';
  code?: string;
  message?: string;
  analysis?: AnalysisResult;
}

const MAX_FILES = 20;

const titleFromName = (name: string) => name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();

export default function UploadDialog({ libs, docs, onClose, onDone }: Props) {
  const libByName = useMemo(() => new Map(libs.map((l) => [l.name, l])), [libs]);
  const hasRestricted = libByName.has(RESTRICTED);
  const entityChoices = ENTITIES.filter((e) => libByName.has(e) || hasRestricted);

  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [mode, setMode] = useState<'aSigner' | 'signe' | 'aucune'>('aSigner');
  const [entite, setEntite] = useState<string>(entityChoices[0] ?? '');
  const [categorie, setCategorie] = useState('');
  const [sousCategorie, setSousCategorie] = useState('');
  const [confidentiel, setConfidentiel] = useState(false);
  const [contrepartie, setContrepartie] = useState('');
  const [signataires, setSignataires] = useState('');
  const [typeSignature, setTypeSignature] = useState('Manuscrite');
  const [origine, setOrigine] = useState<string>('Flux');
  const [dateEffet, setDateEffet] = useState('');
  const [dateEcheance, setDateEcheance] = useState('');
  const [parentItemId, setParentItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  const multi = items.length > 1;
  const single = items.length === 1 ? items[0] : null;
  const open = items.filter((i) => i.status !== 'done');
  const doneItems = items.filter((i) => i.status === 'done');
  const locked = busy || analyzing || doneItems.length > 0;

  const isHR = categorie === HR_CATEGORY;
  const targetName = isHR || confidentiel ? RESTRICTED : entite;
  const target = libByName.get(targetName);
  const parentCandidates = docs.filter((d) => d.library.name === targetName && d.fields.DocCode && d.fields.Entite === entite);

  const patch = (id: string, p: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const addFiles = (list: FileList | File[] | null | undefined) => {
    if (!list) return;
    const incoming = Array.from(list);
    setError('');
    setItems((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (next.some((i) => i.file.name === f.name && i.file.size === f.size)) continue; // same file dropped twice
        if (next.length >= MAX_FILES) {
          setError(`${MAX_FILES} fichiers maximum par dépôt.`);
          break;
        }
        next.push({ id: `${Date.now()}-${Math.random()}`, file: f, title: titleFromName(f.name), dateSignature: '', resumeIA: '', status: 'pending' });
      }
      return next;
    });
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));

  /** Shared fields come from the first analysed file; objet / date / résumé are set per file. */
  function applyShared(a: AnalysisResult) {
    if (a.entite && entityChoices.includes(a.entite as (typeof entityChoices)[number])) setEntite(a.entite);
    if (a.categorie && CATEGORIES.includes(a.categorie)) {
      setCategorie(a.categorie);
      setSousCategorie(a.sousCategorie && subsOf(a.categorie).includes(a.sousCategorie) ? a.sousCategorie : '');
    }
    if (a.contrepartie) setContrepartie(a.contrepartie);
    if (a.dateEffet) setDateEffet(a.dateEffet);
    if (a.dateEcheance) setDateEcheance(a.dateEcheance);
    if (a.confidentialite === 'Restricted' || a.categorie === HR_CATEGORY) setConfidentiel(true);
  }

  async function runAnalysis() {
    const todo = items.filter((i) => i.status === 'pending' && isPdf(i.file));
    if (!todo.length) return;
    setAnalyzing(true);
    setError('');
    let first = true;
    for (const it of todo) {
      patch(it.id, { status: 'analyzing', message: undefined });
      try {
        const a = await analyzeDocument(it.file);
        patch(it.id, {
          status: 'pending',
          analysis: a,
          title: a.title || it.title,
          dateSignature: a.dateSignature || it.dateSignature,
          resumeIA: a.resumeIA || it.resumeIA,
          message: a.warning,
        });
        if (first) applyShared(a);
        first = false;
      } catch (e) {
        patch(it.id, { status: 'pending', message: `Analyse impossible : ${(e as Error).message}` });
      }
    }
    setAnalyzing(false);
  }

  const problems: string[] = [];
  if (!items.length) problems.push('Ajoutez au moins un fichier PDF');
  if (items.some((i) => !isPdf(i.file))) problems.push('Seuls les PDF sont acceptés : retirez les autres fichiers');
  if (!entite) problems.push('Choisissez l’entité');
  if (open.some((i) => !i.title.trim())) problems.push(multi ? 'Renseignez l’objet de chaque fichier' : 'Renseignez l’objet');
  if (!categorie) problems.push('Choisissez la catégorie');
  if (mode === 'signe' && open.some((i) => !i.dateSignature)) problems.push(multi ? 'Renseignez la date de signature de chaque fichier' : 'Renseignez la date de signature');
  if (mode !== 'aucune' && signataires && !parseEmails(signataires).length) problems.push('E-mails des signataires invalides');
  if (!target) {
    problems.push(
      targetName === RESTRICTED
        ? 'Les documents RH ou confidentiels ne peuvent être déposés que par la Direction'
        : `Vous n'avez pas accès à la bibliothèque ${targetName}`,
    );
  }

  async function submit() {
    if (problems.length || !target || analyzing || !open.length) return;
    setBusy(true);
    setError('');
    const codes = doneItems.map((i) => i.code!);
    const warnings: string[] = [];
    let failed = 0;
    // Sequential on purpose: each upload gets its own SharePoint ID, hence its own code, in drop order.
    for (const it of open) {
      patch(it.id, { status: 'saving', message: undefined });
      try {
        const r = await createDocument({
          library: target,
          entite,
          file: it.file,
          mode,
          title: it.title.trim(),
          categorie,
          sousCategorie,
          contrepartie: contrepartie.trim(),
          signataires: mode === 'aucune' ? '' : parseEmails(signataires).join('; '),
          typeSignature: mode === 'aucune' ? '' : mode === 'signe' || signataires ? typeSignature : '',
          origine: mode === 'aSigner' ? 'Flux' : origine,
          dateSignature: it.dateSignature,
          dateEffet,
          dateEcheance,
          resumeIA: it.resumeIA.trim(),
          parentItemId,
        });
        codes.push(r.code);
        if (r.warning) warnings.push(`${r.code} : ${r.warning}`);
        patch(it.id, { status: 'done', code: r.code, message: r.warning });
      } catch (e) {
        failed++;
        patch(it.id, { status: 'error', message: (e as Error).message });
      }
    }
    setBusy(false);
    if (!failed) {
      onDone(summary(codes) + (warnings.length ? ` Attention : ${warnings.join(' · ')}` : ''));
    } else {
      setError(`${failed} fichier(s) en échec : corrigez puis cliquez à nouveau sur Enregistrer. Les fichiers déjà enregistrés ne seront pas redéposés.`);
    }
  }

  const summary = (codes: string[]) =>
    codes.length === 1 ? `Document enregistré sous le code ${codes[0]}.` : `${codes.length} documents enregistrés : ${codes.join(', ')}.`;

  const close = () => {
    // Some files may already be saved after a partial failure: refresh the list in that case.
    if (doneItems.length) onDone(summary(doneItems.map((i) => i.code!)));
    else onClose();
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (!locked) addFiles(e.dataTransfer.files);
    },
  };

  const statusBadge = (i: Item) =>
    i.status === 'done' ? (
      <Badge tone="green" small>✓ {i.code}</Badge>
    ) : i.status === 'saving' ? (
      <Badge tone="blue" small>Enregistrement…</Badge>
    ) : i.status === 'analyzing' ? (
      <Badge tone="violet" small>Analyse IA…</Badge>
    ) : i.status === 'error' ? (
      <Badge tone="red" small>Échec</Badge>
    ) : null;

  const firstAnalysis = items.find((i) => i.analysis)?.analysis ?? null;

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <h2>{multi ? `Déposer ${items.length} documents` : 'Déposer un document'}</h2>
          <button className="modal-close" onClick={close} disabled={busy || analyzing}>
            ✕ Fermer
          </button>
        </div>

        <div className="modal-body">
          <Section title={multi ? `Fichiers (${items.length})` : 'Fichier'}>
            {single && (
              <div className="file-ok">
                📄 {single.file.name} <span className="small">({Math.round(single.file.size / 1024)} Ko)</span>
                {statusBadge(single)}
                {!locked && (
                  <button className="remove" onClick={() => removeItem(single.id)} title="Retirer">
                    ✕
                  </button>
                )}
              </div>
            )}

            {multi && (
              <div className="table-wrap">
                <table className="grid batch">
                  <thead>
                    <tr>
                      <th>Fichier</th>
                      <th>Objet *</th>
                      {mode === 'signe' && <th>Signé le *</th>}
                      <th>Résumé</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => {
                      const ro = i.status === 'done' || busy || analyzing;
                      return (
                        <tr key={i.id}>
                          <td className="batch-file">
                            <div>📄 {i.file.name}</div>
                            <div className="small faint">{Math.round(i.file.size / 1024)} Ko</div>
                            {statusBadge(i)}
                            {i.message && <div className="small" style={{ color: i.status === 'error' ? 'var(--red)' : 'var(--orange)' }}>{i.message}</div>}
                          </td>
                          <td>
                            <input value={i.title} disabled={ro} onChange={(e) => patch(i.id, { title: e.target.value })} />
                          </td>
                          {mode === 'signe' && (
                            <td>
                              <input type="date" value={i.dateSignature} disabled={ro} onChange={(e) => patch(i.id, { dateSignature: e.target.value })} />
                            </td>
                          )}
                          <td>
                            <textarea rows={2} value={i.resumeIA} disabled={ro} onChange={(e) => patch(i.id, { resumeIA: e.target.value })} placeholder="Montant, période, prestation…" />
                          </td>
                          <td>
                            {i.status !== 'done' && !busy && !analyzing && (
                              <button className="remove" onClick={() => removeItem(i.id)} title="Retirer">
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!locked && items.length < MAX_FILES && (
              <label className={`dropzone${over ? ' over' : ''}${items.length ? ' compact' : ''}`} {...dropProps}>
                <input
                  type="file"
                  multiple
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                {items.length ? (
                  <div>
                    + Ajouter d'autres PDF (glisser ou <strong>cliquer</strong>)
                  </div>
                ) : (
                  <>
                    <div className="dropzone-icon">📥</div>
                    <div>
                      Glissez un ou plusieurs PDF ici ou <strong>cliquez pour choisir</strong>
                    </div>
                    <div className="small faint" style={{ marginTop: 4 }}>
                      Plusieurs fichiers : la fiche (entité, catégorie, contrepartie…) est saisie une fois et appliquée à tous. Chaque fichier reçoit son propre code.
                    </div>
                  </>
                )}
              </label>
            )}

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!items.some((i) => i.status === 'pending' && isPdf(i.file)) || analyzing || busy}
                onClick={() => void runAnalysis()}
              >
                {analyzing ? 'Analyse IA en cours…' : multi ? `✨ Analyser les ${open.length} fichiers avec l’IA` : '✨ Analyser avec l’IA'}
              </button>
              <span className="small muted">
                Sur demande uniquement · {multi ? 'La fiche commune est pré-remplie à partir du premier fichier.' : 'Vérifiez les propositions avant d’enregistrer.'}
              </span>
            </div>

            {firstAnalysis && (
              <div style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 12, marginTop: 12 }}>
                <strong>Analyse terminée — informations à valider</strong>
                {!multi && firstAnalysis.warning && <p className="small" style={{ color: 'var(--red)' }}>{firstAnalysis.warning}</p>}
                <p className="small">{firstAnalysis.justification || 'Vérifiez les dates, la société et le classement proposés.'}</p>
                {firstAnalysis.pointsVigilance.length > 0 && (
                  <div className="small">
                    <strong>Points de vigilance{multi ? ' (premier fichier)' : ''} :</strong>
                    <ul>{firstAnalysis.pointsVigilance.map((x, k) => <li key={k}>{x}</li>)}</ul>
                  </div>
                )}
                {!multi && firstAnalysis.sources.length > 0 && <div className="small"><strong>Sources :</strong> {firstAnalysis.sources.join(' · ')}</div>}
                <p className="small muted">L'IA ne valide ni les signatures ni le caractère officiel du document.</p>
              </div>
            )}

            <div className="modes" style={{ marginTop: 12 }}>
              <button type="button" className={`mode${mode === 'aSigner' ? ' on' : ''}`} disabled={locked} onClick={() => setMode('aSigner')}>
                <div className="mode-title">✍️ À signer</div>
                <div className="mode-sub">Le code est apposé sur chaque page, puis le PDF est envoyé au signataire.</div>
              </button>
              <button type="button" className={`mode${mode === 'signe' ? ' on' : ''}`} disabled={locked} onClick={() => setMode('signe')}>
                <div className="mode-title">✅ Déjà signé</div>
                <div className="mode-sub">Archivage d’un document signé. Le PDF n’est pas modifié.</div>
              </button>
              <button type="button" className={`mode${mode === 'aucune' ? ' on' : ''}`} disabled={locked} onClick={() => setMode('aucune')}>
                <div className="mode-title">📄 Pas de signature</div>
                <div className="mode-sub">Rien à signer de notre côté (autorisation, certificat, courrier reçu). Archivé tel quel.</div>
              </button>
            </div>
          </Section>

          <Section
            title={multi ? 'Classement commun' : 'Classement'}
            right={<Badge tone={targetName === RESTRICTED ? 'violet' : 'green'}>Destination : {targetName === RESTRICTED ? '🔒 Restricted' : targetName}</Badge>}
          >
            <div className="grid2">
              <Field label="Entité" required>
                <select value={entite} disabled={locked} onChange={(e) => setEntite(e.target.value)}>
                  {entityChoices.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              {single ? (
                <Field label="Objet" required>
                  <input value={single.title} disabled={locked} onChange={(e) => patch(single.id, { title: e.target.value })} placeholder="Ex. Contrat de leasing ligne 3" />
                </Field>
              ) : (
                <div />
              )}
              <Field label="Catégorie" required>
                <select
                  value={categorie}
                  disabled={locked}
                  onChange={(e) => {
                    setCategorie(e.target.value);
                    setSousCategorie('');
                  }}
                >
                  <option value="">— Choisir —</option>
                  {CATEGORIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sous-catégorie">
                <select value={sousCategorie} onChange={(e) => setSousCategorie(e.target.value)} disabled={!categorie || locked}>
                  <option value="">—</option>
                  {subsOf(categorie).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Contrepartie" full>
                <input value={contrepartie} disabled={locked} onChange={(e) => setContrepartie(e.target.value)} placeholder="Banque, fournisseur, client, administration…" />
              </Field>
              {hasRestricted && (
                <label className={`check full${isHR ? ' locked' : ''}`} style={{ gridColumn: '1 / -1' }}>
                  <input type="checkbox" checked={isHR || confidentiel} disabled={isHR || locked} onChange={(e) => setConfidentiel(e.target.checked)} />
                  🔒 Confidentiel — bibliothèque Restricted, visible par la Direction uniquement{isHR ? ' (obligatoire pour les RH)' : ''}
                </label>
              )}
            </div>
          </Section>

          <Section title={mode === 'aucune' ? 'Dates' : 'Signature et dates'}>
            <div className="grid3">
              {mode !== 'aucune' && (
                <>
                  <Field label="Signataires (e-mails, séparés par ;)" full>
                    <input value={signataires} disabled={locked} onChange={(e) => setSignataires(e.target.value)} placeholder="jf.harpes@ilcosmetics.com" />
                  </Field>
                  <Field label="Type de signature">
                    <select value={typeSignature} disabled={locked} onChange={(e) => setTypeSignature(e.target.value)}>
                      {TYPES_SIGNATURE.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              {mode === 'signe' && single && (
                <Field label="Date de signature" required>
                  <input type="date" value={single.dateSignature} disabled={locked} onChange={(e) => patch(single.id, { dateSignature: e.target.value })} />
                </Field>
              )}
              {mode !== 'aSigner' && (
                <Field label="Origine">
                  <select value={origine} disabled={locked} onChange={(e) => setOrigine(e.target.value)}>
                    {ORIGINES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Date d'effet">
                <input type="date" value={dateEffet} disabled={locked} onChange={(e) => setDateEffet(e.target.value)} />
              </Field>
              <Field label={mode === 'aucune' ? "Date d'échéance / d'expiration" : "Date d'échéance"}>
                <input type="date" value={dateEcheance} disabled={locked} onChange={(e) => setDateEcheance(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Liens et résumé">
            <div className="grid2">
              <Field label={multi ? 'Document parent commun (contrat, affaire)' : 'Document parent (avenant, annexe)'} full>
                <select value={parentItemId} disabled={locked} onChange={(e) => setParentItemId(e.target.value)}>
                  <option value="">Aucun</option>
                  {parentCandidates.map((d) => (
                    <option key={d.itemId} value={d.itemId}>
                      {d.fields.DocCode} — {d.fields.Title}
                    </option>
                  ))}
                </select>
              </Field>
              {single && (
                <Field label="Résumé en français (modifiable)" full>
                  <textarea rows={3} value={single.resumeIA} disabled={locked} onChange={(e) => patch(single.id, { resumeIA: e.target.value })} placeholder="Objet, parties, montant, durée, clauses clés…" />
                </Field>
              )}
            </div>
          </Section>
        </div>

        <div className="modal-foot">
          {error ? (
            <span className="small" style={{ color: 'var(--red)', fontWeight: 600 }}>{error}</span>
          ) : busy ? (
            <span className="small muted">
              Enregistrement {doneItems.length + 1}/{items.length}…
            </span>
          ) : problems.length ? (
            <span className="small muted">⚠️ {problems[0]}</span>
          ) : (
            <span className="small" style={{ color: 'var(--green)', fontWeight: 600 }}>
              ✓ Prêt à enregistrer{multi ? ` ${open.length} documents` : ''}
            </span>
          )}
          <button className="btn btn-primary" disabled={busy || analyzing || problems.length > 0 || !open.length} onClick={() => void submit()}>
            {busy ? 'Enregistrement…' : multi ? `Enregistrer les ${open.length} documents` : 'Enregistrer le document'}
          </button>
        </div>
      </div>
    </div>
  );
}
