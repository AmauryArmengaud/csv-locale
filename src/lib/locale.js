/**
 * Conventions régionales. Une extension n'a pas accès aux paramètres
 * régionaux de Windows : on part de la locale du navigateur (Intl), que
 * l'utilisateur peut surcharger dans les options.
 */

export function detectLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || globalThis.navigator?.language || 'en-US';
  } catch {
    return 'en-US';
  }
}

export function localeConventions(locale = detectLocale()) {
  let decimal = '.';
  let group = ',';
  let dateFormat = 'YYYY-MM-DD';
  try {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.891);
    decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
    group = parts.find((p) => p.type === 'group')?.value ?? '';
  } catch {
    /* valeurs par défaut */
  }
  if (decimal !== '.' && decimal !== ',') decimal = '.';

  try {
    const dparts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(2033, 10, 22));
    const candidate = dparts
      .map((p) => {
        if (p.type === 'year') return 'YYYY';
        if (p.type === 'month') return 'MM';
        if (p.type === 'day') return 'DD';
        return p.type === 'literal' ? p.value.replace(/[\u200e\u200f]/g, '') : '';
      })
      .join('')
      .trim();
    if (/^(YYYY|MM|DD)[^\dA-Za-z]{1,3}(YYYY|MM|DD)[^\dA-Za-z]{1,3}(YYYY|MM|DD)$/.test(candidate)) dateFormat = candidate;
  } catch {
    /* valeur par défaut */
  }

  // Séparateur de liste d'Excel : ";" dès que la décimale est la virgule.
  const listSeparator = decimal === ',' ? ';' : ',';
  return { locale, decimal, group, dateFormat, listSeparator };
}
