import { addDaysIso, makeWall, wallDateKey } from "./wallclock";

/**
 * Payroll month ("شهر الرواتب"). With start day 24, payroll month October 2026 runs from
 * 2026-09-24 to 2026-10-23. Start day 1 means the plain calendar month. The month is NAMED by the
 * month in which the period ends.
 */
export const DEFAULT_PAYROLL_START_DAY = 24;

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export type PayrollPeriod = { year: number; month: number; start: string; end: string; label: string };

/** 1..28 only (every month has these days, so the period never skips or overlaps). */
export const clampStartDay = (value: unknown): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(28, Math.max(1, n)) : DEFAULT_PAYROLL_START_DAY;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const payrollPeriodOf = (year: number, month: number, startDayRaw: unknown): PayrollPeriod => {
  const startDay = clampStartDay(startDayRaw);
  const label = `${MONTHS_AR[month - 1]} ${year}`;
  if (startDay === 1) {
    return { year, month, start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(lastDayOf(year, month))}`, label };
  }
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return {
    year,
    month,
    start: `${prevYear}-${pad2(prevMonth)}-${pad2(startDay)}`,
    end: `${year}-${pad2(month)}-${pad2(startDay - 1)}`,
    label,
  };
};

/** The payroll month a given day belongs to. */
export const payrollPeriodContaining = (isoDate: string, startDayRaw: unknown): PayrollPeriod => {
  const startDay = clampStartDay(startDayRaw);
  const [y, m, d] = isoDate.split("-").map(Number);
  if (startDay === 1 || d < startDay) return payrollPeriodOf(y, m, startDay);
  return m === 12 ? payrollPeriodOf(y + 1, 1, startDay) : payrollPeriodOf(y, m + 1, startDay);
};

export const shiftPayrollPeriod = (period: PayrollPeriod, delta: number, startDay: unknown): PayrollPeriod => {
  const index = period.year * 12 + (period.month - 1) + delta;
  return payrollPeriodOf(Math.floor(index / 12), (index % 12) + 1, startDay);
};

/** Newest first: the current payroll month followed by `count - 1` previous ones. */
export const recentPayrollPeriods = (todayIso: string, startDay: unknown, count = 12): PayrollPeriod[] => {
  const current = payrollPeriodContaining(todayIso, startDay);
  return Array.from({ length: count }, (_, i) => shiftPayrollPeriod(current, -i, startDay));
};

export const todayWallIso = (now = new Date()) => wallDateKey(makeWall(now.getFullYear(), now.getMonth() + 1, now.getDate()));
export { addDaysIso };
