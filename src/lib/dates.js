/**
 * Dates : reconnaissance, résolution de l'ordre jour/mois et reformatage.
 *
 * Formats reconnus :
 *   ISO 8601   2024-03-15, 2024-03-15T14:05:09.123Z, 2024-03-15 14:05+02:00
 *   A/M/J      2024/3/15
 *   J/M/A      15/03/2024, 15-03-24, 15.03.2024
 *   M/J/A      03/15/2024 2:05 PM
 *   Oracle     28-FEB-2025, 28-Feb-25, 28-FÉVR.-25, 28-FEB-25 02.30.15.000000 PM
 * Une colonne n'est convertie que si 100 % de ses valeurs sont des dates
 * valides dans un même ordre (le 31/02 est rejeté, par exemple).
 */

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:\s*(Z|[+-]\d{2}(?::?\d{2})?))?)?$/;

const GENERIC_RE =
  /^(\d{1,4})([/.-])(\d{1,2})\2(\d{1,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(?:\s*([AaPp])\.?[Mm]\.?)?)?$/;

// Format Oracle DD-MON-RR / DD-MON-YYYY, avec heure optionnelle (HH.MI.SS.FF ou HH:MI:SS).
const ORACLE_RE =
  /^(\d{1,2})([- /])([A-Za-zÀ-ÿ]{3,5})\.?\2(\d{2}|\d{4})(?:[ T]+(\d{1,2})[.:](\d{2})(?:[.:](\d{2})(?:[.,](\d{1,9}))?)?(?:\s*([AaPp])\.?[Mm]\.?)?)?$/;

// Abréviations Oracle, NLS_LANGUAGE AMERICAN et FRENCH (accents retirés avant comparaison).
const MONTHS = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANV: 1, FEVR: 2, MARS: 3, AVR: 4, MAI: 5, JUIN: 6, JUIL: 7, AOUT: 8,
};

export function monthFromName(name) {
  const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return MONTHS[key] ?? null;
}

/**
 * Règle RR d'Oracle pour les années sur 2 chiffres.
 * En 2026 : 00-49 → 2000-2049, 50-99 → 1950-1999.
 */
export function rrYear(yy, currentYear = new Date().getFullYear()) {
  const century = Math.floor(currentYear / 100) * 100;
  if (currentYear % 100 < 50) return yy < 50 ? century + yy : century - 100 + yy;
  return yy < 50 ? century + 100 + yy : century + yy;
}

export const TWO_DIGIT_YEAR_PIVOT = 50; // 00-49 → 2000-2049, 50-99 → 1950-1999

function time(h, mi, s, frac, ampm) {
  if (h === undefined) return null;
  return {
    h: Number(h),
    mi: Number(mi),
    s: s === undefined ? null : Number(s),
    frac: frac ?? null,
    ampm: ampm ? ampm.toLowerCase() : null,
  };
}

/** Découpe une cellule en composants bruts, sans encore trancher l'ordre J/M. */
export function tokenizeDate(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 6 || s.length > 40) return null;

  let m = ISO_RE.exec(s);
  if (m) {
    return {
      family: 'ymd',
      y: Number(m[1]),
      m: Number(m[2]),
      d: Number(m[3]),
      yearDigits: 4,
      time: time(m[4], m[5], m[6], m[7], undefined),
      tz: m[8] ?? null,
    };
  }

  m = ORACLE_RE.exec(s);
  if (m) {
    const month = monthFromName(m[3]);
    if (!month) return null;
    return {
      family: 'ymd', // non ambigu : le mois est écrit en lettres
      y: m[4].length === 2 ? rrYear(Number(m[4])) : Number(m[4]),
      m: month,
      d: Number(m[1]),
      yearDigits: 4,
      time: time(m[5], m[6], m[7], m[8], m[9]),
      tz: null,
    };
  }

  m = GENERIC_RE.exec(s);
  if (!m) return null;
  const [, p1, sep, p2, p3] = m;
  const t = time(m[5], m[6], m[7], m[8], m[9]);

  if (p1.length === 4) {
    if (p3.length > 2) return null;
    return { family: 'ymd', y: Number(p1), m: Number(p2), d: Number(p3), yearDigits: 4, time: t, tz: null };
  }
  if (p1.length > 2) return null;
  if (p3.length !== 2 && p3.length !== 4) return null;
  // "1.2.33" ressemble plus à un numéro de version qu'à une date.
  if (sep === '.' && p3.length !== 4) return null;
  return { family: 'xy', x: Number(p1), yv: Number(p2), year: Number(p3), yearDigits: p3.length, time: t, tz: null };
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Applique l'ordre et valide le calendrier. Retourne null si invalide. */
export function resolveDate(tok, order) {
  let y;
  let mo;
  let d;
  if (tok.family === 'ymd') {
    ({ y, m: mo, d } = tok);
  } else {
    if (order !== 'DMY' && order !== 'MDY') return null;
    y = tok.yearDigits === 2 ? (tok.year < TWO_DIGIT_YEAR_PIVOT ? 2000 : 1900) + tok.year : tok.year;
    [d, mo] = order === 'DMY' ? [tok.x, tok.yv] : [tok.yv, tok.x];
  }
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;

  let t = null;
  if (tok.time) {
    let { h } = tok.time;
    const { mi, s, frac, ampm } = tok.time;
    if (ampm) {
      if (h < 1 || h > 12) return null;
      if (ampm === 'a') h = h === 12 ? 0 : h;
      else h = h === 12 ? 12 : h + 12;
    }
    if (h > 23 || mi > 59 || (s !== null && s > 59)) return null;
    t = { h, mi, s, frac };
  }
  return { y, mo, d, time: t, tz: tok.tz };
}

