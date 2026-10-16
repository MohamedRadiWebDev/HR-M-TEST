import { buildValidWall, wallDateKey } from "./wallclock";

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

export const toAsciiDigits = (value: string): string =>
  value.replace(ARABIC_DIGITS, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad2 = (n: number | string) => String(n).padStart(2, "0");

const iso = (y: number, m: number, d: number): string => {
  const valid = buildValidWall(y, m, d);
  return valid ? `${y}-${pad2(m)}-${pad2(d)}` : "";
};

/** Excel serial day number (1900 date system) → YYYY-MM-DD. */
export const excelSerialToIso = (serial: number): string => {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return "";
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return wallDateKey(new Date(ms));
};

/**
 * Normalises any date-like value to `YYYY-MM-DD` (or "" when it cannot be understood).
 *
 * Supported: ISO (2026-03-05), day-first text (05/03/2026, 5-3-2026, 5.3.2026), Arabic-Indic digits,
 * Excel serial numbers, JS `Date.toString()` text, and `Date` objects.
 *
 * Text is ALWAYS read day-first (Egyptian convention) – never as US month-first – except when the
 * second number is greater than 12 (which can only be month-first).
 *
 * `Date` objects are read with their LOCAL fields (they come from code / date pickers). Dates coming
 * from Excel are converted by `lib/excel.ts` to floating dates and must go through `wallDateKey`.
 */
export const normalizeDateToIso = (value: unknown): string => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") return excelSerialToIso(value);

  const text = toAsciiDigits(String(value ?? "")).trim();
  if (!text) return "";

  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s].*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (b > 12 && a <= 12) return iso(y, a, b); // can only be month-first
    return iso(y, b, a);
  }

  if (/^\d{5}$/.test(text)) return excelSerialToIso(Number(text));

  // "Sun Mar 01 2026 00:00:00 GMT+0200 (...)" – read the printed date, do not re-interpret time zones.
  m = text.match(/^[A-Za-z]{3},?\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));

  m = text.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));

  return "";
};

export const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && normalizeDateToIso(value) === value;
