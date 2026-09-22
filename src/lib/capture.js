/**
 * Récupération des octets d'un téléchargement.
 *
 * Une extension ne peut pas lire un fichier sur le disque. Selon l'URL :
 *   data:  décodée localement
 *   blob:  lue dans l'onglet d'origine (le hook MAIN world garde une référence au Blob)
 *   http:  relue depuis le service worker (cookies inclus), sinon depuis l'onglet
 */

import { t } from './i18n.js';

export class CaptureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CaptureError';
  }
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) throw new CaptureError(t('errDataUrl'));
  const meta = url.slice(5, comma);
  const data = url.slice(comma + 1);
  if (/;base64$/i.test(meta)) return base64ToBytes(data.replace(/\s/g, ''));

  // Décodage pourcent octet par octet (tolère le Latin-1 encodé en %E9).
  const encoder = new TextEncoder();
  const bytes = [];
  for (const seg of data.match(/%[0-9a-fA-F]{2}|[^%]+|%/g) ?? []) {
    if (seg.length === 3 && seg[0] === '%') bytes.push(parseInt(seg.slice(1), 16));
    else for (const b of encoder.encode(seg)) bytes.push(b);
  }
  return new Uint8Array(bytes);
}

/* ---------- Fonctions injectées dans la page (doivent rester autonomes) ---------- */

async function pageReadBlob(url, maxBytes) {
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  try {
    const hook = window.__csvLocaleFrHook;
    let blob = hook ? hook.get(url) : null;
    if (!blob) {
      const res = await fetch(url);
      if (!res.ok) return { error: 'http', detail: res.status };
      blob = await res.blob();
    }
    if (blob.size > maxBytes) return { error: 'too-large' };
    return { b64: toB64(await blob.arrayBuffer()) };
  } catch (e) {
    return { error: 'blob', detail: e && e.message ? e.message : String(e) };
  }
}

async function pageFetchUrl(url, maxBytes) {
  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { error: 'http', detail: res.status };
    if (/text\/html/i.test(res.headers.get('content-type') || '')) return { error: 'html' };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) return { error: 'too-large' };
    return { b64: toB64(buf) };
  } catch (e) {
    return { error: 'fetch', detail: e && e.message ? e.message : String(e) };
  }
}

/* ---------------------------------------------------------------------------------- */

function pageError({ error, detail }) {
  switch (error) {
    case 'http':
      return `HTTP ${detail}`;
    case 'html':
      return t('errHtml');
    case 'too-large':
      return t('errTooLarge');
    case 'blob':
      return t('errBlobUnreadable', { detail });
    default:
      return t('errTabFetch', { detail });
  }
}

async function readFromTabs(tabs, func, args, world) {
  const errors = [];
  for (const tab of tabs) {
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world, func, args });
      for (const r of results ?? []) {
        if (typeof r?.result?.b64 === 'string') return base64ToBytes(r.result.b64);
        if (r?.result?.error) errors.push(pageError(r.result));
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new CaptureError(errors.length ? [...new Set(errors)].join(' ; ') : t('errNoTab'));
}

async function fetchInWorker(url, maxBytes) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new CaptureError(`HTTP ${res.status}`);
  if (/text\/html/i.test(res.headers.get('content-type') || '')) throw new CaptureError(t('errHtml'));
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) throw new CaptureError(t('errTooLarge'));
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new CaptureError(t('errTooLarge'));
  return new Uint8Array(buf);
}

/**
 * @param {{kind: 'data'|'blob'|'http', url: string, tabs: chrome.tabs.Tab[]}} ctx
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array>}
 */
export async function captureBytes(ctx, maxBytes) {
  if (ctx.kind === 'data') {
    const bytes = decodeDataUrl(ctx.url);
    if (bytes.length > maxBytes) throw new CaptureError(t('errTooLarge'));
    return bytes;
  }
  if (ctx.kind === 'blob') return readFromTabs(ctx.tabs, pageReadBlob, [ctx.url, maxBytes], 'MAIN');

  let workerError;
  try {
    return await fetchInWorker(ctx.url, maxBytes);
  } catch (e) {
    workerError = e;
  }
  if (!ctx.tabs.length) throw new CaptureError(t('errRefetch', { detail: workerError.message }));
  try {
    return await readFromTabs(ctx.tabs, pageFetchUrl, [ctx.url, maxBytes], 'ISOLATED');
  } catch (e) {
    throw new CaptureError(t('errRefetch', { detail: `${workerError.message} ; ${e.message}` }));
  }
}
