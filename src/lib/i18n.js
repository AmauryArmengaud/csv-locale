/**
 * Traductions de l'interface. Langue : français si le navigateur est en
 * français (fr, fr-FR, fr-CA…), anglais sinon.
 *
 * Les valeurs sont des chaînes avec des paramètres {nom}, ou des fonctions
 * pour les pluriels.
 */

const fr = {
  appName: 'CSV Locale FR',
  actionTitle: 'CSV Locale FR : réglages',

  // Service worker
  badgeActive: 'CSV Locale FR : actif sur cette page',
  badgeInactive: 'CSV Locale FR : inactif sur cette page. Vérifiez l’accès au site dans les réglages, puis rechargez l’onglet',
  diagNoTab: 'téléchargement à usage unique : aucun onglet du site trouvé',
  diagNotInjected:
    'téléchargement à usage unique non intercepté : l’extension n’est pas active dans l’onglet. Rechargez-le (F5) puis relancez l’export',
  diagUnknownMechanism:
    'téléchargement à usage unique non intercepté malgré l’extension active : mécanisme de téléchargement non reconnu (voir le diagnostic)',
  errTooLargeMB: 'fichier supérieur à {mb} Mo',
  readFailed: 'Lecture impossible : {reason}',
  notifFailTitle: 'Conversion CSV impossible',
  notifFailBody: '{name} : {reason}. L’original est intact.',
  alreadyOk: 'Déjà au bon format',
  notifUnchangedTitle: 'CSV déjà au bon format',
  notifUnchangedBody: '{name} : aucune copie créée.',
  notifOkTitle: 'CSV converti : {name}',

  // Lecture du fichier
  errTooLarge: 'fichier trop volumineux',
  errHtml: 'réponse HTML (session expirée ?)',
  errBlobUnreadable: 'blob illisible ({detail})',
  errTabFetch: 'lecture depuis l’onglet impossible ({detail})',
  errNoTab: 'aucun onglet source accessible',
  errRefetch: 'relecture impossible : {detail}',
  errDataUrl: 'URL data: invalide',
  errCreateFile: 'création du fichier impossible',

  // Moteur
  errUnclosedQuote: 'Guillemet ouvrant sans guillemet fermant (ligne {line})',
  errTargetDelimiter: 'Séparateur cible invalide',
  errTargetDecimal: 'Décimale cible invalide',
  errTargetSame: 'La décimale et le séparateur de colonnes sont identiques',
  errTargetThousands: 'Milliers et décimale identiques',
  errTargetDate: 'Format de date cible invalide',
  warnAmbiguousDate: 'Colonne « {column} » : ordre jour/mois ambigu, interprété comme {order}',
  orderMDY: 'mois/jour',
  orderDMY: 'jour/mois',
  warnInferredDecimal: 'Décimale source déduite par défaut (« {decimal} »)',

  // URL
  errPrefixEmpty: 'Préfixe vide',
  errPrefixInvalid: 'URL invalide : {url}',
  errPrefixProtocol: 'Seuls http:// et https:// sont acceptés',
  errPrefixCredentials: 'Identifiants interdits dans l’URL',

  // Rapport
  delimComma: 'virgule',
  delimSemicolon: 'point-virgule',
  delimTab: 'tabulation',
  delimPipe: 'barre verticale',
  reportDelimKept: 'séparateur {d} conservé',
  reportDelimChanged: 'séparateur {from} → {to}',
  reportNumCols: ({ n, s }) => `${s} colonne${n > 1 ? 's' : ''} numérique${n > 1 ? 's' : ''}`,
  reportDateCols: ({ n, s }) => `${s} colonne${n > 1 ? 's' : ''} de dates`,
  reportCells: ({ n, s }) => `${s} cellule${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}`,

  // Page de réglages
  'o.title': 'CSV Locale FR : réglages',
  'o.lede':
    'Chaque CSV téléchargé depuis vos sites est converti localement aux conventions de ce poste. L’original reste dans vos téléchargements, la copie convertie arrive à côté.',
  'o.previewTitle': 'Aperçu de la conversion',
  'o.previewBefore': 'Export du site',
  'o.previewAfter': 'Copie convertie',
  'o.previewError': 'Réglages incohérents : {message}',
  'o.sitesTitle': 'Sites surveillés',
  'o.sitesHint': 'Début d’URL des pages d’où partent les exports. Chrome vous demandera l’accès au site lors de l’ajout.',
  'o.prefixLabel': 'Début d’URL',
  'o.prefixPlaceholder': 'https://app.exemple.com/rapports',
  'o.addSite': 'Ajouter le site',
  'o.sitesEmpty': 'Aucun site pour l’instant. Ajoutez l’URL de la page qui génère vos exports.',
  'o.alreadyListed': 'Ce site est déjà dans la liste.',
  'o.accessDenied': 'Accès refusé : les exports de ce site ne seront pas convertis tant que l’accès n’est pas autorisé.',
  'o.statusMissing': 'Accès manquant',
  'o.statusActive': 'Accès autorisé, actif',
  'o.statusPending': 'Accès autorisé, activation en cours',
  'o.allow': 'Autoriser',
  'o.remove': 'Retirer',
  'o.removeAria': 'Retirer {prefix}',
  'o.hookError': 'Le script de page n’a pas pu être enregistré : {error}',
  'o.formatTitle': 'Format de sortie',
  'o.mode': 'Mode',
  'o.modeAuto': 'Suivre la langue du navigateur',
  'o.modeManual': 'Choisir manuellement',
  'o.delimiter': 'Séparateur de colonnes',
  'o.delimSemicolon': 'Point-virgule ( ; )',
  'o.delimComma': 'Virgule ( , )',
  'o.delimTab': 'Tabulation',
  'o.delimPipe': 'Barre verticale ( | )',
  'o.decimal': 'Décimale',
  'o.decComma': 'Virgule ( 12,5 )',
  'o.decPoint': 'Point ( 12.5 )',
  'o.dateFormat': 'Format de date',
  'o.thousands': 'Séparateur de milliers',
  'o.thNone': 'Aucun ( 1234567,8 ) recommandé',
  'o.thNbsp': 'Espace insécable ( 1 234 567,8 )',
  'o.thNnbsp': 'Espace fine insécable',
  'o.thSpace': 'Espace simple',
  'o.thPoint': 'Point ( 1.234.567,8 )',
  'o.thComma': 'Virgule',
  'o.thApos': 'Apostrophe',
  'o.thousandsHint': 'Sans séparateur de milliers, Excel reconnaît toujours la valeur comme un nombre.',
  'o.advTitle': 'Cas particuliers',
  'o.ambiguous': 'Dates ambiguës (ex. 03/04/2024)',
  'o.ambAuto': 'Déduire du format de l’export',
  'o.ambMDY': 'Toujours mois/jour (format US)',
  'o.ambDMY': 'Toujours jour/mois',
  'o.timezone': 'Dates avec fuseau (…Z, +02:00)',
  'o.tzLocal': 'Convertir à l’heure locale',
  'o.tzWall': 'Garder l’heure écrite',
  'o.tzSkip': 'Ne pas convertir',
  'o.suffix': 'Suffixe du fichier converti',
  'o.maxSize': 'Taille maximale (Mo)',
  'o.bom': 'Ajouter un BOM UTF-8 (accents corrects dans Excel)',
  'o.skipIfUnchanged': 'Ne pas créer de copie si le fichier est déjà au bon format',
  'o.notify': 'Afficher une notification après chaque conversion',
  'o.saved': 'Réglages enregistrés',
  'o.testTitle': 'Tester sur un fichier',
  'o.testHint': 'Vérifiez le résultat avec vos réglages actuels, sans passer par le site.',
  'o.testPick': 'Choisir un CSV',
  'o.colColumn': 'Colonne',
  'o.colType': 'Type détecté',
  'o.colChanged': 'Cellules modifiées',
  'o.testDownload': 'Télécharger la version convertie',
  'o.testUnchanged': 'Le fichier est déjà au bon format.',
  'o.testError': 'Conversion impossible : {message}',
  'o.columnN': 'Colonne {n}',
  'o.typeNumber': 'Nombre',
  'o.typeDate': 'Date',
  'o.typeText': 'Texte',
  'o.typeEmpty': 'Vide',
  'o.orderMDY': ' (mois/jour)',
  'o.orderDMY': ' (jour/mois)',
  'o.historyTitle': 'Dernières conversions',
  'o.historyClear': 'Effacer',
  'o.historyEmpty': 'Rien pour l’instant. Téléchargez un CSV depuis un site surveillé.',
  'o.fileFallback': 'Fichier',
  'o.diagnostic': 'Diagnostic',
  'o.copyDiagnostic': 'Copier le diagnostic',
  'o.copied': 'Copié',
};

