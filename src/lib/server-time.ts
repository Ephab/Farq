/** Milliseconds for a backend timestamp. The API stores UTC, but SQLite drops the offset, so a
 *  value without "Z"/"+hh:mm" is read as UTC (the browser would otherwise read local time and
 *  shift it by the student's offset, e.g. three hours in Riyadh). */
export function parseServerTime(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const raw = typeof value === "number" ? value : Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`)
  return Number.isFinite(raw) ? raw : null
}
