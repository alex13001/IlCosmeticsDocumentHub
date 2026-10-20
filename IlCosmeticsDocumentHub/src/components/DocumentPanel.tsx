import { useEffect, useState } from 'react';
import { RESTRICTED, TYPES_SIGNATURE } from '../config';
import { CATEGORIES, HR_CATEGORY, subsOf } from '../taxonomy';
import { currentEmail } from '../auth';
import { isPdf } from '../pdf';
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

  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <div className="mono big">{f.DocCode ?? 'Sans code'}</div>
          <div className="muted">
            {doc.library.name}
            {inRestricted && ' · confidentiel'} · {f.Statut}
          </div>
        </div>
        <div>
          <a className="btn" href={doc.webUrl} target="_blank" rel="noreferrer">
            Ouvrir
          </a>
          <button className="link" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <dl className="facts">
        <dt>Entité</dt>
        <dd>{f.Entite}</dd>
        <dt>Origine</dt>
        <dd>{f.Origine}</dd>
        <dt>Signature</dt>
        <dd>{[f.TypeSignature, fmtDate(f.DateSignature)].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Déposé</dt>
        <dd>
          {doc.createdBy} · {fmtDate(doc.created)}
        </dd>
        <dt>Fichier</dt>
        <dd>{doc.fileName}</dd>
      </dl>

      <section>
        <h3>Fiche</h3>
        <div className="form one">
          <label>
            Objet
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
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
              {CATEGORIES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Sous-catégorie
            <select value={sousCategorie} onChange={(e) => setSousCategorie(e.target.value)}>
              <option value="">—</option>
              {subsOf(categorie).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Contrepartie
            <input value={contrepartie} onChange={(e) => setContrepartie(e.target.value)} />
          </label>
          <label>
            Signataires (e-mails)
            <input value={signataires} onChange={(e) => setSignataires(e.target.value)} />
          </label>
          <label>
            Date d'effet
            <input type="date" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
          </label>
          <label>
            Date d'échéance
            <input type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
          </label>
          <label>
            Résumé
            <textarea rows={4} value={resume} onChange={(e) => setResume(e.target.value)} />
          </label>
          <div className="muted small">
            {f.ResumeValidePar ? `Résumé validé par ${f.ResumeValidePar}` : f.ResumeIA ? 'Résumé non validé' : ''}
          </div>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={() => void save()}>
              {busy === 'save' ? 'Enregistrement…' : 'Enregistrer la fiche'}
            </button>
            {resume.trim() && !f.ResumeValidePar && (
              <button disabled={!!busy} onClick={() => void validateResume()}>
                Valider le résumé
              </button>
            )}
          </div>
        </div>
      </section>

      {open && (
        <section>
          <h3>Signature</h3>
          <div className="form one">
            <label>
              Message au signataire (facultatif)
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button disabled={!!busy} onClick={() => void send()}>
              {busy === 'send' ? 'Envoi…' : f.Statut === 'Envoyé' ? 'Renvoyer au(x) signataire(s)' : 'Envoyer pour signature'}
            </button>
            <hr />
            <label>
              Scan signé (PDF)
              <input type="file" accept="application/pdf,.pdf" onChange={(e) => setSignedFile(e.target.files?.[0] ?? null)} />
            </label>
            <label>
              Type de signature
              <select value={typeSignature} onChange={(e) => setTypeSignature(e.target.value)}>
                {TYPES_SIGNATURE.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Date de signature
              <input type="date" value={dateSignature} onChange={(e) => setDateSignature(e.target.value)} />
            </label>
            <button className="primary" disabled={!!busy || !signedFile} onClick={() => void uploadSigned()}>
              {busy === 'signed' ? 'Envoi…' : 'Enregistrer la version signée'}
            </button>
            <div className="muted small">Vérifiez que le code {f.DocCode} est visible sur le scan avant d'enregistrer.</div>
          </div>
        </section>
      )}

      {(parent || children.length > 0) && (
        <section>
          <h3>Documents liés</h3>
          <ul className="links">
            {parent && (
              <li>
                Parent :{' '}
                <button className="link" onClick={() => onOpen(`${parent.library.name}/${parent.itemId}`)}>
                  {parent.fields.DocCode} — {parent.fields.Title}
                </button>
              </li>
            )}
            {children.map((c) => (
              <li key={c.itemId}>
                Lié :{' '}
                <button className="link" onClick={() => onOpen(`${c.library.name}/${c.itemId}`)}>
                  {c.fields.DocCode} — {c.fields.Title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Historique des versions</h3>
        <ul className="links">
          {versions.map((v) => (
            <li key={v.id}>
              v{v.id} · {new Date(v.lastModifiedDateTime).toLocaleString('fr-FR')} · {v.by} · {Math.round(v.size / 1024)} Ko
            </li>
          ))}
          {!versions.length && <li className="muted">—</li>}
        </ul>
      </section>

      {f.Statut !== 'Annulé' && (
        <section>
          {!confirmCancel ? (
            <button className="danger-link" onClick={() => setConfirmCancel(true)}>
              Annuler ce document
            </button>
          ) : (
            <div className="row">
              <span>Le document restera archivé avec le statut Annulé.</span>
              <button className="danger" disabled={!!busy} onClick={() => void cancelDoc()}>
                Confirmer l'annulation
              </button>
              <button className="link" onClick={() => setConfirmCancel(false)}>
                Retour
              </button>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
