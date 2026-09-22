import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, serializeCsv, detectDelimiter, decodeBytes, CsvParseError } from '../src/lib/csv.js';
import { analyzeNumberConventions, makeNumberParser, formatNumber } from '../src/lib/numbers.js';
import { analyzeDateColumn, formatDateCell, tokenizeDate, resolveDate, rrYear, monthFromName } from '../src/lib/dates.js';
import { convertCsvText, convertCsvBytes, ConversionError } from '../src/lib/converter.js';
import { localeConventions } from '../src/lib/locale.js';
import { normalizeSettings, resolveTarget } from '../src/lib/settings.js';
import { normalizePrefix, urlMatchesPrefixes, prefixToMatchPattern, buildOutputName, blobOrigin, isOneTimeDownloadUrl } from '../src/lib/urls.js';
import { decodeDataUrl } from '../src/lib/capture.js';
import { t, setLanguage, MESSAGES } from '../src/lib/i18n.js';
import { describeReport } from '../src/lib/report.js';

setLanguage('fr');

const FR = { delimiter: ';', decimal: ',', thousands: '', dateFormat: 'DD/MM/YYYY' };
const conv = (text, extra = {}) => convertCsvText(text, { target: FR, timezone: 'wallclock', ...extra });

/* ------------------------------- CSV ------------------------------- */

test('parse : guillemets, guillemets doublés, sauts de ligne internes', () => {
  const { rows, lineEnding, trailingNewline } = parseCsv('a,"b,""c""",d\r\n1,"x\ny",3\r\n', ',');
  assert.deepEqual(rows, [['a', 'b,"c"', 'd'], ['1', 'x\ny', '3']]);
  assert.equal(lineEnding, '\r\n');
  assert.equal(trailingNewline, true);
});

test('parse : champs vides et séparateur final', () => {
  assert.deepEqual(parseCsv('a,,c,\n', ',').rows, [['a', '', 'c', '']]);
  assert.deepEqual(parseCsv('', ',').rows, []);
  assert.deepEqual(parseCsv('x', ',').rows, [['x']]);
});

test('parse : guillemet non fermé → erreur explicite', () => {
  assert.throws(() => parseCsv('a,"b\nc', ','), CsvParseError);
});

test('aller-retour parse/serialize stable', () => {
  const src = 'a;b\r\n"x;y";"he said ""hi"""\r\n"multi\nline";2\r\n';
  const p = parseCsv(src, ';');
  assert.equal(serializeCsv(p.rows, ';', p), src);
});

test('détection du séparateur', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n4,5,6'), ',');
  assert.equal(detectDelimiter('nom;montant\nx;1,5\ny;2,5'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('name,desc\n"Smith; John","a; b"\nDoe,c'), ',');
  assert.equal(detectDelimiter('seule\ncolonne'), null);
});

test('décodage : BOM, UTF-8, repli Windows-1252', () => {
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).text, 'a');
  assert.equal(decodeBytes(new TextEncoder().encode('é')).encoding, 'utf-8');
  const latin = decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
  assert.equal(latin.encoding, 'windows-1252');
  assert.equal(latin.text, 'café');
});

/* ------------------------------ Nombres ----------------------------- */

test('conventions : US avec milliers', () => {
  const r = analyzeNumberConventions(['1,234.56', '12.5', '3'], ',');
  assert.equal(r.decimal, '.');
  assert.equal(r.thousands, ',');
});

test('conventions : européenne', () => {
  const r = analyzeNumberConventions(['1.234,56', '12,5'], ';');
  assert.equal(r.decimal, ',');
  assert.equal(r.thousands, '.');
});

test('conventions : "1.234" seul dans un fichier virgule → décimale point', () => {
  const r = analyzeNumberConventions(['1.234', '5.678'], ',');
  assert.equal(r.decimal, '.');
  assert.equal(r.thousands, '');
});

