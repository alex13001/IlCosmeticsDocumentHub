import { useMemo, useState } from 'react';
import { ENTITIES, RESTRICTED } from '../config';
import { DocItem, Library, moveBlocker, moveDocument } from '../docs';
import { Badge, Field, Section } from '../ui';

interface Props {
  /** Documents to move (one from the fiche, several from the table selection). */
  docs: DocItem[];
  /** Whole register, to detect parent/child links. */
  all: DocItem[];
  libs: Library[];
  onClose: () => void;
  onDone: (message: string) => void;
}

type RowState = { status: 'todo' | 'skip' | 'running' | 'done' | 'error'; message?: string; code?: string };

export default function MoveDialog({ docs, all, libs, onClose, onDone }: Props) {
  const libByName = useMemo(() => new Map(libs.map((l) => [l.name, l])), [libs]);
  const hasRestricted = libByName.has(RESTRICTED);
  const allRestricted = docs.every((d) => d.library.name === RESTRICTED);
  const entityChoices = ENTITIES.filter((e) => libByName.has(e) || hasRestricted);

  const [entite, setEntite] = useState<string>('');
  const [confidentiel, setConfidentiel] = useState(allRestricted);
  const [keepCode, setKeepCode] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  const targetName = confidentiel ? RESTRICTED : entite;
  const target = targetName ? libByName.get(targetName) : undefined;
  const keyOf = (d: DocItem) => `${d.library.name}/${d.itemId}`;

  /** Reason a row will be skipped with the current choice ('' = will be moved). */
  const skipReason = (d: DocItem): string => {
    const b = moveBlocker(d, all);
    if (b) return b;
    if (entite && d.fields.Entite === entite && d.library.name === targetName) return 'déjà dans cette entité';
    return '';
  };

  const movable = docs.filter((d) => !skipReason(d));
  const problem = !entite
    ? 'Choisissez l’entité de destination'
    : !target
      ? `Vous n'avez pas accès à la bibliothèque ${targetName}`
      : !movable.length
        ? 'Aucun document déplaçable avec ce choix'
        : '';

  const set = (k: string, s: RowState) => setRows((prev) => ({ ...prev, [k]: s }));

  async function run() {
    if (problem || !target || busy) return;
    setBusy(true);
    const moved: string[] = [];
    let failed = 0;
    let auditMissing = false;
    for (const d of docs) {
      const k = keyOf(d);
      if (rows[k]?.status === 'done') continue;
      const reason = skipReason(d);
      if (reason) {
        set(k, { status: 'skip', message: reason });
        continue;
      }
      set(k, { status: 'running', message: 'Démarrage…' });
      try {
        const r = await moveDocument(d, target, {
          entite,
          keepCode,
          progress: (m) => set(k, { status: 'running', message: m }),
        });
        moved.push(r.code === r.oldCode ? r.code : `${r.oldCode} → ${r.code}`);
        if (!r.auditRecorded) auditMissing = true;
        set(k, { status: 'done', code: r.code });
      } catch (e) {
        failed++;
        set(k, { status: 'error', message: (e as Error).message });
      }
    }
    setBusy(false);
    setFinished(true);
    if (!failed) {
      onDone(
        `${moved.length} document(s) déplacé(s) vers ${targetName} (${entite}) : ${moved.join(', ')}.` +
          (auditMissing ? ' Journal DocumentAuditLog non renseigné.' : ''),
      );
    }
  }

  const close = () => {
    const done = Object.values(rows).filter((r) => r.status === 'done').length;
    if (done) onDone(`${done} document(s) déplacé(s) vers ${targetName}. Voir le détail des échecs avant de relancer.`);
    else onClose();
  };

  const badge = (d: DocItem) => {
    const r = rows[keyOf(d)];
    const reason = skipReason(d);
    if (r?.status === 'done') return <Badge tone="green" small>✓ {r.code}</Badge>;
    if (r?.status === 'running') return <Badge tone="blue" small>En cours…</Badge>;
    if (r?.status === 'error') return <Badge tone="red" small>Échec</Badge>;
    if (reason) return <Badge tone="grey" small>Ignoré</Badge>;
    return <Badge tone="orange" small>À déplacer</Badge>;
  };

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head">
          <h2>{docs.length > 1 ? `Déplacer ${docs.length} documents` : 'Déplacer le document'}</h2>
          <button className="modal-close" onClick={close} disabled={busy}>
            ✕ Fermer
          </button>
        </div>

        <div className="modal-body">
          <Section title="Destination">
            <div className="grid2">
              <Field label="Bonne entité juridique" required>
                <select value={entite} disabled={busy || finished} onChange={(e) => setEntite(e.target.value)}>
                  <option value="">— Choisir —</option>
                  {entityChoices.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Bibliothèque de destination">
                <div style={{ paddingTop: 6 }}>
                  {targetName ? <Badge tone={confidentiel ? 'violet' : 'green'}>{confidentiel ? '🔒 Restricted' : targetName}</Badge> : <span className="small faint">—</span>}
                </div>
              </Field>
              {hasRestricted && (
                <label className="check full" style={{ gridColumn: '1 / -1' }}>
                  <input type="checkbox" checked={confidentiel} disabled={busy || finished} onChange={(e) => setConfidentiel(e.target.checked)} />
                  🔒 Rester / passer en confidentiel (bibliothèque Restricted, entité corrigée dans la fiche)
                </label>
              )}
              <label className="field full" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={keepCode} disabled={busy || finished} onChange={(e) => setKeepCode(e.target.checked)} />
                <span className="small">
                  Conserver le code actuel. À cocher seulement si le code est déjà imprimé sur un PDF signé. Sinon, un nouveau code est attribué
                  avec la bonne entité (même année). L'ancien code est tracé dans le journal DocumentAuditLog, s'il est en place.
                </span>
              </label>
            </div>
          </Section>

          <Section title={`Documents (${docs.length})`}>
            <div className="table-wrap">
              <table className="grid batch">
                <thead>
                  <tr>
                    <th>Code actuel</th>
                    <th>Objet</th>
                    <th>Entité / bibliothèque</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => {
                    const r = rows[keyOf(d)];
                    const reason = skipReason(d);
                    return (
                      <tr key={keyOf(d)}>
                        <td><span className="code">{d.fields.DocCode || '—'}</span></td>
                        <td>{d.fields.Title || d.fileName}</td>
                        <td>
                          {d.fields.Entite || '—'} <span className="small faint">/ {d.library.name}</span>
                        </td>
                        <td>
                          {badge(d)}
                          {(r?.message || (!r && reason)) && (
                            <div className="small" style={{ color: r?.status === 'error' ? 'var(--red)' : 'var(--faint)', marginTop: 3 }}>
                              {r?.message || reason}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              Chaque fichier est copié avec tout son historique, puis contrôlé (taille, versions, empreinte SHA-256, fiche). L'original n'est supprimé
              (corbeille SharePoint) qu'après ces contrôles. En cas d'échec, il reste en place. Les documents liés (parent/enfant) ou en cours de
              signature sont ignorés.
            </div>
          </Section>
        </div>

        <div className="modal-foot">
          {problem ? (
            <span className="small muted">⚠️ {problem}</span>
          ) : busy ? (
            <span className="small muted">Déplacement en cours, ne fermez pas la page…</span>
          ) : (
            <span className="small" style={{ color: 'var(--green)', fontWeight: 600 }}>
              ✓ {movable.length} document(s) à déplacer vers {targetName}
              {docs.length - movable.length > 0 ? ` · ${docs.length - movable.length} ignoré(s)` : ''}
            </span>
          )}
          <button className="btn btn-primary" disabled={busy || !!problem} onClick={() => void run()}>
            {busy ? 'Déplacement…' : finished ? 'Relancer les échecs' : `Déplacer ${movable.length} document(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
