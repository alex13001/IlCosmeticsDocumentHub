import { config, DOC_LIBRARIES, RESTRICTED } from './config';
import { GraphError, gDelete, gGet, gGetAll, gPutBytes, gSend } from './graph';
import { stampPdf, toBase64 } from './pdf';
import { currentEmail } from './auth';

export interface Library {
  name: string;
  listId: string;
  driveId: string;
}

export interface DocFields {
  Title?: string;
  DocCode?: string;
  Entite?: string;
  Categorie?: string;
  SousCategorie?: string;
  Contrepartie?: string;
  Signataires?: string;
  Statut?: string;
  TypeSignature?: string;
  Origine?: string;
  DateSignature?: string;
  DateEffet?: string;
  DateEcheance?: string;
  ResumeIA?: string;
  ResumeValidePar?: string;
  DocumentParentLookupId?: string;
}

export interface DocItem {
  library: Library;
  itemId: string;
  driveItemId: string;
  fileName: string;
  webUrl: string;
  size: number;
  created: string;
  createdBy: string;
  modified: string;
  fields: DocFields;
}

export interface DocVersion {
  id: string;
  lastModifiedDateTime: string;
  size: number;
  by: string;
}

const FIELD_NAMES = [
  'Title', 'DocCode', 'Entite', 'Categorie', 'SousCategorie', 'Contrepartie', 'Signataires', 'Statut',
  'TypeSignature', 'Origine', 'DateSignature', 'DateEffet', 'DateEcheance', 'ResumeIA', 'ResumeValidePar',
  'DocumentParentLookupId',
];

const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
const CHUNK = 5 * 1024 * 1024; // multiple of 320 KiB

let siteIdCache: string | null = null;

export async function getSiteId(): Promise<string> {
  if (!siteIdCache) {
    const s = await gGet<{ id: string }>(`/sites/${config.siteHost}:${config.sitePath}?$select=id`);
    siteIdCache = s.id;
  }
  return siteIdCache;
}

/** Thrown when the site is reachable but Graph exposes none of the Document Hub libraries. */
export class NoLibraryError extends Error {
  constructor(public seen: string[]) {
    super(
      seen.length
        ? `Aucune bibliothèque Document Hub visible. Graph renvoie : ${seen.join(', ')}.`
        : "Le site répond mais aucune bibliothèque n'est visible : l'accès Sites.Selected de l'application ILC-DocHub au site n'est pas (ou pas encore) accordé.",
    );
  }
}

type GList = { id: string; displayName: string; name?: string; webUrl?: string };

function matchLibrary(c: { displayName?: string; name?: string; webUrl?: string }): string | undefined {
  const tail = c.webUrl ? decodeURIComponent(c.webUrl.replace(/\/(Forms\/.*)?$/, '').split('/').pop() ?? '') : '';
  const candidates = [c.displayName, c.name, tail].filter(Boolean).map((x) => x!.toLowerCase());
  return DOC_LIBRARIES.find((n) => candidates.includes(n.toLowerCase()));
}

/** Libraries the user can see. Security-trimmed by SharePoint: a library missing here is not accessible. */
export async function getLibraries(): Promise<Library[]> {
  const siteId = await getSiteId();
  const found = new Map<string, Library>();
  const seen: string[] = [];

  const lists = await gGetAll<GList>(`/sites/${siteId}/lists?$select=id,displayName,name,webUrl`);
  seen.push(...lists.map((l) => l.displayName));
  await Promise.all(
    lists.map(async (l) => {
      const key = matchLibrary(l);
      if (!key) return;
      const d = await gGet<{ id: string }>(`/sites/${siteId}/lists/${l.id}/drive?$select=id`);
      found.set(key, { name: key, listId: l.id, driveId: d.id });
    }),
  );

  if (!found.size) {
    // Fallback: some permission set-ups expose drives but not lists.
    const drives = await gGetAll<{ id: string; name: string; webUrl?: string }>(`/sites/${siteId}/drives?$select=id,name,webUrl`);
    seen.push(...drives.map((d) => d.name).filter((n) => !seen.includes(n)));
    await Promise.all(
      drives.map(async (d) => {
        const key = matchLibrary({ displayName: d.name, webUrl: d.webUrl });
        if (!key) return;
        const l = await gGet<{ id: string }>(`/drives/${d.id}/list?$select=id`);
        found.set(key, { name: key, listId: l.id, driveId: d.id });
      }),
    );
  }

  if (!found.size) throw new NoLibraryError(seen);
  return [...found.values()].sort((a, b) => DOC_LIBRARIES.indexOf(a.name) - DOC_LIBRARIES.indexOf(b.name));
}