test('parseur strict : groupes invalides rejetés', () => {
  const p = makeNumberParser({ decimal: '.', thousands: ',' });
  assert.ok(p('1,234,567.89'));
  assert.ok(p('-0.5'));
  assert.ok(p('.5'));
  assert.ok(p('1.5e-3'));
  assert.ok(p('12.5%'));
  assert.equal(p('1,23'), null);
  assert.equal(p('1234,567'), null);
  assert.equal(p('1.2.3'), null);
  assert.equal(p('abc'), null);
  assert.equal(p('12 kg'), null);
});

test('formatage sans perte de précision', () => {
  const p = makeNumberParser({ decimal: '.', thousands: ',' });
  const t = { decimal: ',', thousands: '' };
  assert.equal(formatNumber(p('12345678901234567890.123456789'), t), '12345678901234567890,123456789');
  assert.equal(formatNumber(p('1,234,567.8'), t), '1234567,8');
  assert.equal(formatNumber(p('1,234,567.8'), { decimal: ',', thousands: '\u00A0' }), '1\u00A0234\u00A0567,8');
  assert.equal(formatNumber(p('00123'), { decimal: ',', thousands: ' ' }), '00123');
  assert.equal(formatNumber(p('-1.5E+10'), t), '-1,5E+10');
});

/* ------------------------------- Dates ------------------------------ */

test('dates : ISO, validation calendaire', () => {
  assert.ok(resolveDate(tokenizeDate('2024-02-29'), null));
  assert.equal(resolveDate(tokenizeDate('2023-02-29'), null), null);
  assert.equal(tokenizeDate('1.2.33'), null);
  assert.equal(tokenizeDate('20240301'), null);
});

test('dates : ordre déduit des valeurs > 12', () => {
  assert.equal(analyzeDateColumn(['03/15/2024', '04/01/2024']).order, 'MDY');
  assert.equal(analyzeDateColumn(['15/03/2024', '01/04/2024']).order, 'DMY');
  assert.equal(analyzeDateColumn(['13/01/2024', '01/13/2024']), null);
});

test('dates : ordre ambigu → indice source puis réglage', () => {
  const a = analyzeDateColumn(['03/04/2024'], { sourceHint: 'MDY' });
  assert.deepEqual([a.order, a.ambiguous], ['MDY', true]);
  assert.equal(analyzeDateColumn(['03/04/2024'], { ambiguousOrder: 'DMY', sourceHint: 'MDY' }).order, 'DMY');
});

test('dates : formatage avec heure, AM/PM, fraction', () => {
  const t = { dateFormat: 'DD/MM/YYYY', decimal: ',' };
  assert.equal(formatDateCell('2024-03-15', { order: null }, t), '15/03/2024');
  assert.equal(formatDateCell('2024-03-15T14:05:09.123', { order: null }, t), '15/03/2024 14:05:09,123');
  assert.equal(formatDateCell('3/15/2024 2:05 PM', { order: 'MDY' }, t), '15/03/2024 14:05');
  assert.equal(formatDateCell('12/1/2024 12:00 AM', { order: 'MDY' }, t), '01/12/2024 00:00');
  assert.equal(formatDateCell('01/02/99', { order: 'DMY' }, t), '01/02/1999');
});

test('dates : fuseau horaire', () => {
  const t = { dateFormat: 'DD/MM/YYYY', decimal: ',' };
  assert.equal(formatDateCell('2024-03-15T23:30:00Z', { order: null }, t, 'wallclock'), '15/03/2024 23:30:00');
  assert.equal(formatDateCell('2024-03-15T23:30:00Z', { order: null }, t, 'skip'), null);
  const local = formatDateCell('2024-03-15T23:30:00Z', { order: null }, t, 'local');
  const d = new Date(Date.UTC(2024, 2, 15, 23, 30));
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(local, `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`);
  assert.equal(analyzeDateColumn(['2024-03-15T23:30:00Z'], { timezone: 'skip' }), null);
});

