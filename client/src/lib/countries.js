import { getCountries, getCountryCallingCode } from 'libphonenumber-js/mobile';

const regionNames = (() => {
  try {
    return new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' });
  } catch {
    return null;
  }
})();

const flagEmoji = (iso) => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const fold = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const COUNTRIES = getCountries()
  .map((iso) => {
    const name = regionNames?.of(iso) ?? iso;
    return { iso, name, dial: getCountryCallingCode(iso), flag: flagEmoji(iso), search: fold(name) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export const COUNTRY_BY_ISO = new Map(COUNTRIES.map((country) => [country.iso, country]));

/** Default from the browser's locale (e.g. en-IN → IN), falling back to US. */
export function detectCountry() {
  for (const locale of navigator.languages ?? [navigator.language]) {
    try {
      const region = new Intl.Locale(locale).maximize().region;
      if (region && COUNTRY_BY_ISO.has(region)) return region;
    } catch {
      // ignore malformed locale tags
    }
  }
  return 'US';
}

/** Matches by name, ISO code or dialling code ("+44", "44"). Prefix matches rank first. */
export function searchCountries(query) {
  const q = fold(query.trim());
  if (!q) return COUNTRIES;
  const digits = q.replace(/^\+/, '');
  if (/^\d+$/.test(digits)) return COUNTRIES.filter((c) => c.dial.startsWith(digits));
  const starts = [];
  const contains = [];
  for (const country of COUNTRIES) {
    if (country.search.startsWith(q) || country.iso.toLowerCase() === q) starts.push(country);
    else if (country.search.includes(q)) contains.push(country);
  }
  return [...starts, ...contains];
}

let flagSupport;

/** Windows has no flag emoji glyphs; detect and fall back to ISO badges there. */
export function supportsFlagEmoji() {
  if (flagSupport !== undefined) return flagSupport;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 20;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.textBaseline = 'top';
    context.font = '16px sans-serif';
    context.fillText(flagEmoji('US'), 0, 0);
    const pixels = context.getImageData(0, 0, 20, 20).data;
    flagSupport = false;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2])) {
        flagSupport = true;
        break;
      }
    }
  } catch {
    flagSupport = false;
  }
  return flagSupport;
}
