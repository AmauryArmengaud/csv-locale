import { loadSettings, saveSettings, resolveTarget } from '../lib/settings.js';
import { normalizePrefix, prefixToOriginPattern, buildOutputName } from '../lib/urls.js';
import { localeConventions } from '../lib/locale.js';
import { convertCsvBytes, convertCsvText } from '../lib/converter.js';
import { parseCsv } from '../lib/csv.js';
import { describeReport } from '../lib/report.js';
import { t, getLanguage, uiLocale } from '../lib/i18n.js';

/* -------------------------------- Langue --------------------------------- */

document.documentElement.lang = getLanguage();
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);

const $ = (id) => document.getElementById(id);
const conventions = localeConventions();
let settings = await loadSettings();

const FIELDS = ['ambiguousDateOrder', 'timezone', 'suffix', 'maxSizeMB', 'bom', 'skipIfUnchanged', 'notify', 'thousands'];
const TARGET_FIELDS = ['delimiter', 'decimal', 'dateFormat'];

/* ------------------------------ Enregistrement ------------------------------ */

let savedTimer;
async function persist() {
  settings = await saveSettings(settings);
  $('save-status').textContent = t('o.saved');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('save-status').textContent = ''), 2000);
  renderPreview();
}

/* ---------------------------------- Sites ---------------------------------- */

function showPrefixError(message) {
  $('prefix-error').textContent = message;
  $('prefix-error').hidden = !message;
}

async function renderPrefixes() {
  const { hookStatus } = await chrome.storage.local.get('hookStatus');
  $('hook-error').hidden = !hookStatus?.error;
  $('hook-error').textContent = hookStatus?.error ? t('o.hookError', { error: hookStatus.error }) : '';
  const list = $('prefix-list');
  list.replaceChildren();
  $('prefix-empty').hidden = settings.urlPrefixes.length > 0;

  for (const prefix of settings.urlPrefixes) {
    const origin = prefixToOriginPattern(prefix);
    const granted = await chrome.permissions.contains({ origins: [origin] });

    const li = document.createElement('li');
    const url = document.createElement('span');
    url.className = 'prefix-url';
    url.textContent = prefix;

    const status = document.createElement('span');
    status.className = granted ? 'status-ok' : 'status-missing';
    const hooked = granted && hookStatus?.origins?.includes(origin);
    status.textContent = t(!granted ? 'o.statusMissing' : hooked ? 'o.statusActive' : 'o.statusPending');
    li.append(url, status);

    if (!granted) {
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'quiet';
      allow.textContent = t('o.allow');
      allow.addEventListener('click', () => {
        chrome.permissions.request({ origins: [origin] }).then(renderPrefixes);
      });
      li.append(allow);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'quiet';
    remove.textContent = t('o.remove');
    remove.setAttribute('aria-label', t('o.removeAria', { prefix }));
    remove.addEventListener('click', async () => {
      settings.urlPrefixes = settings.urlPrefixes.filter((p) => p !== prefix);
      await persist();
      const stillUsed = settings.urlPrefixes.some((p) => prefixToOriginPattern(p) === origin);
      if (!stillUsed) await chrome.permissions.remove({ origins: [origin] }).catch(() => {});
      renderPrefixes();
    });
    li.append(remove);
    list.append(li);
  }
}

$('prefix-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  showPrefixError('');
  let prefix;
  try {
    prefix = normalizePrefix($('prefix-input').value);
  } catch (e) {
    showPrefixError(e.message);
    return;
  }
  if (settings.urlPrefixes.includes(prefix)) {
    showPrefixError(t('o.alreadyListed'));
    return;
  }
  // Appel synchrone dans le geste utilisateur, exigé par Chrome.
  chrome.permissions.request({ origins: [prefixToOriginPattern(prefix)] }).then(async (granted) => {
    settings.urlPrefixes = [...settings.urlPrefixes, prefix];
    await persist();
    $('prefix-input').value = '';
    if (!granted) showPrefixError(t('o.accessDenied'));
    renderPrefixes();
  });
});

/* --------------------------------- Format ---------------------------------- */

function ensureOption(select, value, label) {
  if (![...select.options].some((o) => o.value === value)) {
    select.add(new Option(label, value));
  }
}

function renderForm() {
  for (const radio of document.querySelectorAll('input[name="targetMode"]')) radio.checked = radio.value === settings.targetMode;
  $('locale-name').textContent = `(${conventions.locale})`;

  const auto = settings.targetMode === 'auto';
  const shown = auto
    ? { delimiter: conventions.listSeparator, decimal: conventions.decimal, dateFormat: conventions.dateFormat }
    : settings.manualTarget;
  ensureOption($('dateFormat'), shown.dateFormat, shown.dateFormat);
  for (const f of TARGET_FIELDS) {
    $(f).value = shown[f];
    $(f).disabled = auto;
  }

  for (const f of FIELDS) {
    const el = $(f);
    if (el.type === 'checkbox') el.checked = settings[f];
    else el.value = settings[f];
  }
}