test('Oracle : mois en lettres (anglais et français)', () => {
  assert.equal(monthFromName('FEB'), 2);
  assert.equal(monthFromName('feb'), 2);
  assert.equal(monthFromName('FÉVR'), 2);
  assert.equal(monthFromName('AOÛT'), 8);
  assert.equal(monthFromName('XYZ'), null);
});

test('Oracle : règle RR', () => {
  assert.equal(rrYear(25, 2026), 2025);
  assert.equal(rrYear(75, 2026), 1975);
  assert.equal(rrYear(49, 2026), 2049);
  assert.equal(rrYear(10, 2060), 2110);
  assert.equal(rrYear(75, 2060), 2075);
});

test('Oracle : formats DD-MON-YYYY, DD-MON-RR et TIMESTAMP', () => {
  const t = { dateFormat: 'DD/MM/YYYY', decimal: ',' };
  const f = (v) => formatDateCell(v, { order: null }, t);
  assert.equal(f('28-FEB-2025'), '28/02/2025');
  assert.equal(f('28-Feb-25'), '28/02/2025');
  assert.equal(f('5-jan-2024'), '05/01/2024');
  assert.equal(f('28-FÉVR.-25'), '28/02/2025');
  assert.equal(f('15-AOÛT-2024'), '15/08/2024');
  assert.equal(f('28 FEB 2025'), '28/02/2025');
  assert.equal(f('28-FEB-25 02.30.15.000000 PM'), '28/02/2025 14:30:15');
  assert.equal(f('28-FEB-25 02.30.15.123456 PM'), '28/02/2025 14:30:15,123456');
  assert.equal(f('28-FEB-2025 23:59:59'), '28/02/2025 23:59:59');
  assert.equal(f('01-JAN-25 12.00.00.000000 AM'), '01/01/2025 00:00:00');
});

test('Oracle : dates impossibles et faux positifs rejetés', () => {
  assert.equal(tokenizeDate('31-FEB-2025') && resolveDate(tokenizeDate('31-FEB-2025'), null), null);
  assert.equal(tokenizeDate('12-ABC-2024'), null);
  assert.equal(tokenizeDate('28-FEB/2025'), null);
  assert.equal(analyzeDateColumn(['28-FEB-2025', '31-FEB-2025']), null);
});

test('Oracle : colonne convertie, colonne avec une date invalide laissée intacte', () => {
  const src = 'EMP_ID,HIRE_DATE,END_DATE,SALARY\n1001,15-JAN-2019,31-FEB-2025,4500.5\n1002,03-MAR-21,28-FEB-2025,3200\n';
  const { text, report } = conv(src);
  assert.equal(text, 'EMP_ID;HIRE_DATE;END_DATE;SALARY\n1001;15/01/2019;31-FEB-2025;4500,5\n1002;03/03/2021;28-FEB-2025;3200\n');
  assert.equal(report.columns[1].type, 'date');
  assert.equal(report.columns[2].type, 'text');
});

/* ---------------------------- Conversion ---------------------------- */

test('cas nominal : export US vers Excel FR', () => {
  const src = 'id,label,amount,date\r\n001,"Widget, large","1,234.50",03/15/2024\r\n002,Gadget,12.5,04/01/2024\r\n';
  const { text, report } = conv(src);
  assert.equal(text, 'id;label;amount;date\r\n001;Widget, large;1234,50;15/03/2024\r\n002;Gadget;12,5;01/04/2024\r\n');
  assert.equal(report.sourceDelimiter, ',');
  assert.equal(report.columns[0].type, 'number');
  assert.equal(report.columns[0].changedCells, 0, 'les identifiants ne bougent pas');
  assert.equal(report.columns[2].changedCells, 2);
});

test('colonne mixte laissée intacte', () => {
  const { text } = conv('ref,val\nA,12.5\nB,abc\n');
  assert.equal(text, 'ref;val\nA;12.5\nB;abc\n');
});

