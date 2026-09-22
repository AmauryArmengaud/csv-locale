/**
 * Service worker : surveille les téléchargements, convertit les CSV issus des
 * sites configurés et télécharge une copie convertie à côté de l'original
 * (l'original n'est jamais modifié).
 */

import { loadSettings, normalizeSettings, resolveTarget } from './lib/settings.js';
import { localeConventions } from './lib/locale.js';
import {
  urlMatchesPrefixes,
  prefixToOriginPattern,
  blobOrigin,
  safeOrigin,
  buildOutputName,
  isOneTimeDownloadUrl,
} from './lib/urls.js';
import { captureBytes } from './lib/capture.js';
import { convertCsvBytes } from './lib/converter.js';
import { describeReport } from './lib/report.js';
import { createBlobUrl, revokeBlobUrl } from './lib/output.js';
import { t } from './lib/i18n.js';

const HOOK_SCRIPT_ID = 'csv-locale-blob-hook';
const CSV_MIMES = /(^|\/)(csv|x-csv|comma-separated-values|tab-separated-values)\b/i;
const OWN_KEY = (id) => `own:${id}`;

/* ------------------------------ Paramètres ------------------------------ */

let settingsPromise = null;
const getSettings = () => (settingsPromise ??= loadSettings());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    const next = normalizeSettings(changes.settings.newValue);
    settingsPromise = Promise.resolve(next);
    syncContentScripts(next).catch((e) => console.error('[csv-locale] sync scripts', e));
  }
});

/* --------------------- Script de page (MAIN world) --------------------- */

const HOOK_FILE = 'src/content/page-hook.js';
let syncQueue = Promise.resolve();

/**
 * Enregistre le script de page sur l'origine entière de chaque site autorisé
 * (plus robuste qu'un motif de chemin), puis l'injecte dans les onglets déjà
 * ouverts pour éviter d'avoir à les recharger. Appels sérialisés.
 */
function syncContentScripts(settings) {
  syncQueue = syncQueue.then(() => doSync(settings)).catch((e) => console.error('[csv-locale] sync', e));
  return syncQueue;
}

async function doSync(settings) {
  const origins = [];
  for (const prefix of settings.urlPrefixes) {
    const origin = prefixToOriginPattern(prefix);
    if (!origins.includes(origin) && (await chrome.permissions.contains({ origins: [origin] }))) origins.push(origin);
  }
  const status = { at: Date.now(), version: chrome.runtime.getManifest().version, origins, error: null, injectedTabs: 0 };
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [HOOK_SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [HOOK_SCRIPT_ID] });
    if (origins.length) {
      await chrome.scripting.registerContentScripts([
        {
          id: HOOK_SCRIPT_ID,
          js: [HOOK_FILE],
          matches: origins,
          runAt: 'document_start',
          world: 'MAIN',
          allFrames: true,
          persistAcrossSessions: true,
        },
      ]);
      const tabs = await chrome.tabs.query({ url: origins });
      for (const tab of tabs) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', files: [HOOK_FILE] });
          status.injectedTabs++;
        } catch {
          /* onglet en erreur ou page interdite : il sera couvert au prochain chargement */
        }
        refreshBadge(tab.id, tab.url);
      }
    }
  } catch (e) {
    status.error = e.message;
  }
  await chrome.storage.local.set({ hookStatus: status });
}

const resync = () => getSettings().then(syncContentScripts);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await resync();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(resync);
chrome.permissions.onAdded.addListener(resync);
chrome.permissions.onRemoved.addListener(resync);
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

/* ------------------------ Badge d'état par onglet ------------------------ */

/**
 * Sur un site surveillé : badge "ON" si le script de page est actif dans
 * l'onglet, "!" sinon (onglet à recharger ou accès manquant).
 */
async function refreshBadge(tabId, url) {
  try {
    const settings = await getSettings();
    if (!url || !urlMatchesPrefixes(url, settings.urlPrefixes)) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: t('actionTitle') });
      return;
    }
    let active = false;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => Boolean(window.__csvLocaleFrDiag),
      });
      active = res?.result === true;
    } catch {
      active = false;
    }
    await chrome.action.setBadgeBackgroundColor({ tabId, color: active ? '#000000' : '#b3261e' });
    await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
    await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '!' });
    await chrome.action.setTitle({
      tabId,
      title: t(active ? 'badgeActive' : 'badgeInactive'),
    });
  } catch {
    /* onglet fermé entre-temps */
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') refreshBadge(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    refreshBadge(tabId, tab.url);
  } catch {
    /* ignoré */
  }
});

