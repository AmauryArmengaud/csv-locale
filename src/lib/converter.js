/**
 * Moteur de conversion. Fonctions pures, testables sous Node.
 *
 * Principe de sûreté : une colonne n'est modifiée que si TOUTES ses valeurs
 * (hors en-tête et valeurs nulles) sont du même type reconnu. Une colonne
 * mixte ("12.5", "abc") reste intacte. Les entiers sans séparateur de milliers
 * (identifiants, matricules) ne changent jamais.
 */

import { decodeBytes, parseCsv, serializeCsv, detectDelimiter } from './csv.js';
import { analyzeNumberConventions, makeNumberParser, formatNumber } from './numbers.js';
import { analyzeDateColumn, formatDateCell } from './dates.js';
import { t } from './i18n.js';

const NULL_TOKENS = new Set(['', 'na', 'n/a', 'null', 'none', 'nan', '-', '--', '#n/a', 'nil']);
const isNullToken = (v) => NULL_TOKENS.has(v.trim().toLowerCase());
const isBlankRow = (row) => row.length === 1 && row[0] === '';

const VALID_DELIMITERS = new Set([',', ';', '\t', '|']);
const VALID_DECIMALS = new Set([',', '.']);

export class ConversionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConversionError';
  }
}

export function assertTarget(target) {
  if (!target || !VALID_DELIMITERS.has(target.delimiter)) throw new ConversionError(t('errTargetDelimiter'));
  if (!VALID_DECIMALS.has(target.decimal)) throw new ConversionError(t('errTargetDecimal'));
  if (target.decimal === target.delimiter) throw new ConversionError(t('errTargetSame'));
  if (target.thousands && target.thousands === target.decimal) throw new ConversionError(t('errTargetThousands'));
  if (!/YYYY/.test(target.dateFormat) || !/MM/.test(target.dateFormat) || !/DD/.test(target.dateFormat)) {
    throw new ConversionError(t('errTargetDate'));
  }
}

/**
 * @param {string} input texte CSV
 * @param {{target: {delimiter: string, decimal: string, thousands: string, dateFormat: string},
 *          ambiguousDateOrder?: 'auto'|'DMY'|'MDY', timezone?: 'local'|'wallclock'|'skip'}} options
 */
export function convertCsvText(input, { target, ambiguousDateOrder = 'auto', timezone = 'local' }) {
  assertTarget(target);

  // Directive Excel "sep=," en première ligne
  let text = input;
  let directive = null;
  const dm = /^sep=(.)(\r\n|\n|\r)/i.exec(text);
  if (dm) {
    directive = dm[1];
    text = text.slice(dm[0].length);
  }

  const sourceDelimiter = directive ?? detectDelimiter(text) ?? ',';
  const { rows, lineEnding, trailingNewline } = parseCsv(text, sourceDelimiter);
  // Un fichier tabulé reste tabulé : Excel l'ouvre correctement quelle que soit la locale.
  const outDelimiter = sourceDelimiter === '\t' ? '\t' : target.delimiter;

  const nonBlank = [];
  for (let r = 0; r < rows.length; r++) if (!isBlankRow(rows[r])) nonBlank.push(r);
  const headerRow = nonBlank.length > 1 ? nonBlank[0] : -1;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);

  function* allCells() {
    for (const row of rows) yield* row;
  }
  const numberConv = analyzeNumberConventions(allCells(), sourceDelimiter);
  const parseNumber = makeNumberParser(numberConv);
  const sourceHint = numberConv.decimal === '.' && sourceDelimiter === ',' ? 'MDY' : 'DMY';

  const columns = [];
  for (let c = 0; c < width; c++) {
    const values = [];
    for (const r of nonBlank) {
      if (r === headerRow) continue;
      const v = rows[r][c];
      if (v === undefined || isNullToken(v)) continue;
      values.push(v);
    }
    const col = {
      index: c,
      name: headerRow >= 0 ? (rows[headerRow][c] ?? '').trim() : '',
      type: 'text',
      changedCells: 0,
    };
    if (!values.length) {
      col.type = 'empty';
    } else {
      const dateInfo = analyzeDateColumn(values, { ambiguousOrder: ambiguousDateOrder, sourceHint, timezone });
      if (dateInfo) {
        col.type = 'date';
        col.date = dateInfo;
      } else if (values.every((v) => parseNumber(v) !== null)) {
        col.type = 'number';
      }
    }
    columns.push(col);
  }

  let changedCells = 0;
  const outRows = rows.map((row) =>
    row.map((cell, c) => {
      const col = columns[c];
      if (col.type !== 'number' && col.type !== 'date') return cell;
      if (isNullToken(cell)) return cell;
      let converted = null;
      if (col.type === 'number') {
        const parsed = parseNumber(cell);
        if (parsed) converted = formatNumber(parsed, target);
      } else {
        converted = formatDateCell(cell, col.date, target, timezone);
      }
      if (converted === null || converted === cell) return cell;
      col.changedCells++;
      changedCells++;
      return converted;
    }),
  );

  const body = serializeCsv(outRows, outDelimiter, { lineEnding, trailingNewline });
  const output = (directive ? `sep=${outDelimiter}${lineEnding}` : '') + body;

  const warnings = [];
  for (const col of columns) {
    if (col.type === 'date' && col.date.ambiguous && col.changedCells) {
      warnings.push(
        t('warnAmbiguousDate', { column: col.name || col.index + 1, order: t(col.date.order === 'MDY' ? 'orderMDY' : 'orderDMY') }),
      );
    }
  }
  if (numberConv.inferred && columns.some((c) => c.type === 'number' && c.changedCells)) {
    warnings.push(t('warnInferredDecimal', { decimal: numberConv.decimal }));
  }

  return {
    text: output,
    unchanged: output === input,
    report: {
      sourceDelimiter,
      outDelimiter,
      sourceDecimal: numberConv.decimal,
      sourceThousands: numberConv.thousands,
      rows: rows.length,
      headerRow,
      columns: columns.map(({ index, name, type, changedCells: n, date }) => ({
        index,
        name,
        type,
        changedCells: n,
        ...(date ? { dateOrder: date.order, ambiguous: date.ambiguous } : {}),
      })),
      changedCells,
      warnings,
    },
  };
}

/** Variante octets → texte, avec détection d'encodage. */
export function convertCsvBytes(bytes, options) {
  const decoded = decodeBytes(bytes);
  const result = convertCsvText(decoded.text, options);
  result.report.sourceEncoding = decoded.encoding;
  result.report.sourceBom = decoded.bom;
  return result;
}
