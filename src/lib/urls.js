/** Gestion des préfixes d'URL. */

import { t } from './i18n.js';

export function normalizePrefix(input) {
  const s = String(input ?? '').trim();
  if (!s) throw new Error(t('errPrefixEmpty'));
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(t('errPrefixInvalid', { url: s }));
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(t('errPrefixProtocol'));
  if (u.username || u.password) throw new Error(t('errPrefixCredentials'));
  u.hash = '';
  return u.href;
}

export function urlMatchesPrefixes(url, prefixes) {
  if (!url || !prefixes?.length) return false;
  return prefixes.some((p) => url.startsWith(p));
}

/** Motif pour registerContentScripts (le port et la query ne sont pas exprimables). */
export function prefixToMatchPattern(prefix) {
  const u = new URL(prefix);
  return `${u.protocol}//${u.hostname}${u.pathname}*`;
}

/** Motif d'origine pour chrome.permissions. */
export function prefixToOriginPattern(prefix) {
  const u = new URL(prefix);
  return `${u.protocol}//${u.hostname}/*`;
}

export function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** "blob:https://site/uuid" → "https://site" */
export function blobOrigin(url) {
  if (!url?.startsWith('blob:')) return null;
  return safeOrigin(url.slice(5));
}

export function buildOutputName(fullPath, suffix) {
  const base = String(fullPath ?? '').split(/[\\/]/).pop() || 'export.csv';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '.csv';
  const name = `${stem}${suffix}${ext}`
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return (name || 'export.csv').slice(0, 200);
}

/**
 * URL de téléchargement servies une seule fois par le serveur : les relire
 * renvoie une erreur. Règles dupliquées dans src/content/page-hook.js.
 */
export function isOneTimeDownloadUrl(href) {
  try {
    const u = new URL(href);
    if (/\/wwv_flow\.ajax$/i.test(u.pathname)) {
      let q = u.search;
      try {
        q = decodeURIComponent(q);
      } catch {
        /* version brute */
      }
      return q.includes('downloadFileId'); // Oracle APEX
    }
    return false;
  } catch {
    return false;
  }
}