/* ------------------------- Contexte d'un download ------------------------ */

async function matchingTabs(prefixes, { origin = null, preferUrl = null } = {}) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return [];
  }
  return tabs
    .filter((t) => t.url && urlMatchesPrefixes(t.url, prefixes) && (!origin || safeOrigin(t.url) === origin))
    .sort(
      (a, b) =>
        Number(b.url === preferUrl) - Number(a.url === preferUrl) ||
        Number(b.active) - Number(a.active) ||
        (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
    );
}

/** Retourne null si le téléchargement ne provient pas d'un site configuré. */
async function matchContext(item, settings) {
  const prefixes = settings.urlPrefixes;
  if (!prefixes.length) return null;
  const url = item.finalUrl || item.url || '';

  const bOrigin = blobOrigin(url);
  if (bOrigin) {
    const tabs = await matchingTabs(prefixes, { origin: bOrigin });
    return tabs.length ? { kind: 'blob', url, tabs } : null;
  }
  if (url.startsWith('data:')) {
    const tabs = await matchingTabs(prefixes, { preferUrl: item.referrer });
    const ok = urlMatchesPrefixes(item.referrer, prefixes) || tabs.some((t) => t.active);
    return ok ? { kind: 'data', url, tabs } : null;
  }
  if (/^https?:/i.test(url) && (urlMatchesPrefixes(url, prefixes) || urlMatchesPrefixes(item.referrer, prefixes))) {
    const tabs = await matchingTabs(prefixes, { preferUrl: item.referrer });
    return { kind: 'http', url, tabs };
  }
  return null;
}

function isCsvDownload(item) {
  const name = (item.filename || '').toLowerCase();
  if (/\.(csv|tsv)$/.test(name)) return true;
  const hasExtension = /\.[a-z0-9]{1,5}$/.test(name.split(/[\\/]/).pop() || '');
  return !hasExtension && CSV_MIMES.test(item.mime || '');
}

/* ------------------------------ Diagnostic ------------------------------- */

/** Lit l'état du hook dans les onglets du site pour expliquer un échec. */
async function collectDiagnostic(tabs) {
  const frames = [];
  for (const tab of tabs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: 'MAIN',
        func: () => {
          const d = window.__csvLocaleFrDiag;
          return d ? { version: d.version, url: d.url, events: d.events() } : { version: null, url: location.pathname, events: [] };
        },
      });
      for (const r of results ?? []) if (r?.result) frames.push({ tabId: tab.id, frameId: r.frameId, ...r.result });
    } catch (e) {
      frames.push({ tabId: tab.id, error: e.message });
    }
  }
  const hooked = frames.filter((f) => f.version);
  let summary;
  if (!tabs.length) summary = t('diagNoTab');
  else if (!hooked.length) summary = t('diagNotInjected');
  else summary = t('diagUnknownMechanism');
  return { summary, frames, at: Date.now() };
}

/* ------------------------------ Historique ------------------------------- */

let historyQueue = Promise.resolve();
function record(entry) {
  historyQueue = historyQueue
    .then(async () => {
      const { history = [] } = await chrome.storage.local.get('history');
      history.unshift({ at: Date.now(), ...entry });
      await chrome.storage.local.set({ history: history.slice(0, 30) });
    })
    .catch((e) => console.error('[csv-locale] historique', e));
  return historyQueue;
}

async function notify(settings, title, message) {
  if (!settings.notify) return;
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message: message.slice(0, 300),
      priority: 0,
    });
  } catch (e) {
    console.warn('[csv-locale] notification', e);
  }
}

/* ------------------------------- Pipeline -------------------------------- */

/**
 * Les blobs sont souvent révoqués juste après le clic : on les lit dès la
 * création du téléchargement. Les URL http sont relues seulement une fois le
 * fichier confirmé comme CSV (évite une requête inutile au serveur).
 */
const earlyCaptures = new Map();

async function earlyCapture(item) {
  const settings = await getSettings();
  const ctx = await matchContext(item, settings);
  if (!ctx) return { skip: true };
  const bytes = await captureBytes(ctx, settings.maxSizeMB * 1024 * 1024);
  return { ctx, bytes };
}

