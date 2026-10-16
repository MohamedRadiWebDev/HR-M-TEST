import { describe, expect, it } from "vitest";
import { clampStartDay, payrollPeriodContaining, payrollPeriodOf, recentPayrollPeriods, shiftPayrollPeriod } from "../payroll-period";

describe("payroll period (24 → 23)", () => {
  it("October 2026 payroll month = 24 Sep → 23 Oct (matches the reference system)", () => {
    expect(payrollPeriodOf(2026, 10, 24)).toMatchObject({ start: "2026-09-24", end: "2026-10-23", label: "أكتوبر 2026" });
  });
  it("assigns days to the right payroll month, including the boundaries", () => {
    expect(payrollPeriodContaining("2026-10-23", 24).month).toBe(10);
    expect(payrollPeriodContaining("2026-10-24", 24)).toMatchObject({ month: 11, start: "2026-10-24", end: "2026-11-23" });
    expect(payrollPeriodContaining("2026-09-24", 24).month).toBe(10);
    expect(payrollPeriodContaining("2026-01-10", 24)).toMatchObject({ month: 1, start: "2025-12-24", end: "2026-01-23" });
  });
  it("rolls over the year", () => {
    expect(payrollPeriodContaining("2026-12-30", 24)).toMatchObject({ year: 2027, month: 1, start: "2026-12-24", end: "2027-01-23" });
    expect(shiftPayrollPeriod(payrollPeriodOf(2026, 1, 24), -1, 24)).toMatchObject({ year: 2025, month: 12 });
    expect(shiftPayrollPeriod(payrollPeriodOf(2026, 12, 24), 1, 24)).toMatchObject({ year: 2027, month: 1 });
  });
  it("start day 1 is the calendar month (leap-year aware)", () => {
    expect(payrollPeriodOf(2028, 2, 1)).toMatchObject({ start: "2028-02-01", end: "2028-02-29" });
    expect(payrollPeriodContaining("2026-03-15", 1)).toMatchObject({ month: 3, start: "2026-03-01", end: "2026-03-31" });
  });
  it("periods are contiguous with no gaps or overlaps", () => {
    const periods = recentPayrollPeriods("2026-10-15", 24, 14).reverse();
    for (let i = 1; i < periods.length; i++) {
      const prevEnd = new Date(`${periods[i - 1].end}T00:00:00Z`).getTime();
      expect(new Date(`${periods[i].start}T00:00:00Z`).getTime() - prevEnd).toBe(86400000);
    }
  });
  it("clamps the start day to 1..28", () => {
    expect(clampStartDay(40)).toBe(28);
    expect(clampStartDay(0)).toBe(1);
    expect(clampStartDay("abc")).toBe(24);
  });
});
