/**
 * Nombres : détection des conventions de la source et reformatage.
 *
 * Le reformatage travaille sur les chiffres sous forme de texte (jamais via
 * parseFloat) : aucune perte de précision, même sur 20 chiffres significatifs.
 */

const SPACE_CLASS = '[ \\u00A0\\u202F]';
const LOOSE_NUMBER = /^[+-]?(?=[\d.,' \u00A0\u202F]*\d)[\d.,' \u00A0\u202F]+(?:[eE][+-]?\d+)?%?$/;

function escapeRe(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/**
 * Analyse l'ensemble des cellules pour déterminer le séparateur décimal et le
 * séparateur de milliers de la source, par un système de votes.
 *
 * @param {Iterable<string>} cells
 * @param {string} delimiter séparateur de colonnes de la source (sert d'indice par défaut)
 * @returns {{decimal: string, thousands: string, inferred: boolean, votes: object}}
 *   thousands vaut '' si aucun séparateur de milliers n'est détecté, ' ' pour la famille des espaces.
 */
export function analyzeNumberConventions(cells, delimiter) {
  const strong = { '.': 0, ',': 0 };
  const ambiguous = { '.': 0, ',': 0 };
  const group = { '.': 0, ',': 0, ' ': 0, "'": 0 };

  for (const raw of cells) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (!s || s.length > 64 || !LOOSE_NUMBER.test(s)) continue;

    const core = s
      .replace(/^[+-]/, '')
      .replace(/%$/, '')
      .replace(/[eE][+-]?\d+$/, '')
      .replace(/[\u00A0\u202F]/g, ' ');

    // Regroupement par espaces ou apostrophes : 1 234 567 / 1'234'567
    if (/[ ']/.test(core) && /^\d{1,3}(?:[ ']\d{3})+(?:[.,]\d+)?$/.test(core)) {
      group[core.includes("'") ? "'" : ' ']++;
    }

    const nDot = countChar(core, '.');
    const nComma = countChar(core, ',');

    if (nDot && nComma) {
      // Le dernier séparateur rencontré est la décimale : 1,234.56 ou 1.234,56
      const dec = core.lastIndexOf('.') > core.lastIndexOf(',') ? '.' : ',';
      strong[dec]++;
      group[dec === '.' ? ',' : '.']++;
      continue;
    }

    for (const [ch, count] of [['.', nDot], [',', nComma]]) {
      if (!count) continue;
      if (count > 1) {
        group[ch]++; // plusieurs occurrences : forcément des milliers
        continue;
      }
      const idx = core.indexOf(ch);
      const before = core.slice(0, idx);
      const after = core.slice(idx + 1);
      const looksLikeGroup = after.length === 3 && /^[1-9]\d{0,2}$/.test(before);
      if (looksLikeGroup) ambiguous[ch]++;
      else strong[ch]++;
    }
  }

  let decimal;
  let inferred = false;
  if (strong['.'] !== strong[',']) {
    decimal = strong['.'] > strong[','] ? '.' : ',';
  } else if (group['.'] !== group[',']) {
    decimal = group['.'] > group[','] ? ',' : '.';
  } else {
    // Aucun indice : dans un fichier séparé par des virgules, la décimale est le point.
    decimal = delimiter === ';' ? ',' : '.';
    inferred = true;
  }

  let thousands = '';
  let bestScore = 0;
  for (const ch of ['.', ',', ' ', "'"]) {
    if (ch === decimal) continue;
    const score = group[ch] + (ch === '.' || ch === ',' ? ambiguous[ch] : 0);
    if (score > bestScore) {
      bestScore = score;
      thousands = ch;
    }
  }

  return { decimal, thousands, inferred, votes: { strong, ambiguous, group } };
}

/**
 * Construit un parseur strict pour une convention donnée.
 * Retourne null si la cellule n'est pas un nombre valide dans cette convention.
 */
export function makeNumberParser({ decimal, thousands }) {
  const D = escapeRe(decimal);
  let intPart = '(\\d+)';
  let stripThousands = null;
  if (thousands) {
    const T = thousands === ' ' ? SPACE_CLASS : escapeRe(thousands);
    // Groupes stricts de 3 chiffres, premier groupe sans zéro initial.
    intPart = `([1-9]\\d{0,2}(?:${T}\\d{3})+|\\d+)`;
    stripThousands = new RegExp(T, 'g');
  }
  const re = new RegExp(`^([+-]?)(?:${intPart}(?:${D}(\\d+))?|${D}(\\d+))([eE][+-]?\\d+)?(%?)$`);

  return function parseNumber(raw) {
    if (typeof raw !== 'string') return null;
    const m = re.exec(raw.trim());
    if (!m) return null;
    const [, sign, intRaw, frac1, frac2, exp = '', pct] = m;
    const int = intRaw === undefined ? '' : stripThousands ? intRaw.replace(stripThousands, '') : intRaw;
    return { sign, int, frac: frac1 ?? frac2, exp, pct };
  };
}

function groupDigits(digits, sep) {
  const first = digits.length % 3 || 3;
  let out = digits.slice(0, first);
  for (let i = first; i < digits.length; i += 3) out += sep + digits.slice(i, i + 3);
  return out;
}

/**
 * Reformate un nombre parsé dans la convention cible.
 */
export function formatNumber(parsed, { decimal, thousands }) {
  let int = parsed.int;
  // Pas de regroupement pour les valeurs à zéros initiaux (codes, matricules).
  if (thousands && int.length > 3 && int[0] !== '0') int = groupDigits(int, thousands);
  let out = parsed.sign + int;
  if (parsed.frac !== undefined) out += decimal + parsed.frac;
  return out + parsed.exp + parsed.pct;
}