chrome.downloads.onCreated.addListener((item) => {
  if (item.byExtensionId === chrome.runtime.id) return;
  const url = item.finalUrl || item.url || '';
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const p = earlyCapture(item);
    p.catch(() => {}); // erreur traitée à la fin du téléchargement
    earlyCaptures.set(item.id, p);
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state === 'complete') {
    onComplete(delta.id).catch((e) => console.error('[csv-locale] traitement', e));
  } else if (state === 'interrupted') {
    earlyCaptures.delete(delta.id);
    releaseOwn(delta.id).catch(() => {});
  }
});

async function releaseOwn(id) {
  const key = OWN_KEY(id);
  const stored = await chrome.storage.session.get(key);
  if (!stored[key]) return;
  await chrome.storage.session.remove(key);
  await revokeBlobUrl(stored[key]);
}

async function onComplete(id) {
  const [item] = await chrome.downloads.search({ id });
  if (!item) return;
  if (item.byExtensionId === chrome.runtime.id) {
    await releaseOwn(id);
    return;
  }

  const early = earlyCaptures.get(id);
  earlyCaptures.delete(id);
  const settings = await getSettings();
  if (!isCsvDownload(item)) return;

  let captured = null;
  let earlyError = null;
  if (early) {
    try {
      captured = await early;
    } catch (e) {
      earlyError = e;
    }
    if (captured?.skip) return;
  }

  const sourceName = (item.filename || '').split(/[\\/]/).pop();
  try {
    if (!captured) {
      // Pas de capture anticipée (http, ou service worker redémarré entre-temps).
      const ctx = await matchContext(item, settings);
      if (!ctx) return;
      if (ctx.kind === 'http' && isOneTimeDownloadUrl(ctx.url)) {
        // Fichier déjà consommé par le navigateur : une relecture renverrait 404.
        const diagnostic = await collectDiagnostic(ctx.tabs);
        const err = new Error(diagnostic.summary);
        err.diagnostic = diagnostic;
        throw err;
      }
      const maxBytes = settings.maxSizeMB * 1024 * 1024;
      if (item.fileSize > maxBytes) throw new Error(t('errTooLargeMB', { mb: settings.maxSizeMB }));
      captured = { ctx, bytes: await captureBytes(ctx, maxBytes) };
    }
  } catch (e) {
    const reason = (earlyError ?? e).message;
    await record({ status: 'error', source: sourceName, message: t('readFailed', { reason }), diagnostic: e.diagnostic });
    await notify(settings, t('notifFailTitle'), t('notifFailBody', { name: sourceName, reason }));
    return;
  }

  try {
    const target = resolveTarget(settings, localeConventions());
    const result = convertCsvBytes(captured.bytes, {
      target,
      ambiguousDateOrder: settings.ambiguousDateOrder,
      timezone: settings.timezone,
    });
    const summary = describeReport(result.report);

    if (result.unchanged && settings.skipIfUnchanged) {
      await record({ status: 'unchanged', source: sourceName, message: t('alreadyOk'), report: result.report });
      await notify(settings, t('notifUnchangedTitle'), t('notifUnchangedBody', { name: sourceName }));
      return;
    }

    const outputName = buildOutputName(item.filename, settings.suffix);
    const blobUrl = await createBlobUrl(result.text, settings.bom);
    let newId;
    try {
      newId = await chrome.downloads.download({ url: blobUrl, filename: outputName, conflictAction: 'uniquify', saveAs: false });
    } catch (e) {
      await revokeBlobUrl(blobUrl);
      throw e;
    }
    await chrome.storage.session.set({ [OWN_KEY(newId)]: blobUrl });
    // Petit fichier : la copie a pu se terminer avant l'enregistrement ci-dessus.
    const [own] = await chrome.downloads.search({ id: newId });
    if (own && own.state !== 'in_progress') await releaseOwn(newId);

    await record({ status: 'ok', source: sourceName, output: outputName, message: summary, report: result.report });
    const warn = result.report.warnings.length ? `\n⚠ ${result.report.warnings.join(' / ')}` : '';
    await notify(settings, t('notifOkTitle', { name: outputName }), `${summary}${warn}`);
  } catch (e) {
    await record({ status: 'error', source: sourceName, message: e.message });
    await notify(settings, t('notifFailTitle'), t('notifFailBody', { name: sourceName, reason: e.message }));
  }
}