function tzOffsetMinutes(tz) {
  if (tz === 'Z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(tz);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

/**
 * Analyse une colonne. Retourne null si ce n'est pas (entièrement) une colonne de dates.
 * @param {string[]} values valeurs non vides
 * @param {{ambiguousOrder: 'auto'|'DMY'|'MDY', sourceHint: 'DMY'|'MDY', timezone: string}} opts
 */
export function analyzeDateColumn(values, { ambiguousOrder = 'auto', sourceHint = 'MDY', timezone = 'local' } = {}) {
  if (!values.length) return null;
  const tokens = [];
  let hasXY = false;
  let xOver12 = false;
  let yOver12 = false;
  let hasTz = false;

  for (const v of values) {
    const t = tokenizeDate(v);
    if (!t) return null;
    if (t.family === 'xy') {
      hasXY = true;
      if (t.x > 12) xOver12 = true;
      if (t.yv > 12) yOver12 = true;
    }
    if (t.tz) hasTz = true;
    tokens.push(t);
  }
  if (xOver12 && yOver12) return null; // incohérent : pas une colonne de dates homogène
  if (hasTz && timezone === 'skip') return null;

  let order = null;
  let ambiguous = false;
  if (hasXY) {
    if (xOver12) order = 'DMY';
    else if (yOver12) order = 'MDY';
    else {
      ambiguous = true;
      order = ambiguousOrder === 'auto' ? sourceHint : ambiguousOrder;
    }
  }

  for (const t of tokens) if (!resolveDate(t, order)) return null;
  return { order, ambiguous, hasTz };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * Formate une cellule selon l'analyse de sa colonne.
 * @param {string} raw
 * @param {{order: string|null}} analysis
 * @param {{dateFormat: string, decimal: string}} target
 * @param {'local'|'wallclock'|'skip'} timezone
 * @returns {string|null}
 */
export function formatDateCell(raw, analysis, target, timezone = 'local') {
  const tok = tokenizeDate(raw);
  if (!tok) return null;
  const r = resolveDate(tok, analysis.order);
  if (!r) return null;

  let { y, mo, d } = r;
  let t = r.time;

  if (r.tz && t) {
    if (timezone === 'skip') return null;
    if (timezone === 'local') {
      const offset = tzOffsetMinutes(r.tz);
      if (offset === null) return null;
      const epoch = Date.UTC(y, mo - 1, d, t.h, t.mi, t.s ?? 0) - offset * 60000;
      const local = new Date(epoch);
      y = local.getFullYear();
      mo = local.getMonth() + 1;
      d = local.getDate();
      t = { ...t, h: local.getHours(), mi: local.getMinutes(), s: t.s === null ? null : local.getSeconds() };
    }
    // 'wallclock' : heure affichée conservée, décalage abandonné.
  }

  let out = target.dateFormat.replace(/YYYY|MM|DD/g, (tokName) =>
    tokName === 'YYYY' ? pad(y, 4) : tokName === 'MM' ? pad(mo) : pad(d),
  );
  if (t) {
    out += ` ${pad(t.h)}:${pad(t.mi)}`;
    if (t.s !== null) out += `:${pad(t.s)}`;
    // Fraction nulle (.000000 des TIMESTAMP Oracle) omise : Excel relit mieux sans.
    if (t.s !== null && t.frac && /[1-9]/.test(t.frac)) out += target.decimal + t.frac;
  }
  return out;
}
