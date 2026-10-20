import { getToken } from './auth';

const BASE = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function raw(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const token = await getToken();
  const url = path.startsWith('http') ? path : BASE + path;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  if ((res.status === 429 || res.status === 503) && attempt < 3) {
    const wait = Number(res.headers.get('Retry-After') ?? '2') * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return raw(path, init, attempt + 1);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.error?.message ?? msg;
    } catch {
      /* body not JSON */
    }
    throw new GraphError(res.status, msg);
  }
  return res;
}

export async function gGet<T>(path: string, headers?: Record<string, string>): Promise<T> {
  const r = await raw(path, { headers });
  return (await r.json()) as T;
}

/** Follows @odata.nextLink and concatenates `value`. */
export async function gGetAll<T>(path: string, headers?: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: { value: T[]; '@odata.nextLink'?: string } = await gGet(next, headers);
    out.push(...page.value);
    next = page['@odata.nextLink'];
  }
  return out;
}

export async function gSend<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await raw(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 202 || r.status === 204) return undefined as T;
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function gPutBytes<T>(path: string, data: ArrayBuffer | Uint8Array, contentType = 'application/pdf'): Promise<T> {
  const r = await raw(path, { method: 'PUT', body: data as BodyInit, headers: { 'Content-Type': contentType } });
  return (await r.json()) as T;
}
