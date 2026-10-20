import { config, DOC_LIBRARIES, RESTRICTED } from './config';
import { gGet, gGetAll, gPutBytes, gSend } from './graph';
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