test('valeurs nulles ignorées pour le typage et conservées', () => {
  const { text } = conv('v\n1.5\nN/A\n\n2.5\n');
  assert.equal(text, 'v\n1,5\nN/A\n\n2,5\n');
});

test('texte contenant le nouveau séparateur → mis entre guillemets', () => {
  const { text } = conv('a,b\n"x;y",1.5\n');
  assert.equal(text, 'a;b\n"x;y";1,5\n');
});

test('versions et codes ne sont pas pris pour des nombres ou des dates', () => {
  const { text } = conv('ver,code\n1.2.3,10-A\n1.10.0,20-B\n');
  assert.equal(text, 'ver;code\n1.2.3;10-A\n1.10.0;20-B\n');
});

test('fichier déjà au format FR → inchangé (idempotence)', () => {
  const src = 'a;b\r\nx;1234,5\r\ny;15/03/2024\r\n';
  const r = conv(src);
  assert.equal(r.unchanged, true);
  const once = conv('a,b\n1.5,2024-01-31\n').text;
  assert.equal(conv(once).unchanged, true);
});

test('directive sep= réécrite', () => {
  const { text } = conv('sep=,\na,b\n1.5,2\n');
  assert.equal(text, 'sep=;\na;b\n1,5;2\n');
});

test('TSV : tabulation conservée, décimales converties', () => {
  const { text } = conv('a\tb\n1.5\tx\n');
  assert.equal(text, 'a\tb\n1,5\tx\n');
});

test('sans en-tête : première ligne convertie si elle correspond au type', () => {
  const { text } = conv('1.5,2024-01-31\n2.5,2024-02-01\n');
  assert.equal(text, '1,5;31/01/2024\n2,5;01/02/2024\n');
});

test('lignes de longueurs inégales tolérées', () => {
  const { text } = conv('a,b,c\n1.5\n2.5,x,y,z\n');
  assert.equal(text, 'a;b;c\n1,5\n2,5;x;y;z\n');
});

test('octets Windows-1252 + BOM restitués proprement', () => {
  const bytes = new Uint8Array([...new TextEncoder().encode('nom,prix\n'), 0x63, 0x61, 0x66, 0xe9, ...new TextEncoder().encode(',2.5\n')]);
  const { text, report } = convertCsvBytes(bytes, { target: FR });
  assert.equal(text, 'nom;prix\ncafé;2,5\n');
  assert.equal(report.sourceEncoding, 'windows-1252');
});

test('cible invalide refusée', () => {
  assert.throws(() => convertCsvText('a', { target: { ...FR, delimiter: ',', decimal: ',' } }), ConversionError);
});

test('gros fichier : 200 000 lignes en temps raisonnable', () => {
  const lines = ['id,amount,date'];
  for (let i = 0; i < 200_000; i++) lines.push(`${i},"${(i * 1000.25).toLocaleString('en-US')}",2024-01-${String((i % 28) + 1).padStart(2, '0')}`);
  const t0 = performance.now();
  const { report } = conv(lines.join('\n'));
  const ms = performance.now() - t0;
  assert.equal(report.columns[1].type, 'number');
  assert.equal(report.columns[2].type, 'date');
  assert.ok(ms < 15000, `trop lent : ${ms} ms`);
});

/* --------------------------- Locale / réglages --------------------------- */

test('conventions fr-FR', () => {
  const c = localeConventions('fr-FR');
  assert.equal(c.decimal, ',');
  assert.equal(c.listSeparator, ';');
  assert.equal(c.dateFormat, 'DD/MM/YYYY');
  assert.equal(localeConventions('en-US').dateFormat, 'MM/DD/YYYY');
});

test('réglages : normalisation défensive', () => {
  const s = normalizeSettings({ urlPrefixes: ['https://App.Example.com/x', 'ftp://nope', 'https://app.example.com/x', 42], thousands: 'X', maxSizeMB: 9999 });
  assert.deepEqual(s.urlPrefixes, ['https://app.example.com/x']);
  assert.equal(s.thousands, '');
  assert.equal(s.maxSizeMB, 500);
  const t = resolveTarget(s, localeConventions('fr-FR'));
  assert.deepEqual(t, { delimiter: ';', decimal: ',', dateFormat: 'DD/MM/YYYY', thousands: '' });
});

