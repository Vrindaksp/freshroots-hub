// Pure UTC date helpers. Dates travel through the app as 'YYYY-MM-DD' strings so that the server
// timezone never shifts a calendar day.

const DAY_MS = 86_400_000;

export function parseDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fmtDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  return fmtDate(new Date(parseDate(d).getTime() + n * DAY_MS));
}

/** Monday of the ISO week containing `d`. */
export function mondayOf(d: string): string {
  const dow = parseDate(d).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

/** '2026-W42' -> '2026-10-12' (the Monday of that ISO week). */
export function isoWeekToMonday(label: string): string {
  const m = /^(\d{4})-?W(\d{1,2})$/i.exec(label.trim());
  if (!m) throw new Error(`Invalid ISO week label: "${label}" (expected e.g. 2026-W42)`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const week1Monday = mondayOf(`${year}-01-04`); // Jan 4th is always in ISO week 1
  return addDays(week1Monday, (week - 1) * 7);
}

/** '2026-10-12' -> '2026-W42'. */
export function toIsoWeekLabel(d: string): string {
  const monday = mondayOf(d);
  const thursday = addDays(monday, 3); // the ISO year is the year of the week's Thursday
  const isoYear = Number(thursday.slice(0, 4));
  const week1Monday = mondayOf(`${isoYear}-01-04`);
  const week = Math.round((parseDate(monday).getTime() - parseDate(week1Monday).getTime()) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function yearMonthOf(d: string): string {
  return d.slice(0, 7);
}

export function weeksBetween(fromMonday: string, toMonday: string): number {
  return Math.round((parseDate(toMonday).getTime() - parseDate(fromMonday).getTime()) / (7 * DAY_MS));
}

/** Short label like '12 Oct' for charts and tables. */
export function shortDate(d: string): string {
  const dt = parseDate(d);
  return `${dt.getUTCDate()} ${dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

export function longDate(d: string): string {
  const dt = parseDate(d);
  return `${dt.getUTCDate()} ${dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${dt.getUTCFullYear()}`;
}