function readForm() {
  settings.targetMode = document.querySelector('input[name="targetMode"]:checked')?.value ?? 'auto';
  if (settings.targetMode === 'manual') {
    for (const f of TARGET_FIELDS) settings.manualTarget[f] = $(f).value;
  }
  for (const f of FIELDS) {
    const el = $(f);
    settings[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  }
}

document.querySelectorAll('input[name="targetMode"]').forEach((radio) =>
  radio.addEventListener('change', async () => {
    // En passant en manuel, on part des valeurs détectées.
    if (radio.value === 'manual' && radio.checked && settings.targetMode === 'auto') {
      settings.manualTarget = { delimiter: conventions.listSeparator, decimal: conventions.decimal, dateFormat: conventions.dateFormat };
    }
    settings.targetMode = radio.value;
    await persist();
    renderForm();
  }),
);

for (const f of [...TARGET_FIELDS, ...FIELDS]) {
  $(f).addEventListener('change', async () => {
    readForm();
    await persist();
    renderForm();
  });
}

/* --------------------------------- Aperçu ---------------------------------- */

const SAMPLE = 'montant,date,ville\n"1,234.56",03/15/2024,"Lyon; Paris"\n';

function renderCells(code, cells, delimiter) {
  code.replaceChildren();
  cells.forEach((cell, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = delimiter === '\t' ? ' ⇥ ' : delimiter;
      code.append(sep);
    }
    const needsQuotes = cell.includes(delimiter) || cell.includes('"');
    code.append(needsQuotes ? `"${cell.replaceAll('"', '""')}"` : cell);
  });
}

function renderPreview() {
  renderCells($('preview-before'), parseCsv(SAMPLE, ',').rows[1], ',');
  try {
    const target = resolveTarget(settings, conventions);
    const { text, report } = convertCsvText(SAMPLE, { target, ambiguousDateOrder: settings.ambiguousDateOrder, timezone: settings.timezone });
    renderCells($('preview-after'), parseCsv(text, report.outDelimiter).rows[1], report.outDelimiter);
  } catch (e) {
    $('preview-after').textContent = t('o.previewError', { message: e.message });
  }
}

/* ------------------------------ Test de fichier ----------------------------- */

const TYPE_KEY = { number: 'o.typeNumber', date: 'o.typeDate', text: 'o.typeText', empty: 'o.typeEmpty' };
let testUrl = null;

$('test-file').addEventListener('change', async () => {
  const file = $('test-file').files?.[0];
  $('test-error').hidden = true;
  $('test-result').hidden = true;
  if (!file) return;
  try {
    if (file.size > settings.maxSizeMB * 1024 * 1024) throw new Error(t('errTooLargeMB', { mb: settings.maxSizeMB }));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, report, unchanged } = convertCsvBytes(bytes, {
      target: resolveTarget(settings, conventions),
      ambiguousDateOrder: settings.ambiguousDateOrder,
      timezone: settings.timezone,
    });

    $('test-summary').textContent = unchanged ? t('o.testUnchanged') : `${describeReport(report)}.`;
    $('test-warnings').replaceChildren(
      ...report.warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })),
    );

    $('test-columns').replaceChildren(
      ...report.columns.map((c) => {
        const tr = document.createElement('tr');
        const order = c.type === 'date' && c.dateOrder ? t(c.dateOrder === 'MDY' ? 'o.orderMDY' : 'o.orderDMY') : '';
        const cells = [c.name || t('o.columnN', { n: c.index + 1 }), t(TYPE_KEY[c.type]) + order, c.changedCells.toLocaleString(uiLocale())];
        cells.forEach((value, i) => {
          const td = document.createElement('td');
          td.textContent = value;
          if (i === 1) td.className = `type-${c.type}`;
          if (i === 2) td.className = 'num';
          tr.append(td);
        });
        return tr;
      }),
    );

    if (testUrl) URL.revokeObjectURL(testUrl);
    testUrl = URL.createObjectURL(new Blob(settings.bom ? ['\uFEFF', text] : [text], { type: 'text/csv;charset=utf-8' }));
    const link = $('test-download');
    link.href = testUrl;
    link.download = buildOutputName(file.name, settings.suffix);
    $('test-result').hidden = false;
  } catch (e) {
    $('test-error').textContent = t('o.testError', { message: e.message });
    $('test-error').hidden = false;
  }
});

/* -------------------------------- Historique -------------------------------- */

const dateFmt = new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'short', timeStyle: 'short' });

async function renderHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  $('history-empty').hidden = history.length > 0;
  $('history-clear').hidden = history.length === 0;
  $('history').replaceChildren(
    ...history.map((h) => {
      const li = document.createElement('li');
      const when = Object.assign(document.createElement('span'), { className: 'when', textContent: dateFmt.format(h.at) });
      const what = Object.assign(document.createElement('span'), {
        className: 'what',
        textContent: h.output ? `${h.source} → ${h.output}` : h.source || t('o.fileFallback'),
      });
      const msg = Object.assign(document.createElement('span'), {
        className: h.status === 'error' ? 'is-error' : h.status === 'unchanged' ? 'is-unchanged' : '',
        textContent: h.message + (h.report?.warnings?.length ? ` (⚠ ${h.report.warnings.join(' / ')})` : ''),
      });
      li.append(when, what, msg);
      if (h.diagnostic) {
        const details = document.createElement('details');
        const summary = Object.assign(document.createElement('summary'), { textContent: t('o.diagnostic') });
        const pre = Object.assign(document.createElement('pre'), { textContent: JSON.stringify(h.diagnostic, null, 2) });
        const copy = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: t('o.copyDiagnostic') });
        copy.addEventListener('click', () => navigator.clipboard.writeText(pre.textContent).then(() => (copy.textContent = t('o.copied'))));
        details.append(summary, pre, copy);
        li.append(details);
      }
      return li;
    }),
  );
}

$('history-clear').addEventListener('click', () => chrome.storage.local.set({ history: [] }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) renderHistory();
  if (area === 'local' && changes.hookStatus) renderPrefixes();
});
chrome.permissions.onAdded.addListener(renderPrefixes);
chrome.permissions.onRemoved.addListener(renderPrefixes);

/* ---------------------------------- Init ---------------------------------- */

$('version').textContent = `v${chrome.runtime.getManifest().version}`;
renderForm();
renderPreview();
renderPrefixes();
renderHistory();