const en = {
  appName: 'CSV Locale',
  actionTitle: 'CSV Locale: settings',

  badgeActive: 'CSV Locale: active on this page',
  badgeInactive: 'CSV Locale: inactive on this page. Check site access in the settings, then reload the tab',
  diagNoTab: 'one-time download: no tab of the site was found',
  diagNotInjected: 'one-time download not intercepted: the extension is not active in the tab. Reload it (F5) and export again',
  diagUnknownMechanism:
    'one-time download not intercepted although the extension is active: unrecognised download mechanism (see the diagnostic)',
  errTooLargeMB: 'file larger than {mb} MB',
  readFailed: 'Could not read the file: {reason}',
  notifFailTitle: 'CSV conversion failed',
  notifFailBody: '{name}: {reason}. The original file is untouched.',
  alreadyOk: 'Already in the right format',
  notifUnchangedTitle: 'CSV already in the right format',
  notifUnchangedBody: '{name}: no copy created.',
  notifOkTitle: 'CSV converted: {name}',

  errTooLarge: 'file too large',
  errHtml: 'HTML response (session expired?)',
  errBlobUnreadable: 'unreadable blob ({detail})',
  errTabFetch: 'could not read from the tab ({detail})',
  errNoTab: 'no accessible source tab',
  errRefetch: 'could not fetch the file again: {detail}',
  errDataUrl: 'invalid data: URL',
  errCreateFile: 'could not create the file',

  errUnclosedQuote: 'Opening quote without a closing quote (line {line})',
  errTargetDelimiter: 'Invalid target delimiter',
  errTargetDecimal: 'Invalid target decimal separator',
  errTargetSame: 'The decimal separator and the column delimiter are identical',
  errTargetThousands: 'Thousands and decimal separators are identical',
  errTargetDate: 'Invalid target date format',
  warnAmbiguousDate: 'Column “{column}”: ambiguous day/month order, read as {order}',
  orderMDY: 'month/day',
  orderDMY: 'day/month',
  warnInferredDecimal: 'Source decimal separator assumed by default (“{decimal}”)',

  errPrefixEmpty: 'Empty prefix',
  errPrefixInvalid: 'Invalid URL: {url}',
  errPrefixProtocol: 'Only http:// and https:// are accepted',
  errPrefixCredentials: 'Credentials are not allowed in the URL',

  delimComma: 'comma',
  delimSemicolon: 'semicolon',
  delimTab: 'tab',
  delimPipe: 'pipe',
  reportDelimKept: '{d} delimiter kept',
  reportDelimChanged: 'delimiter {from} → {to}',
  reportNumCols: ({ n, s }) => `${s} numeric column${n > 1 ? 's' : ''}`,
  reportDateCols: ({ n, s }) => `${s} date column${n > 1 ? 's' : ''}`,
  reportCells: ({ n, s }) => `${s} cell${n > 1 ? 's' : ''} changed`,

  'o.title': 'CSV Locale: settings',
  'o.lede':
    'Every CSV downloaded from your sites is converted locally to this computer’s conventions. The original stays in your downloads, the converted copy lands next to it.',
  'o.previewTitle': 'Conversion preview',
  'o.previewBefore': 'Site export',
  'o.previewAfter': 'Converted copy',
  'o.previewError': 'Inconsistent settings: {message}',
  'o.sitesTitle': 'Watched sites',
  'o.sitesHint': 'Start of the URL of the pages your exports come from. Chrome will ask for access to the site when you add it.',
  'o.prefixLabel': 'Start of URL',
  'o.prefixPlaceholder': 'https://app.example.com/reports',
  'o.addSite': 'Add site',
  'o.sitesEmpty': 'No sites yet. Add the URL of the page that generates your exports.',
  'o.alreadyListed': 'This site is already in the list.',
  'o.accessDenied': 'Access denied: exports from this site will not be converted until access is granted.',
  'o.statusMissing': 'Access missing',
  'o.statusActive': 'Access granted, active',
  'o.statusPending': 'Access granted, activating',
  'o.allow': 'Allow',
  'o.remove': 'Remove',
  'o.removeAria': 'Remove {prefix}',
  'o.hookError': 'The page script could not be registered: {error}',
  'o.formatTitle': 'Output format',
  'o.mode': 'Mode',
  'o.modeAuto': 'Follow the browser language',
  'o.modeManual': 'Choose manually',
  'o.delimiter': 'Column delimiter',
  'o.delimSemicolon': 'Semicolon ( ; )',
  'o.delimComma': 'Comma ( , )',
  'o.delimTab': 'Tab',
  'o.delimPipe': 'Pipe ( | )',
  'o.decimal': 'Decimal separator',
  'o.decComma': 'Comma ( 12,5 )',
  'o.decPoint': 'Point ( 12.5 )',
  'o.dateFormat': 'Date format',
  'o.thousands': 'Thousands separator',
  'o.thNone': 'None ( 1234567.8 ) recommended',
  'o.thNbsp': 'Non-breaking space ( 1 234 567.8 )',
  'o.thNnbsp': 'Narrow non-breaking space',
  'o.thSpace': 'Regular space',
  'o.thPoint': 'Point ( 1.234.567,8 )',
  'o.thComma': 'Comma ( 1,234,567.8 )',
  'o.thApos': 'Apostrophe',
  'o.thousandsHint': 'Without a thousands separator, Excel always reads the value as a number.',
  'o.advTitle': 'Special cases',
  'o.ambiguous': 'Ambiguous dates (e.g. 03/04/2024)',
  'o.ambAuto': 'Infer from the export format',
  'o.ambMDY': 'Always month/day (US format)',
  'o.ambDMY': 'Always day/month',
  'o.timezone': 'Dates with a time zone (…Z, +02:00)',
  'o.tzLocal': 'Convert to local time',
  'o.tzWall': 'Keep the written time',
  'o.tzSkip': 'Do not convert',
  'o.suffix': 'Converted file suffix',
  'o.maxSize': 'Maximum size (MB)',
  'o.bom': 'Add a UTF-8 BOM (correct accents in Excel)',
  'o.skipIfUnchanged': 'Do not create a copy if the file is already in the right format',
  'o.notify': 'Show a notification after each conversion',
  'o.saved': 'Settings saved',
  'o.testTitle': 'Test on a file',
  'o.testHint': 'Check the result with your current settings, without going through the site.',
  'o.testPick': 'Choose a CSV',
  'o.colColumn': 'Column',
  'o.colType': 'Detected type',
  'o.colChanged': 'Cells changed',
  'o.testDownload': 'Download the converted version',
  'o.testUnchanged': 'The file is already in the right format.',
  'o.testError': 'Conversion failed: {message}',
  'o.columnN': 'Column {n}',
  'o.typeNumber': 'Number',
  'o.typeDate': 'Date',
  'o.typeText': 'Text',
  'o.typeEmpty': 'Empty',
  'o.orderMDY': ' (month/day)',
  'o.orderDMY': ' (day/month)',
  'o.historyTitle': 'Recent conversions',
  'o.historyClear': 'Clear',
  'o.historyEmpty': 'Nothing yet. Download a CSV from a watched site.',
  'o.fileFallback': 'File',
  'o.diagnostic': 'Diagnostic',
  'o.copyDiagnostic': 'Copy diagnostic',
  'o.copied': 'Copied',
};

export const MESSAGES = Object.freeze({ fr, en });

export function detectUiLanguage() {
  let lang = '';
  try {
    lang = globalThis.chrome?.i18n?.getUILanguage?.() || '';
  } catch {
    /* hors extension */
  }
  lang = lang || globalThis.navigator?.language || 'en';
  return lang.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let current = null;
export const getLanguage = () => (current ??= detectUiLanguage());
export const setLanguage = (lang) => {
  current = lang === 'fr' ? 'fr' : 'en';
};

/** Locale BCP 47 pour Intl (dates et nombres de l'interface). */
export function uiLocale() {
  if (getLanguage() === 'fr') return 'fr-FR';
  const nav = globalThis.navigator?.language || '';
  return nav.toLowerCase().startsWith('en') ? nav : 'en-GB';
}

export function t(key, params = {}) {
  const value = MESSAGES[getLanguage()][key] ?? MESSAGES.en[key];
  if (value === undefined) return key;
  if (typeof value === 'function') return value(params);
  return value.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`).toString());
}
