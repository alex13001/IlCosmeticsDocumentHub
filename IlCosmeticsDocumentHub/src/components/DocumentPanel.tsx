import { useEffect, useState } from 'react';
import { RESTRICTED, TYPES_SIGNATURE } from '../config';
import { CATEGORIES, HR_CATEGORY, subsOf } from '../taxonomy';
import { currentEmail } from '../auth';
import { isPdf } from '../pdf';
import { Badge, Field, STATUT_TONE, Section } from '../ui';
import {
  DocItem,
  DocVersion,
  dateToField,
  fieldToDate,
  fmtDate,
  getVersions,
  parseEmails,
  sendForSignature,
  updateFields,
  uploadSignedVersion,
} from '../docs';

interface Props {
  doc: DocItem;
  docs: DocItem[];
  onClose: () => void;
  onChanged: (message?: string) => void;
  onOpen: (key: string) => void;
}

export default function DocumentPanel({ doc, docs, onClose, onChanged, onOpen }: Props) {
  const f = doc.fields;
  const [title, setTitle] = useState(f.Title ?? '');
  const [categorie, setCategorie] = useState(f.Categorie ?? '');
  const [sousCategorie, setSousCategorie] = useState(f.SousCategorie ?? '');
  const [contrepartie, setContrepartie] = useState(f.Contrepartie ?? '');
  const [signataires, setSignataires] = useState(f.Signataires ?? '');
  const [dateEffet, setDateEffet] = useState(fieldToDate(f.DateEffet));
  const [dateEcheance, setDateEcheance] = useState(fieldToDate(f.DateEcheance));
  const [resume, setResume] = useState(f.ResumeIA ?? '');

  const [note, setNote] = useState('');
  const [signedFile, setSignedFile] = useState<File | null>(null);
  const [typeSignature, setTypeSignature] = useState(f.TypeSignature || 'Manuscrite');
  const [dateSignature, setDateSignature] = useState(fieldToDate(new Date().toISOString()));
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(f.Title ?? '');
    setCategorie(f.Categorie ?? '');
    setSousCategorie(f.SousCategorie ?? '');
    setContrepartie(f.Contrepartie ?? '');
    setSignataires(f.Signataires ?? '');
    setDateEffet(fieldToDate(f.DateEffet));
    setDateEcheance(fieldToDate(f.DateEcheance));
    setResume(f.ResumeIA ?? '');
    setTypeSignature(f.TypeSignature || 'Manuscrite');
    setConfirmCancel(false);
    setError('');
    getVersions(doc).then(setVersions).catch(() => setVersions([]));
  }, [doc, f]);

  const inRestricted = doc.library.name === RESTRICTED;
  const open = f.Statut === 'À signer' || f.Statut === 'Envoyé';
  const parent = f.DocumentParentLookupId ? docs.find((d) => d.library.name === doc.library.name && d.itemId === String(f.DocumentParentLookupId)) : undefined;
  const children = docs.filter((d) => d.library.name === doc.library.name && String(d.fields.DocumentParentLookupId ?? '') === doc.itemId);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setError('');
    try {
      const msg = await fn();
      onChanged(msg || undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const save = () =>
    run('save', async () => {
      if (categorie === HR_CATEGORY && !inRestricted) throw new Error('Un document RH doit être dans Restricted : demandez un reclassement à un administrateur.');
      const resumeChanged = resume.trim() !== (f.ResumeIA ?? '');
      await updateFields(doc, {
        Title: title.trim(),
        Categorie: categorie,
        SousCategorie: sousCategorie || null,
        Contrepartie: contrepartie.trim() || null,
        Signataires: parseEmails(signataires).join('; ') || null,
        DateEffet: dateToField(dateEffet),
        DateEcheance: dateToField(dateEcheance),
        ResumeIA: resume.trim() || null,
        ...(resumeChanged ? { ResumeValidePar: null } : {}),
      });
      return 'Fiche mise à jour.';
    });

  const validateResume = () =>
    run('validate', async () => {
      await updateFields(doc, { ResumeIA: resume.trim(), ResumeValidePar: currentEmail() });
      return 'Résumé validé.';
    });

  const send = () =>
    run('send', async () => {
      const to = parseEmails(signataires);
      if (!to.length) throw new Error('Indiquez au moins un e-mail de signataire.');
      const r = await sendForSignature(doc, to, note.trim());
      return `Envoyé à ${to.join(', ')}${r.attached ? '' : ' (lien, fichier trop volumineux pour une pièce jointe)'}.`;
    });

  const uploadSigned = () =>
    run('signed', async () => {
      if (!signedFile || !isPdf(signedFile)) throw new Error('Sélectionnez le scan signé (PDF).');
      if (!dateSignature) throw new Error('Date de signature manquante.');
      await uploadSignedVersion(doc, signedFile, typeSignature, dateSignature);
      return `Version signée enregistrée pour ${f.DocCode}.`;
    });

  const cancelDoc = () =>
    run('cancel', async () => {
      await updateFields(doc, { Statut: 'Annulé' });
      return `${f.DocCode} annulé.`;
    });

  const tone = STATUT_TONE[f.Statut ?? ''] ?? 'grey';
  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="panel-head-row">
          <div>
            <div className="panel-code">{f.DocCode ?? 'Sans code'}</div>
            <div className="panel-title">{f.Title}</div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-actions">
          <Badge tone={tone}>{f.Statut}</Badge>
          {inRestricted && <Badge tone="violet">🔒 Confidentiel</Badge>}
          <a className="btn btn-white" href={doc.webUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto' }}>
            Ouvrir le PDF ↗
          </a>
        </div>
      </div>

      <div className="panel-body">
        {error && <div className="alert t-red">{error}</div>}

        <div className="info">
          <div className="info-row"><span className="info-label">Entité</span><span className="info-value">{f.Entite}</span></div>
          <div className="info-row"><span className="info-label">Bibliothèque</span><span className="info-value">{doc.library.name}</span></div>
          <div className="info-row"><span className="info-label">Origine</span><span className="info-value">{f.Origine || '—'}</span></div>
          <div className="info-row"><span className="info-label">Signature</span><span className="info-value">{[f.TypeSignature, fmtDate(f.DateSignature)].filter(Boolean).join(' · ') || '—'}</span></div>
          <div className="info-row"><span className="info-label">Déposé</span><span className="info-value">{doc.createdBy} · {fmtDate(doc.created)}</span></div>
          <div className="info-row"><span className="info-label">Fichier</span><span className="info-value small">{doc.fileName}</span></div>
        </div>

        {open && (
          <Section title="Signature">
            <div className="stack">
              <Field label="Signataires (e-mails)">
                <input value={signataires} onChange={(e) => setSignataires(e.target.value)} />
              </Field>
              <Field label="Message au signataire (facultatif)">
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="row">
                <button className="btn btn-info" disabled={!!busy} onClick={() => void send()}>
                  {busy === 'send' ? 'Envoi…' : f.Statut === 'Envoyé' ? '📨 Renvoyer au(x) signataire(s)' : '📨 Envoyer pour signature'}
                </button>
              </div>
              <hr className="divider" />
              <Field label="Scan signé (PDF)">
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => setSignedFile(e.target.files?.[0] ?? null)} />
              </Field>
              <div className="grid2">
                <Field label="Type de signature">
                  <select value={typeSignature} onChange={(e) => setTypeSignature(e.target.value)}>
                    {TYPES_SIGNATURE.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Date de signature">
                  <input type="date" value={dateSignature} onChange={(e) => setDateSignature(e.target.value)} />
                </Field>
              </div>
              <div className="row">
                <button className="btn btn-primary" disabled={!!busy || !signedFile} onClick={() => void uploadSigned()}>
                  {busy === 'signed' ? 'Envoi…' : '✅ Enregistrer la version signée'}
                </button>
              </div>
              <div className="small faint">Vérifiez que le code {f.DocCode} est visible sur le scan avant d'enregistrer.</div>
            </div>
          </Section>
        )}

        <Section title="Fiche">
          <div className="stack">
            <Field label="Objet">
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="grid2">
              <Field label="Catégorie">
                <select
                  value={categorie}
                  onChange={(e) => {
                    setCategorie(e.target.value);
                    setSousCategorie('');
                  }}
                >
                  {CATEGORIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sous-catégorie">
                <select value={sousCategorie} onChange={(e) => setSousCategorie(e.target.value)}>
                  <option value="">—</option>
                  {subsOf(categorie).map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Contrepartie">
              <input value={contrepartie} onChange={(e) => setContrepartie(e.target.value)} />
            </Field>
            {!open && (
              <Field label="Signataires (e-mails)">
                <input value={signataires} onChange={(e) => setSignataires(e.target.value)} />
              </Field>
            )}
            <div className="grid2">
              <Field label="Date d'effet">
                <input type="date" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
              </Field>
              <Field label="Date d'échéance">
                <input type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
              </Field>
            </div>
            <Field label="Résumé">
              <textarea rows={4} value={resume} onChange={(e) => setResume(e.target.value)} />
            </Field>
            {(f.ResumeIA || f.ResumeValidePar) && (
              <div>
                {f.ResumeValidePar ? <Badge tone="green" small>✓ Résumé validé par {f.ResumeValidePar}</Badge> : <Badge tone="orange" small>Résumé non validé</Badge>}
              </div>
            )}
            <div className="row">
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>
                {busy === 'save' ? 'Enregistrement…' : 'Enregistrer la fiche'}
              </button>
              {resume.trim() && !f.ResumeValidePar && (
                <button className="btn btn-ghost" disabled={!!busy} onClick={() => void validateResume()}>
                  Valider le résumé
                </button>
              )}
            </div>
          </div>
        </Section>

        {(parent || children.length > 0) && (
          <Section title="Documents liés">
            <div className="stack">
              {parent && (
                <div className="small">
                  Parent :{' '}
                  <button className="link-btn" onClick={() => onOpen(`${parent.library.name}/${parent.itemId}`)}>
                    {parent.fields.DocCode} — {parent.fields.Title}
                  </button>
                </div>
              )}
              {children.map((c) => (
                <div key={c.itemId} className="small">
                  Lié :{' '}
                  <button className="link-btn" onClick={() => onOpen(`${c.library.name}/${c.itemId}`)}>
                    {c.fields.DocCode} — {c.fields.Title}
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Historique des versions">
          {versions.length ? (
            <ul className="timeline">
              {versions.map((v) => (
                <li key={v.id}>
                  <b>v{v.id}</b> · {new Date(v.lastModifiedDateTime).toLocaleString('fr-FR')}
                  <div className="faint">{v.by} · {Math.round(v.size / 1024)} Ko</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="small faint">—</div>
          )}
        </Section>

        {f.Statut !== 'Annulé' && (
          <Section title="Zone sensible">
            {!confirmCancel ? (
              <button className="btn btn-danger" onClick={() => setConfirmCancel(true)}>
                Annuler ce document
              </button>
            ) : (
              <div className="stack">
                <div className="small muted">Le document reste archivé avec le statut « Annulé ». Seul un administrateur peut le supprimer.</div>
                <div className="row">
                  <button className="btn btn-danger-solid" disabled={!!busy} onClick={() => void cancelDoc()}>
                    Confirmer l'annulation
                  </button>
                  <button className="link-btn" onClick={() => setConfirmCancel(false)}>
                    Retour
                  </button>
                </div>
              </div>
            )}
          </Section>
        )}
      </div>
    </aside>
  );
}
