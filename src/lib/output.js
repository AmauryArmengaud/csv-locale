/**
 * Un service worker MV3 ne peut pas créer d'URL blob : on délègue à un
 * document offscreen (raison BLOBS). Pas de data: URL, qui plafonne vite
 * sur les gros fichiers.
 */

import { t } from './i18n.js';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Create a blob URL to download the converted CSV',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function createBlobUrl(text, bom) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'create-blob-url', text, bom });
  if (!res?.url) throw new Error(res?.error || t('errCreateFile'));
  return res.url;
}

export async function revokeBlobUrl(url) {
  if (!(await chrome.offscreen.hasDocument())) return;
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', url });
  if (res && res.remaining === 0) {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}
