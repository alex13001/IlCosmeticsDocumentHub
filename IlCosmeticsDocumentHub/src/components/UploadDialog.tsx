import { useMemo, useState } from 'react';
import { ENTITIES, ORIGINES, RESTRICTED, TYPES_SIGNATURE } from '../config';
import { CATEGORIES, HR_CATEGORY, subsOf } from '../taxonomy';
import { DocItem, Library, createDocument, parseEmails } from '../docs';
import { isPdf } from '../pdf';
import { Badge, Field, Section } from '../ui';

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
  const [over, setOver] = useState(false);
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

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim());
  };

  const problems: string[] = [];
  if (!file) problems.push('Ajoutez le fichier PDF');
  else if (!isPdf(file)) problems.push('Seuls les PDF sont acceptés');
  if (!entite) problems.push('Choisissez l’entité');
  if (!title.trim()) problems.push('Renseignez l’objet');
  if (!categorie) problems.push('Choisissez la catégorie');
  if (mode === 'signe' && !dateSignature) problems.push('Renseignez la date de signature');
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
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <h2>Déposer un document</h2>
          <button className="modal-close" onClick={onClose} disabled={busy}>
            ✕ Fermer
          </button>
        </div>

        <div className="modal-body">
          <Section title="Fichier">
            {file ? (
              <div className="file-ok">
                📄 {file.name} <span className="small">({Math.round(file.size / 1024)} Ko)</span>
                <button className="remove" onClick={() => setFile(null)} title="Retirer">
                  ✕
                </button>
              </div>
            ) : (
              <label
                className={`dropzone${over ? ' over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
              >
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0])} />
                <div className="dropzone-icon">📥</div>
                <div>
                  Glissez le PDF ici ou <strong>cliquez pour choisir</strong>
                </div>
              </label>
            )}
            <div className="modes" style={{ marginTop: 12 }}>
              <button type="button" className={`mode${mode === 'aSigner' ? ' on' : ''}`} onClick={() => setMode('aSigner')}>
                <div className="mode-title">✍️ À signer</div>
                <div className="mode-sub">Le code est apposé sur chaque page, puis le PDF est envoyé au signataire.</div>
              </button>
              <button type="button" className={`mode${mode === 'signe' ? ' on' : ''}`} onClick={() => setMode('signe')}>
                <div className="mode-title">✅ Déjà signé</div>
                <div className="mode-sub">Archivage d’un document signé. Le PDF n’est pas modifié.</div>
              </button>
            </div>
          </Section>

          <Section title="Classement" right={<Badge tone={targetName === RESTRICTED ? 'violet' : 'green'}>Destination : {targetName === RESTRICTED ? '🔒 Restricted' : targetName}</Badge>}>
            <div className="grid2">
              <Field label="Entité" required>
                <select value={entite} onChange={(e) => setEntite(e.target.value)}>
                  {entityChoices.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Objet" required>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Contrat de leasing ligne 3" />
              </Field>
              <Field label="Catégorie" required>
                <select
                  value={categorie}
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
                <select value={sousCategorie} onChange={(e) => setSousCategorie(e.target.value)} disabled={!categorie}>
                  <option value="">—</option>
                  {subsOf(categorie).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Contrepartie" full>
                <input value={contrepartie} onChange={(e) => setContrepartie(e.target.value)} placeholder="Banque, fournisseur, client, administration…" />
              </Field>
              {hasRestricted && (
                <label className={`check full${isHR ? ' locked' : ''}`} style={{ gridColumn: '1 / -1' }}>
                  <input type="checkbox" checked={isHR || confidentiel} disabled={isHR} onChange={(e) => setConfidentiel(e.target.checked)} />
                  🔒 Confidentiel — bibliothèque Restricted, visible par la Direction uniquement{isHR ? ' (obligatoire pour les RH)' : ''}
                </label>
              )}
            </div>
          </Section>

          <Section title="Signature et dates">
            <div className="grid3">
              <Field label="Signataires (e-mails, séparés par ;)" full>
                <input value={signataires} onChange={(e) => setSignataires(e.target.value)} placeholder="jf.harpes@ilcosmetics.com" />
              </Field>
              <Field label="Type de signature">
                <select value={typeSignature} onChange={(e) => setTypeSignature(e.target.value)}>
                  {TYPES_SIGNATURE.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              {mode === 'signe' && (
                <>
                  <Field label="Date de signature" required>
                    <input type="date" value={dateSignature} onChange={(e) => setDateSignature(e.target.value)} />
                  </Field>
                  <Field label="Origine">
                    <select value={origine} onChange={(e) => setOrigine(e.target.value)}>
                      {ORIGINES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
              <Field label="Date d'effet">
                <input type="date" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
              </Field>
              <Field label="Date d'échéance">
                <input type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title="Liens et résumé">
            <div className="grid2">
              <Field label="Document parent (avenant, annexe)" full>
                <select value={parentItemId} onChange={(e) => setParentItemId(e.target.value)}>
                  <option value="">Aucun</option>
                  {parentCandidates.map((d) => (
                    <option key={d.itemId} value={d.itemId}>
                      {d.fields.DocCode} — {d.fields.Title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Résumé (saisie manuelle en attendant l'IA)" full>
                <textarea rows={3} value={resumeIA} onChange={(e) => setResumeIA(e.target.value)} placeholder="Objet, parties, montant, durée, clauses clés…" />
              </Field>
            </div>
          </Section>
        </div>

        <div className="modal-foot">
          {error ? (
            <span className="small" style={{ color: 'var(--red)', fontWeight: 600 }}>{error}</span>
          ) : problems.length ? (
            <span className="small muted">⚠️ {problems[0]}</span>
          ) : (
            <span className="small" style={{ color: 'var(--green)', fontWeight: 600 }}>✓ Prêt à enregistrer</span>
          )}
          <button className="btn btn-primary" disabled={busy || problems.length > 0} onClick={() => void submit()}>
            {busy ? 'Enregistrement…' : 'Enregistrer le document'}
          </button>
        </div>
      </div>
    </div>
  );
}
