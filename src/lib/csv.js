/**
 * Lecture et écriture CSV.
 *
 * Parseur RFC 4180 tolérant : champs entre guillemets, guillemets doublés,
 * sauts de ligne dans les champs, fins de ligne CRLF / LF / CR.
 * Aucune dépendance, aucun accès réseau.
 */

import { t } from './i18n.js';

const QUOTE = 34; // "
const CR = 13;
const LF = 10;

export const DELIMITER_CANDIDATES = Object.freeze([',', ';', '\t', '|']);

export class CsvParseError extends Error {
  constructor(message, { line } = {}) {
    super(message);
    this.name = 'CsvParseError';
    this.line = line;
  }
}

/**
 * Décode des octets en texte. Ordre : BOM explicite, UTF-8 strict, puis Windows-1252.
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{text: string, encoding: string, bom: boolean}}
 */
export function decodeBytes(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8', bom: true };
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le', bom: true };
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be', bom: true };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8', bom: false };
  } catch {
    // Octets invalides en UTF-8 : export "ANSI" typique d'outils Windows.
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'windows-1252', bom: false };
  }
}

function scanUnquoted(text, i, D) {
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === D || c === CR || c === LF) break;
    i++;
  }
  return i;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === LF) line++;
  return line;
}

function dominantEol(counts) {
  let best = '\r\n';
  let max = 0;
  for (const [eol, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      best = eol;
    }
  }
  return best;
}

/**
 * Parse un texte CSV.
 * @param {string} text
 * @param {string} delimiter un seul caractère
 * @param {{maxRows?: number, lenient?: boolean}} [options]
 *   lenient : accepte un guillemet non fermé (utile pour analyser un échantillon tronqué).
 * @returns {{rows: string[][], lineEnding: string, trailingNewline: boolean, truncated: boolean}}
 */
export function parseCsv(text, delimiter, { maxRows = Infinity, lenient = false } = {}) {
  if (typeof delimiter !== 'string' || delimiter.length !== 1) {
    throw new TypeError('delimiter must be a single character');
  }
  const D = delimiter.charCodeAt(0);
  if (D === QUOTE || D === CR || D === LF) throw new TypeError('forbidden delimiter');

  const n = text.length;
  const rows = [];
  const eolCounts = { '\r\n': 0, '\n': 0, '\r': 0 };
  let trailingNewline = false;
  let truncated = false;
  if (n === 0) return { rows, lineEnding: '\r\n', trailingNewline, truncated };

  let i = 0;
  let row = [];
  for (;;) {
    let field;
    if (text.charCodeAt(i) === QUOTE) {
      const start = i;
      i++;
      let chunkStart = i;
      field = '';
      for (;;) {
        const q = text.indexOf('"', i);
        if (q === -1) {
          if (!lenient) {
            const line = lineAt(text, start);
            throw new CsvParseError(t('errUnclosedQuote', { line }), { line });
          }
          field += text.slice(chunkStart);
          i = n;
          break;
        }
        if (text.charCodeAt(q + 1) === QUOTE) {
          field += text.slice(chunkStart, q + 1);
          i = q + 2;
          chunkStart = i;
          continue;
        }
        field += text.slice(chunkStart, q);
        i = q + 1;
        break;
      }
      // Texte parasite après le guillemet fermant (ex. "abc"def) : conservé tel quel.
      const j = scanUnquoted(text, i, D);
      if (j > i) {
        field += text.slice(i, j);
        i = j;
      }
    } else {
      const j = scanUnquoted(text, i, D);
      field = text.slice(i, j);
      i = j;
    }

    row.push(field);
    if (i >= n) {
      rows.push(row);
      break;
    }

    const c = text.charCodeAt(i);
    if (c === D) {
      i++;
      if (i >= n) {
        row.push('');
        rows.push(row);
        break;
      }
      continue;
    }

    // Fin de ligne
    const eol = c === CR ? (text.charCodeAt(i + 1) === LF ? '\r\n' : '\r') : '\n';
    eolCounts[eol]++;
    i += eol.length;
    rows.push(row);
    row = [];
    if (i >= n) {
      trailingNewline = true;
      break;
    }
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
  }

  return { rows, lineEnding: dominantEol(eolCounts), trailingNewline, truncated };
}

function quoteIfNeeded(value, delimiter) {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/**
 * Sérialise des lignes en CSV (guillemets uniquement quand nécessaire).
 */
export function serializeCsv(rows, delimiter, { lineEnding = '\r\n', trailingNewline = true } = {}) {
  const lines = new Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cells = new Array(row.length);
    for (let c = 0; c < row.length; c++) cells[c] = quoteIfNeeded(row[c], delimiter);
    lines[r] = cells.join(delimiter);
  }
  let text = lines.join(lineEnding);
  if (trailingNewline && rows.length) text += lineEnding;
  return text;
}

/**
 * Détecte le séparateur en mesurant la régularité du nombre de colonnes.
 * Retourne null si le fichier ne semble avoir qu'une seule colonne.
 */
export function detectDelimiter(text, { sampleSize = 256 * 1024, maxRows = 1000 } = {}) {
  const partial = text.length > sampleSize;
  const sample = partial ? text.slice(0, sampleSize) : text;
  let best = null;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const { rows, truncated } = parseCsv(sample, delimiter, { maxRows, lenient: true });
    let usable = rows.filter((r) => !(r.length === 1 && r[0] === ''));
    // La dernière ligne d'un échantillon coupé peut être incomplète.
    if (partial && !truncated && usable.length > 1) usable = usable.slice(0, -1);
    if (!usable.length) continue;

    const freq = new Map();
    for (const r of usable) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
    let mode = 0;
    let modeCount = 0;
    for (const [len, count] of freq) {
      if (count > modeCount || (count === modeCount && len > mode)) {
        mode = len;
        modeCount = count;
      }
    }
    if (mode < 2) continue;

    const consistency = modeCount / usable.length;
    const better =
      !best ||
      consistency > best.consistency + 1e-9 ||
      (Math.abs(consistency - best.consistency) <= 1e-9 && mode > best.mode);
    if (better) best = { delimiter, consistency, mode };
  }
  return best ? best.delimiter : null;
}