interface RawItem {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  createdBy?: { user?: { displayName?: string; email?: string } };
  fields: DocFields;
  driveItem?: { id: string; name: string; webUrl: string; size: number; folder?: unknown };
}

export async function loadDocuments(lib: Library): Promise<DocItem[]> {
  const siteId = await getSiteId();
  const items = await gGetAll<RawItem>(
    `/sites/${siteId}/lists/${lib.listId}/items?$top=999` +
      `&$expand=fields($select=${FIELD_NAMES.join(',')}),driveItem($select=id,name,webUrl,size,folder)`,
  );
  return items
    .filter((i) => i.driveItem && !i.driveItem.folder)
    .map((i) => ({
      library: lib,
      itemId: i.id,
      driveItemId: i.driveItem!.id,
      fileName: i.driveItem!.name,
      webUrl: i.driveItem!.webUrl,
      size: i.driveItem!.size,
      created: i.createdDateTime,
      createdBy: i.createdBy?.user?.displayName ?? '',
      modified: i.lastModifiedDateTime,
      fields: i.fields,
    }));
}

// ---------- helpers ----------

export function buildCode(libName: string, entite: string, itemId: string, year = new Date().getFullYear()): string {
  const n = String(itemId).padStart(6, '0');
  return libName === RESTRICTED ? `R-${entite}-${year}-${n}` : `${entite}-${year}-${n}`;
}

export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|#%]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** yyyy-mm-dd (input value) -> ISO at noon UTC, so the DateOnly column keeps the same calendar day. */
export function dateToField(d: string): string | null {
  return d ? `${d}T12:00:00Z` : null;
}

/** ISO from SharePoint -> yyyy-mm-dd in local time (input value). */
export function fieldToDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from now until the date (negative = past). */
export function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function fmtDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('fr-FR') : '';
}

async function uploadChunks(uploadUrl: string, bytes: ArrayBuffer): Promise<{ id: string }> {
  const total = bytes.byteLength;
  let start = 0;
  let last: Response | null = null;
  while (start < total) {
    const end = Math.min(start + CHUNK, total);
    // uploadUrl is pre-authenticated: no Authorization header.
    last = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
      body: bytes.slice(start, end),
    });
    if (!last.ok) throw new Error(`Échec de l'envoi du fichier (${last.status})`);
    start = end;
  }
  return (await last!.json()) as { id: string };
}

async function uploadNew(driveId: string, name: string, bytes: ArrayBuffer): Promise<{ id: string }> {
  const path = encodeURIComponent(name);
  if (bytes.byteLength <= SIMPLE_UPLOAD_MAX) {
    return gPutBytes(`/drives/${driveId}/root:/${path}:/content?@microsoft.graph.conflictBehavior=rename`, bytes);
  }
  const s = await gSend<{ uploadUrl: string }>('POST', `/drives/${driveId}/root:/${path}:/createUploadSession`, {
    item: { '@microsoft.graph.conflictBehavior': 'rename' },
  });
  return uploadChunks(s.uploadUrl, bytes);
}

