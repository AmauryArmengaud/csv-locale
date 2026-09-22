/** Libellés lisibles pour les rapports de conversion. */

import { t, uiLocale } from './i18n.js';

const DELIM_KEY = { ',': 'delimComma', ';': 'delimSemicolon', '\t': 'delimTab', '|': 'delimPipe' };

export const delimiterLabel = (d) => (DELIM_KEY[d] ? t(DELIM_KEY[d]) : JSON.stringify(d));

const count = (key, n) => t(key, { n, s: n.toLocaleString(uiLocale()) });

export function describeReport(report) {
  const parts = [];
  parts.push(
    report.sourceDelimiter === report.outDelimiter
      ? t('reportDelimKept', { d: delimiterLabel(report.sourceDelimiter) })
      : t('reportDelimChanged', { from: delimiterLabel(report.sourceDelimiter), to: delimiterLabel(report.outDelimiter) }),
  );
  const num = report.columns.filter((c) => c.type === 'number' && c.changedCells).length;
  const dat = report.columns.filter((c) => c.type === 'date' && c.changedCells).length;
  if (num) parts.push(count('reportNumCols', num));
  if (dat) parts.push(count('reportDateCols', dat));
  parts.push(count('reportCells', report.changedCells));
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
