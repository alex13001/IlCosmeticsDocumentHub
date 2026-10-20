import { useMemo, useState } from 'react';
import { ENTITIES, ORIGINES, RESTRICTED, TYPES_SIGNATURE } from '../config';
import { CATEGORIES, HR_CATEGORY, subsOf } from '../taxonomy';
import { DocItem, Library, createDocument, parseEmails } from '../docs';
import { isPdf } from '../pdf';

interface Props {
  libs: Library[];
  docs: DocItem[];
  onClose: () => void;
  onDone: (message: string) => void;
}

export default function UploadDialog({ libs, docs, onClose, onDone }: Props) {
  const libByName = useMemo(() => new Map(libs.map((l) => [l.name, l])), [libs]);
  const hasRestricted = libByName.has(RESTRICTED);
  const entityChoices = ENTITIES.filter((e) => libByName.has(e) || hasRestricted);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'aSigner' | 'signe'>('aSigner');
  const [entite, setEntite] = useState<string>(entityChoices[0] ?? '');
  const [categorie, setCategorie] = useState('');
  const [sousCategorie, setSousCategorie] = useState('');
  const [confidentiel, setConfidentiel] = useState(false);
  const [title, setTitle] = useState('');
  const [contrepartie, setContrepartie] = useState('');
  const [signataires, setSignataires] = useState('');
  const [typeSignature, setTypeSignature] = useState('Manuscrite');
  const [origine, setOrigine] = useState<string>('Flux');
  const [dateSignature, setDateSignature] = useState('');
  const [dateEffet, setDateEffet] = useState('');
  const [dateEcheance, setDateEcheance] = useState('');
  const [resumeIA, setResumeIA] = useState('');
  const [parentItemId, setParentItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isHR = categorie === HR_CATEGORY;
  const targetName = isHR || confidentiel ? RESTRICTED : entite;
  const target = libByName.get(targetName);
  const parentCandidates = docs.filter((d) => d.library.name === targetName && d.fields.DocCode && d.fields.Entite === entite);

  const problems: string[] = [];
  if (!file) problems.push('Fichier PDF manquant');
  else if (!isPdf(file)) problems.push('Seuls les PDF sont acceptés');
  if (!entite) problems.push('Entité manquante');
  if (!categorie) problems.push('Catégorie manquante');
  if (!title.trim()) problems.push('Objet manquant');
  if (mode === 'signe' && !dateSignature) problems.push('Date de signature manquante');
  if (signataires && !parseEmails(signataires).length) problems.push('E-mails des signataires invalides');
  if (!target) {
    problems.push(
      targetName === RESTRICTED
        ? 'Les documents RH ou confidentiels ne peuvent être déposés que par la Direction'
        : `Vous n'avez pas accès à la bibliothèque ${targetName}`,
    );
  }

  async function submit() {
    if (problems.length || !file || !target) return;
    setBusy(true);
    setError('');
    try {
      const r = await createDocument({
        library: target,
        entite,
        file,
        mode,
        title: title.trim(),
        categorie,
        sousCategorie,
        contrepartie: contrepartie.trim(),
        signataires: parseEmails(signataires).join('; '),
        typeSignature: mode === 'signe' || signataires ? typeSignature : '',
        origine: mode === 'signe' ? origine : 'Flux',
        dateSignature,
        dateEffet,
        dateEcheance,
        resumeIA: resumeIA.trim(),
        parentItemId,
      });
      onDone(`Document enregistré sous le code ${r.code}.` + (r.warning ? ` Attention : ${r.warning}` : ''));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg">
      <div className="modal">
        <div className="modal-head">
          <h2>Déposer un document</h2>
          <button className="link" onClick={onClose} disabled={busy}>
            Fermer
          </button>
        </div>

        <div className="form">
          <label className="full">
            Fichier PDF
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>

          <div className="full radios">
            <label>
              <input type="radio" checked={mode === 'aSigner'} onChange={() => setMode('aSigner')} /> À signer (le code sera apposé sur le PDF)
            </label>
            <label>
              <input type="radio" checked={mode === 'signe'} onChange={() => setMode('signe')} /> Déjà signé (archivage)
            </label>
          </div>

          <label>
            Entité
            <select value={entite} onChange={(e) => setEntite(e.target.value)}>
              {entityChoices.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            Objet
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Contrat de leasing ligne 3" />
          </label>

          <label>
            Catégorie
            <select
              value={categorie}
              onChange={(e) => {
                setCategorie(e.target.value);
                setSousCategorie('');
              }}
            >
              <option value="">—</option>
              {CATEGORIES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>

          <label>
            Sous-catégorie
            <select value={sousCategorie} onChange={(e) => setSousCategorie(e.target.value)} disabled={!categorie}>
              <option value="">—</option>
              {subsOf(categorie).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>

          {hasRestricted && (
            <label className="full check">
              <input type="checkbox" checked={isHR || confidentiel} disabled={isHR} onChange={(e) => setConfidentiel(e.target.checked)} />
              Confidentiel (bibliothèque Restricted, Direction uniquement){isHR ? ' — obligatoire pour les RH' : ''}
            </label>
          )}

          <label>
            Contrepartie
            <input value={contrepartie} onChange={(e) => setContrepartie(e.target.value)} />
          </label>

          <label>
            Signataires (e-mails, séparés par ;)
            <input value={signataires} onChange={(e) => setSignataires(e.target.value)} placeholder="jf.harpes@ilcosmetics.com" />
          </label>

          <label>
            Type de signature
            <select value={typeSignature} onChange={(e) => setTypeSignature(e.target.value)}>
              {TYPES_SIGNATURE.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>

          {mode === 'signe' && (
            <>
              <label>
                Date de signature
                <input type="date" value={dateSignature} onChange={(e) => setDateSignature(e.target.value)} />
              </label>
              <label>
                Origine
                <select value={origine} onChange={(e) => setOrigine(e.target.value)}>
                  {ORIGINES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label>
            Date d'effet
            <input type="date" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
          </label>

          <label>
            Date d'échéance
            <input type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
          </label>

          <label className="full">
            Document parent (avenant, annexe)
            <select value={parentItemId} onChange={(e) => setParentItemId(e.target.value)}>
              <option value="">Aucun</option>
              {parentCandidates.map((d) => (
                <option key={d.itemId} value={d.itemId}>
                  {d.fields.DocCode} — {d.fields.Title}
                </option>
              ))}
            </select>
          </label>

          <label className="full">
            Résumé (saisie manuelle en attendant l'IA)
            <textarea rows={3} value={resumeIA} onChange={(e) => setResumeIA(e.target.value)} />
          </label>
        </div>

        <div className="modal-foot">
          <span className="muted">
            Destination : <b>{targetName}</b>
          </span>
          {problems.length > 0 && <span className="muted">{problems[0]}</span>}
          {error && <span className="error">{error}</span>}
          <button className="primary" disabled={busy || problems.length > 0} onClick={() => void submit()}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