/** Replaces the file content: SharePoint keeps the previous content as a version. */
async function replaceContent(driveId: string, itemId: string, bytes: ArrayBuffer | Uint8Array): Promise<void> {
  const buf = bytes instanceof Uint8Array ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : bytes;
  if (buf.byteLength <= SIMPLE_UPLOAD_MAX) {
    await gPutBytes(`/drives/${driveId}/items/${itemId}/content`, buf);
    return;
  }
  const s = await gSend<{ uploadUrl: string }>('POST', `/drives/${driveId}/items/${itemId}/createUploadSession`, {
    item: { '@microsoft.graph.conflictBehavior': 'replace' },
  });
  await uploadChunks(s.uploadUrl, buf);
}

export async function updateFields(doc: { library: Library; itemId: string }, patch: Record<string, unknown>): Promise<void> {
  const siteId = await getSiteId();
  await gSend('PATCH', `/sites/${siteId}/lists/${doc.library.listId}/items/${doc.itemId}/fields`, patch);
}

// ---------- use cases ----------

export interface NewDocument {
  library: Library;
  entite: string;
  file: File;
  mode: 'aSigner' | 'signe';
  title: string;
  categorie: string;
  sousCategorie: string;
  contrepartie: string;
  signataires: string;
  typeSignature: string;
  origine: string;
  dateSignature: string;
  dateEffet: string;
  dateEcheance: string;
  resumeIA: string;
  parentItemId: string;
}

export interface CreateResult {
  code: string;
  warning?: string;
}

