import { config } from './config.js';

// All dates are ISO strings (YYYY-MM-DD), which compare correctly as strings.

export function todayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
}

/** Accepts DD.MM.YYYY (also with / or -) and YYYY-MM-DD. Returns ISO or null. */
export function parseDate(text) {
  const t = text.trim();
  let y, m, d, match;
  if ((match = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))) {
    [d, m, y] = match.slice(1).map(Number);
  } else if ((match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [y, m, d] = match.slice(1).map(Number);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/** "2 y 3 mo", "5 mo", "<1 mo" */
export function durationLabel(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const months = Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (!years && !rest) return '<1 mo';
  return [years && `${years} y`, rest && `${rest} mo`].filter(Boolean).join(' ');
}

/** 1 September that started the current school year. */
export function schoolYearStart(iso = todayIso()) {
  const [y, m] = iso.split('-').map(Number);
  return `${m >= 9 ? y : y - 1}-09-01`;
}
