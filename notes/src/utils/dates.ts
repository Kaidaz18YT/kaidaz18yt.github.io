export const nowIso = () => new Date().toISOString();

/** PocketBase timestamps look like "2026-09-20 12:00:00.123Z". */
export const toMs = (s: string): number => {
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isNaN(t) ? 0 : t;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" is your today). */
export const localDate = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
};