export async function createDocument(n: NewDocument): Promise<CreateResult> {
  const bytes = await n.file.arrayBuffer();
  const tempName = `_upload_${Date.now()}_${safeName(n.file.name)}`;
  const di = await uploadNew(n.library.driveId, tempName, bytes);
  const li = await gGet<{ id: string }>(`/drives/${n.library.driveId}/items/${di.id}/listItem?$select=id`);
  const code = buildCode(n.library.name, n.entite, li.id);
  const doc = { library: n.library, itemId: li.id };

  const fields: Record<string, unknown> = {
    Title: n.title,
    DocCode: code,
    Entite: n.entite,
    Categorie: n.categorie,
    SousCategorie: n.sousCategorie || null,
    Contrepartie: n.contrepartie || null,
    Signataires: n.signataires || null,
    Statut: n.mode === 'signe' ? 'Signé' : 'À signer',
    TypeSignature: n.typeSignature || null,
    Origine: n.origine,
    DateSignature: n.mode === 'signe' ? dateToField(n.dateSignature) : null,
    DateEffet: dateToField(n.dateEffet),
    DateEcheance: dateToField(n.dateEcheance),
    ResumeIA: n.resumeIA || null,
    ResumeValidePar: n.resumeIA ? currentEmail() : null,
  };
  if (n.parentItemId) fields.DocumentParentLookupId = n.parentItemId;
  try {
    await updateFields(doc, fields);
  } catch (e) {
    throw new Error(
      `Fichier déposé (${tempName}) mais la fiche n'a pas pu être enregistrée : ${(e as Error).message}. ` +
        `Prévenez un administrateur.`,
    );
  }

  const base = safeName(n.file.name.replace(/\.pdf$/i, ''));
  await gSend('PATCH', `/drives/${n.library.driveId}/items/${di.id}`, { name: `${code} - ${base}.pdf` });

  if (n.mode === 'aSigner') {
    try {
      const stamped = await stampPdf(bytes, code);
      await replaceContent(n.library.driveId, di.id, stamped);
    } catch (e) {
      return { code, warning: `Le code n'a pas pu être apposé sur le PDF (${(e as Error).message}). Reportez-le à la main.` };
    }
  }
  return { code };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseEmails(s: string): string[] {
  return s
    .split(/[;,\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}

export async function sendForSignature(doc: DocItem, recipients: string[], note: string): Promise<{ attached: boolean }> {
  const f = doc.fields;
  const item = await gGet<{ name: string; size: number; '@microsoft.graph.downloadUrl'?: string }>(
    `/drives/${doc.library.driveId}/items/${doc.driveItemId}`,
  );
  const attachments: unknown[] = [];
  const dl = item['@microsoft.graph.downloadUrl'];
  if (dl && item.size <= config.maxAttachmentBytes) {
    const buf = await fetch(dl).then((r) => {
      if (!r.ok) throw new Error(`Téléchargement impossible (${r.status})`);
      return r.arrayBuffer();
    });
    attachments.push({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: item.name,
      contentType: 'application/pdf',
      contentBytes: toBase64(buf),
    });
  }
  const sender = currentEmail();
  const rows: [string, string | undefined][] = [
    ['Code', f.DocCode],
    ['Objet', f.Title],
    ['Entité', f.Entite],
    ['Catégorie', [f.Categorie, f.SousCategorie].filter(Boolean).join(' / ')],
    ['Contrepartie', f.Contrepartie],
  ];
  const table = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${k}</td><td><b>${esc(v!)}</b></td></tr>`)
    .join('');
  const content =
    (note ? `<p>${esc(note).replace(/\n/g, '<br>')}</p>` : '') +
    `<table style="font-family:Segoe UI,Arial;font-size:13px">${table}</table>` +
    `<p>Merci de signer le document portant le code <b>${esc(f.DocCode ?? '')}</b> et de retourner le scan PDF à ${esc(sender)}. ` +
    `Le code doit rester visible sur la version signée.</p>` +
    (attachments.length ? '' : `<p>Document (trop volumineux pour une pièce jointe) : <a href="${esc(doc.webUrl)}">ouvrir dans le Document Hub</a></p>`) +
    `<p style="color:#888;font-size:11px">Envoyé depuis IL Cosmetics Document Hub</p>`;

  await gSend('POST', '/me/sendMail', {
    message: {
      subject: `[Document Hub] À signer - ${f.DocCode} - ${f.Title ?? ''}`,
      body: { contentType: 'HTML', content },
      toRecipients: recipients.map((a) => ({ emailAddress: { address: a } })),
      attachments,
    },
    saveToSentItems: true,
  });
  await updateFields(doc, { Statut: 'Envoyé', Signataires: recipients.join('; ') });
  return { attached: attachments.length > 0 };
}

export async function uploadSignedVersion(doc: DocItem, file: File, typeSignature: string, dateSignature: string): Promise<void> {
  const bytes = await file.arrayBuffer();
  await replaceContent(doc.library.driveId, doc.driveItemId, bytes);
  await updateFields(doc, {
    Statut: 'Signé',
    TypeSignature: typeSignature,
    DateSignature: dateToField(dateSignature),
  });
}

export async function getVersions(doc: DocItem): Promise<DocVersion[]> {
  const v = await gGetAll<{ id: string; lastModifiedDateTime: string; size: number; lastModifiedBy?: { user?: { displayName?: string } } }>(
    `/drives/${doc.library.driveId}/items/${doc.driveItemId}/versions`,
  );
  return v.map((x) => ({ id: x.id, lastModifiedDateTime: x.lastModifiedDateTime, size: x.size, by: x.lastModifiedBy?.user?.displayName ?? '' }));
}


// ---------- controlled confidentiality escalation ----------
// Only entity -> Restricted is supported. Reverse moves require an admin workflow.
// Graph copy with includeAllVersionHistory avoids SharePoint Move-to limitations
// caused by lookup/unique columns; the list metadata MUST be restored separately.

type CopyDriveItem = {
  id: string;
  name: string;
  size: number;
  eTag?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
};

export interface ConfidentialityResult {
  code: string;
  auditRecorded: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findAtRoot(driveId: string, name: string): Promise<CopyDriveItem | null> {
  try {
    return await gGet<CopyDriveItem>(`/drives/${driveId}/root:/${encodeURIComponent(name)}`);
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

async function countVersions(driveId: string, id: string): Promise<number> {
  const entries = await gGetAll<{ id: string }>(`/drives/${driveId}/items/${id}/versions?$select=id`);
  return Math.max(1, entries.length);
}

async function contentHash(driveId: string, id: string): Promise<string> {
  const item = await gGet<CopyDriveItem>(`/drives/${driveId}/items/${id}`);
  const url = item['@microsoft.graph.downloadUrl'];
  if (!url) throw new Error('Microsoft Graph ne fournit pas le lien de v\u00e9rification du PDF.');
  // No authorization header for a preauthenticated downloadUrl.
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Lecture du PDF impossible (${response.status}).`);
  const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

async function logConfidentialityMove(code: string, source: string): Promise<boolean> {
  try {
    const siteId = await getSiteId();
    const lists = await gGetAll<GList>(`/sites/${siteId}/lists?$select=id,name,displayName`);
    const audit = lists.find((x) => (x.name || x.displayName || '').toLowerCase() === 'documentauditlog');
    if (!audit) return false;
    const title = `CONFIDENTIALITY_UPGRADE | ${code} | ${source}>Restricted | ${currentEmail()} | ${new Date().toISOString()}`;
    await gSend('POST', `/sites/${siteId}/lists/${audit.id}/items`, { fields: { Title: title.slice(0, 255) } });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies one unlinked document to Restricted, checks file and version history,
 * restores the registered metadata, and deletes the original with If-Match.
 * If a check fails, the original remains in its source library.
 */
export async function makeDocumentConfidential(
  doc: DocItem,
  restricted: Library,
  progress: (message: string) => void = () => {},
): Promise<ConfidentialityResult> {
  if (doc.library.name === RESTRICTED) throw new Error('Le document est d\u00e9j\u00e0 confidentiel.');
  if (restricted.name !== RESTRICTED || doc.library.driveId === restricted.driveId) {
    throw new Error('Biblioth\u00e8que Restricted invalide.');
  }
  progress('Contr\u00f4le du document et de ses relations...');
  // Read live data, not the snapshot retained by the React page.
  const sourceDocs = await loadDocuments(doc.library);
  const current = sourceDocs.find((x) => x.itemId === doc.itemId);
  if (!current) throw new Error('Document source introuvable. Actualisez le registre.');
  if (!current.fields.DocCode || !current.fields.Entite || !current.fields.Title) {
    throw new Error('La fiche source est incompl\u00e8te : code, entit\u00e9 ou objet manquant.');
  }
  if (current.fields.DocumentParentLookupId || sourceDocs.some((x) => String(x.fields.DocumentParentLookupId || '') === current.itemId)) {
    throw new Error('Document li\u00e9 \u00e0 un autre document : reclassement bloqu\u00e9 pour ne pas rompre les relations.');
  }
  if (doc.modified && Date.parse(doc.modified) !== Date.parse(current.modified)) {
    throw new Error('La fiche a chang\u00e9 depuis son ouverture. Actualisez avant le transfert.');
  }
  const original = await gGet<CopyDriveItem>(`/drives/${doc.library.driveId}/items/${doc.driveItemId}`);
  if (!original.eTag || original.name !== current.fileName || original.size !== current.size) {
    throw new Error('La version source ne correspond plus \u00e0 la fiche affich\u00e9e. Actualisez.');
  }
  if (original.size > 100 * 1024 * 1024) {
    throw new Error('PDF sup\u00e9rieur \u00e0 100 Mo : transfert manuel contr\u00f4l\u00e9 requis.');
  }

  const targetDocs = await loadDocuments(restricted);
  const matchingCode = targetDocs.find((x) => x.fields.DocCode === current.fields.DocCode);
  if (matchingCode && matchingCode.fileName !== current.fileName) {
    throw new Error(`Le code ${current.fields.DocCode} existe d\u00e9j\u00e0 dans Restricted sur un autre fichier.`);
  }

  progress('Contr\u00f4le des versions et du fichier cible...');
  const versionCount = await countVersions(doc.library.driveId, doc.driveItemId);
  let target = await findAtRoot(restricted.driveId, current.fileName);
  if (target) {
    // Permit resuming a prior completed copy, but never adopt an unrelated file.
    const targetRecord = targetDocs.find((x) => x.driveItemId === target!.id);
    if (!targetRecord || targetRecord.fields.DocCode !== current.fields.DocCode) {
      throw new Error('Un fichier de m\u00eame nom existe dans Restricted. Aucun \u00e9crasement effectu\u00e9.');
    }
  } else {
    progress('Copie SharePoint de toutes les versions vers Restricted...');
    const root = await gGet<{ id: string }>(`/drives/${restricted.driveId}/root?$select=id`);
    // Do NOT specify a new name: Graph may otherwise ignore includeAllVersionHistory.
    await gSend('POST', `/drives/${doc.library.driveId}/items/${doc.driveItemId}/copy?includeAllVersionHistory=true`, {
      parentReference: { driveId: restricted.driveId, id: root.id },
    });
  }

  // Copy is asynchronous (202 Accepted); seeing the target file alone is not
  // sufficient to prove that version history has been copied.
  const deadline = Date.now() + 120_000;
  let count = 0;
  while (Date.now() < deadline) {
    target = await findAtRoot(restricted.driveId, current.fileName);
    if (target && target.size === original.size) {
      try { count = await countVersions(restricted.driveId, target.id); }
      catch (e) { if (!(e instanceof GraphError) || e.status !== 404) throw e; }
      if (count >= versionCount) break;
    }
    await sleep(2500);
  }
  if (!target || target.size !== original.size || count < versionCount) {
    throw new Error('Copie ou historique incomplet dans Restricted. Source conserv\u00e9e ; v\u00e9rifiez la copie dans SharePoint.');
  }

  progress('V\u00e9rification SHA-256 du PDF...');
  const [before, after] = await Promise.all([
    contentHash(doc.library.driveId, doc.driveItemId),
    contentHash(restricted.driveId, target.id),
  ]);
  if (before !== after) throw new Error('Le contr\u00f4le SHA-256 a \u00e9chou\u00e9. Original conserv\u00e9.');

  progress('Recr\u00e9ation des m\u00e9tadonn\u00e9es du registre...');
  const listItem = await gGet<{ id: string }>(`/drives/${restricted.driveId}/items/${target.id}/listItem?$select=id`);
  // The lookup is deliberately excluded; linked documents were blocked above.
  const restored: Record<string, unknown> = {};
  for (const field of FIELD_NAMES) {
    if (field === 'DocumentParentLookupId') continue;
    restored[field] = current.fields[field as keyof DocFields] ?? null;
  }
  await updateFields({ library: restricted, itemId: listItem.id }, restored);
  const siteId = await getSiteId();
  const saved = await gGet<DocFields>(`/sites/${siteId}/lists/${restricted.listId}/items/${listItem.id}/fields`);
  const required: (keyof DocFields)[] = ['DocCode', 'Title', 'Entite', 'Categorie', 'SousCategorie', 'Contrepartie', 'Statut', 'ResumeIA'];
  if (!required.every((key) => (saved[key] || '') === (current.fields[key] || ''))) {
    throw new Error('Les m\u00e9tadonn\u00e9es de Restricted ne correspondent pas \u00e0 la source. Original conserv\u00e9.');
  }

  // Verify no source update happened while the async copy was in progress.
  progress('Suppression conditionnelle de la copie d\u2019origine...');
  try {
    await gDelete(`/drives/${doc.library.driveId}/items/${doc.driveItemId}`, { 'If-Match': original.eTag });
  } catch (error) {
    throw new Error(`Copie v\u00e9rifi\u00e9e dans Restricted, mais SUPPRESSION DE L'ORIGINAL IMPOSSIBLE. ` +
      `Le fichier reste potentiellement accessible dans ${doc.library.name}. ` +
      `Supprimez l'original depuis SharePoint, puis contr\u00f4lez les acc\u00e8s. ` +
      `D\u00e9tail: ${(error as Error).message}`);
  }
  const auditRecorded = await logConfidentialityMove(current.fields.DocCode, doc.library.name);
  progress('Reclassement termin\u00e9.');
  return { code: current.fields.DocCode, auditRecorded };
}