/* ------------------------------- URLs ------------------------------- */

test('URLs : préfixes, motifs, noms de fichiers', () => {
  assert.equal(normalizePrefix(' https://site.com '), 'https://site.com/');
  assert.throws(() => normalizePrefix('javascript:alert(1)'));
  assert.ok(urlMatchesPrefixes('https://site.com/reports/export?id=1', ['https://site.com/reports']));
  assert.equal(prefixToMatchPattern('https://site.com:8443/app'), 'https://site.com/app*');
  assert.equal(blobOrigin('blob:https://site.com/1234-abcd'), 'https://site.com');
  assert.equal(buildOutputName('C:\\Users\\a\\Downloads\\export.csv', '_fr'), 'export_fr.csv');
  assert.equal(buildOutputName('/home/a/rapport', '_fr'), 'rapport_fr.csv');
});

test('URLs à usage unique (Oracle APEX)', () => {
  const apex = 'https://x.fr/apex/wwv_flow.ajax?p_flow_id=103&p_json=%7B%22regions%22%3A%5B%7B%22downloadFileId%22%3A%2213%22%7D%5D%7D';
  assert.equal(isOneTimeDownloadUrl(apex), true);
  assert.equal(isOneTimeDownloadUrl('https://x.fr/apex/wwv_flow.ajax'), false);
  assert.equal(isOneTimeDownloadUrl('https://x.fr/export.csv?downloadFileId=1'), false);
});

test('data: URL en base64 et en pourcent-encodage', () => {
  assert.equal(new TextDecoder().decode(decodeDataUrl('data:text/csv;base64,YSxiCjEsMg==')), 'a,b\n1,2');
  assert.deepEqual([...decodeDataUrl('data:text/csv,caf%E9')], [0x63, 0x61, 0x66, 0xe9]);
  assert.equal(new TextDecoder().decode(decodeDataUrl('data:text/csv;charset=utf-8,a%2Cb%0A%C3%A9')), 'a,b\né');
});

/* ------------------------------- Langues ------------------------------- */

test('i18n : mêmes clés en français et en anglais', () => {
  const fr = Object.keys(MESSAGES.fr).sort();
  const en = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(fr, en);
});

test('i18n : paramètres, pluriels et rapport dans les deux langues', () => {
  const { report } = conv('id,amount,date\n1,1.5,2024-01-31\n2,2.5,2024-02-01\n');
  setLanguage('en');
  assert.equal(t('notifFailBody', { name: 'a.csv', reason: 'HTTP 404' }), 'a.csv: HTTP 404. The original file is untouched.');
  assert.equal(describeReport(report), 'Delimiter comma → semicolon, 1 numeric column, 1 date column, 4 cells changed');
  assert.match(conv('d\n03/04/2024\n').report.warnings[0], /ambiguous day\/month order, read as month\/day/);
  setLanguage('fr');
  assert.equal(describeReport(report), 'Séparateur virgule → point-virgule, 1 colonne numérique, 1 colonne de dates, 4 cellules modifiées');
  assert.match(conv('d\n03/04/2024\n').report.warnings[0], /ordre jour\/mois ambigu, interprété comme mois\/jour/);
});

test('i18n : détection de la langue (fr* → français, sinon anglais)', async () => {
  const { detectUiLanguage } = await import('../src/lib/i18n.js');
  const saved = globalThis.chrome;
  for (const [ui, expected] of [['fr', 'fr'], ['fr-CA', 'fr'], ['en-US', 'en'], ['de-DE', 'en'], ['es', 'en']]) {
    globalThis.chrome = { i18n: { getUILanguage: () => ui } };
    assert.equal(detectUiLanguage(), expected, ui);
  }
  globalThis.chrome = saved;
});
