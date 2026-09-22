/** Paramètres de l'extension, stockés dans chrome.storage.sync. */

import { normalizePrefix } from './urls.js';
import { getLanguage } from './i18n.js';

/** Suffixe par défaut selon la langue de l'interface. */
export const defaultSuffix = () => (getLanguage() === 'fr' ? '_fr' : '_converted');

export const ALLOWED = Object.freeze({
  targetMode: ['auto', 'manual'],
  delimiter: [';', ',', '\t', '|'],
  decimal: [',', '.'],
  thousands: ['', ' ', '\u00A0', '\u202F', '.', ',', "'"],
  dateFormat: ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD'],
  ambiguousDateOrder: ['auto', 'DMY', 'MDY'],
  timezone: ['local', 'wallclock', 'skip'],
});

export const DEFAULT_SETTINGS = Object.freeze({
  urlPrefixes: [],
  targetMode: 'auto',
  manualTarget: { delimiter: ';', decimal: ',', dateFormat: 'DD/MM/YYYY' },
  thousands: '', // aucun : Excel relit "1234,5" sans ambiguïté
  ambiguousDateOrder: 'auto',
  timezone: 'local',
  bom: true,
  suffix: '_fr',
  notify: true,
  skipIfUnchanged: true,
  maxSizeMB: 100,
});

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;

  const prefixes = [];
  for (const p of Array.isArray(s.urlPrefixes) ? s.urlPrefixes : []) {
    try {
      const n = normalizePrefix(p);
      if (!prefixes.includes(n)) prefixes.push(n);
    } catch {
      /* préfixe invalide ignoré */
    }
  }

  const mt = s.manualTarget ?? {};
  const manualTarget = {
    delimiter: pick(mt.delimiter, ALLOWED.delimiter, d.manualTarget.delimiter),
    decimal: pick(mt.decimal, ALLOWED.decimal, d.manualTarget.decimal),
    dateFormat: pick(mt.dateFormat, ALLOWED.dateFormat, d.manualTarget.dateFormat),
  };
  if (manualTarget.delimiter === manualTarget.decimal) manualTarget.delimiter = manualTarget.decimal === ',' ? ';' : ',';

  const suffix = typeof s.suffix === 'string' ? s.suffix.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').slice(0, 30) : '';
  const maxSizeMB = Number.isFinite(s.maxSizeMB) ? Math.min(500, Math.max(1, Math.round(s.maxSizeMB))) : d.maxSizeMB;

  return {
    urlPrefixes: prefixes,
    targetMode: pick(s.targetMode, ALLOWED.targetMode, d.targetMode),
    manualTarget,
    thousands: pick(s.thousands, ALLOWED.thousands, d.thousands),
    ambiguousDateOrder: pick(s.ambiguousDateOrder, ALLOWED.ambiguousDateOrder, d.ambiguousDateOrder),
    timezone: pick(s.timezone, ALLOWED.timezone, d.timezone),
    bom: typeof s.bom === 'boolean' ? s.bom : d.bom,
    suffix: suffix || defaultSuffix(),
    notify: typeof s.notify === 'boolean' ? s.notify : d.notify,
    skipIfUnchanged: typeof s.skipIfUnchanged === 'boolean' ? s.skipIfUnchanged : d.skipIfUnchanged,
    maxSizeMB,
  };
}

/** Format cible effectif (auto = conventions de la locale). */
export function resolveTarget(settings, conventions) {
  const base =
    settings.targetMode === 'auto'
      ? { delimiter: conventions.listSeparator, decimal: conventions.decimal, dateFormat: conventions.dateFormat }
      : { ...settings.manualTarget };
  const thousands = settings.thousands === base.decimal ? '' : settings.thousands;
  return { ...base, thousands };
}

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return normalizeSettings(settings);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.sync.set({ settings: normalized });
  return normalized;
}
