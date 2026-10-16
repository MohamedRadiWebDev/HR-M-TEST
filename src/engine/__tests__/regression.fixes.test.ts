import { describe, expect, it } from "vitest";
import { processAttendanceRecords } from "@/engine/attendanceEngine";
import { summarizePenalties } from "@/engine/penalties";
import { buildAttendanceExportRows, STATUS_AR } from "@/exporters/attendanceExport";
import { parseWallIso } from "@shared/wallclock";
import type { AttendanceRecord, BiometricPunch, Employee } from "@shared/schema";

const emp = (code: string, extra: Partial<Employee> = {}): Employee => ({
  id: Number(code) || 1, code, nameAr: `emp-${code}`, sector: "التحصيل", department: "d", section: "s",
  jobTitle: null, branch: null, governorate: null, hireDate: null, terminationDate: null,
  terminationReason: null, serviceDuration: null, directManager: null, deptManager: null,
  nationalId: null, birthDate: null, address: null, birthPlace: null, personalPhone: null,
  emergencyPhone: null, shiftStart: "09:00", ...extra,
});
const punch = (code: string, wall: string, id = 1): BiometricPunch => ({ id, employeeCode: code, punchDatetime: parseWallIso(wall)! });
const run = (employees: Employee[], punches: BiometricPunch[], start: string, end: string, extra: Record<string, unknown> = {}) =>
  processAttendanceRecords({ employees, punches, startDate: start, endDate: end, ...extra });
const penaltyTypes = (r: AttendanceRecord) => (r.penalties ?? []).map((p) => p.type);

describe("lone punch classification", () => {
  it("treats a lone afternoon punch as a forgotten CHECK-IN, not a 8-hour-late arrival", () => {
    const [r] = run([emp("1")], [punch("1", "2026-03-02T17:05:00")], "2026-03-02", "2026-03-02");
    expect(r.checkIn).toBeNull();
    expect(r.checkOut).not.toBeNull();
    expect(r.status).not.toBe("Late");
    expect(penaltyTypes(r)).toEqual(["سهو بصمة"]);
    expect(r.notes).toContain("سهو بصمة دخول");
  });
  it("still treats a lone MORNING punch as check-in with a missing check-out", () => {
    const [r] = run([emp("1")], [punch("1", "2026-03-02T08:55:00")], "2026-03-02", "2026-03-02");
    expect(r.checkIn).not.toBeNull();
    expect(penaltyTypes(r)).toEqual(["سهو بصمة"]);
  });
});

describe("per-employee shift", () => {
  it("uses the employee's own shift start (07:00 shift arriving 08:50 is late, leaving 15:00 is on time)", () => {
    const [r] = run([emp("2", { shiftStart: "07:00" })],
      [punch("2", "2026-03-02T08:50:00"), punch("2", "2026-03-02T15:00:00", 2)], "2026-03-02", "2026-03-02");
    expect(r.status).toBe("Late");
    expect(penaltyTypes(r)).toContain("تأخير");
    expect(penaltyTypes(r)).not.toContain("انصراف مبكر");
  });
  it("keeps the default 09:00–17:00 shift for employees without a custom start", () => {
    const [r] = run([emp("3")], [punch("3", "2026-03-02T09:05:00"), punch("3", "2026-03-02T17:00:00", 2)], "2026-03-02", "2026-03-02");
    expect(r.status).toBe("Present");
    expect(r.penalties).toEqual([]);
  });
});

describe("time-zone and DST independence", () => {
  it("gives identical results for the same wall-clock punches in winter and in DST months", () => {
    for (const date of ["2026-01-12", "2026-07-13"]) {
      const [r] = run([emp("4")], [punch("4", `${date}T09:20:00`), punch("4", `${date}T17:10:00`, 2)], date, date);
      expect(r.status).toBe("Late");
      expect((r.penalties ?? [])[0]).toMatchObject({ type: "تأخير", value: 0.25 });
    }
  });
});

describe("termination / hire date formats", () => {
  it.each([
    ["2026-03-05", "ISO"],
    ["05/03/2026", "day-first text"],
    ["Thu Mar 05 2026 00:00:00 GMT+0200 (Eastern European Standard Time)", "JS Date text"],
  ])("terminates after 5 March for %s (%s)", (terminationDate) => {
    const records = run([emp("5", { terminationDate })], [], "2026-03-04", "2026-03-08");
    const byDate = Object.fromEntries(records.map((r) => [r.date, r.status]));
    expect(byDate["2026-03-04"]).toBe("Absent");
    expect(byDate["2026-03-07"]).toBe("Termination Period");
    expect(byDate["2026-03-08"]).toBe("Termination Period");
  });
});

describe("effects", () => {
  it("applies a plain 'إذن' to the morning when the person arrived late", () => {
    const [r] = run([emp("6")], [punch("6", "2026-03-02T10:00:00"), punch("6", "2026-03-02T17:00:00", 2)], "2026-03-02", "2026-03-02", {
      effects: [{ employeeCode: "6", date: "2026-03-02", type: "إذن عام", fromTime: "09:00:00", toTime: "10:00:00" }],
    });
    expect(penaltyTypes(r)).not.toContain("تأخير");
  });
  it("writes unknown effect types in Arabic (no English 'Needs Mapping')", () => {
    const [r] = run([emp("7")], [punch("7", "2026-03-02T09:00:00"), punch("7", "2026-03-02T17:00:00", 2)], "2026-03-02", "2026-03-02", {
      effects: [{ employeeCode: "7", date: "2026-03-02", type: "نوع غريب" }],
    });
    expect(r.notes).toContain("نوع مؤثر غير معروف");
    expect(r.notes).not.toContain("Needs Mapping");
  });
  it("does not add a note for leave-like effects handled elsewhere", () => {
    const [r] = run([emp("8")], [punch("8", "2026-03-02T09:00:00"), punch("8", "2026-03-02T17:00:00", 2)], "2026-03-02", "2026-03-02", {
      effects: [{ employeeCode: "8", date: "2026-03-02", type: "إجازة رسمية" }],
    });
    expect(r.notes ?? "").not.toContain("غير معروف");
  });
  it("recognises any spelling of an adjustment type", () => {
    const [r] = run([emp("9")], [punch("9", "2026-03-02T10:00:00"), punch("9", "2026-03-02T17:00:00", 2)], "2026-03-02", "2026-03-02", {
      adjustments: [{ id: 1, employeeCode: "9", date: "2026-03-02", type: "اذن صباحي", fromTime: "09:00:00", toTime: "10:00:00", source: "t", sourceFileName: null, importedAt: null, note: null }],
    });
    expect(penaltyTypes(r)).not.toContain("تأخير");
  });
});

describe("rules scope", () => {
  it("never applies a rule with an unknown scope prefix to everybody", () => {
    const rules = [{ id: 1, name: "bad", priority: 1, scope: "bogus:1", startDate: "2026-03-01", endDate: "2026-03-31", ruleType: "custom_shift", params: { shiftStart: "13:00", shiftEnd: "21:00" } }] as const;
    const [r] = run([emp("10")], [punch("10", "2026-03-02T09:00:00"), punch("10", "2026-03-02T17:00:00", 2)], "2026-03-02", "2026-03-02", { rules: [...rules] });
    expect(r.status).toBe("Present");
  });
  it("supports comma separated department lists", () => {
    const rules = [{ id: 1, name: "ok", priority: 1, scope: "dept:x,d", startDate: "2026-03-01", endDate: "2026-03-31", ruleType: "custom_shift", params: { shiftStart: "13:00", shiftEnd: "21:00" } }] as const;
    const [r] = run([emp("11")], [punch("11", "2026-03-02T13:00:00"), punch("11", "2026-03-02T21:00:00", 2)], "2026-03-02", "2026-03-02", { rules: [...rules] });
    expect(r.status).toBe("Present");
  });
});

describe("single source of truth for penalty totals", () => {
  it("weights absence once and ignores excused absence by default", () => {
    expect(summarizePenalties([{ type: "غياب", value: 1 }, { type: "تأخير", value: 0.5 }], 1)).toMatchObject({
      absenceDays: 1, weightedAbsence: 2, late: 0.5, total: 2.5,
    });
  });

  it("detail sheet total == summary total == sum of its parts, and statuses have Arabic labels", () => {
    const base = {
      checkIn: null, checkOut: null, totalHours: 0, overtimeHours: 0, isOvernight: false, notes: null, missionStart: null, missionEnd: null,
      halfDayExcused: false, isOfficialHoliday: false, workedOnOfficialHoliday: null, compDayCredit: 0, leaveDeductionDays: 0,
      excusedAbsenceDays: 0, terminationPeriodDays: 0, compDaysFriday: 0, compDaysOfficial: 0, compDaysTotal: 0, compDaysUsed: 0,
    };
    const mk = (id: number, date: string, status: string, over: Partial<AttendanceRecord> = {}): AttendanceRecord =>
      ({ id, employeeCode: "7", date, status, penalties: [], ...base, ...over }) as AttendanceRecord;
    const records = [
      mk(1, "2026-03-02", "Official Holiday", { isOfficialHoliday: true }),
      mk(2, "2026-03-03", "Excused Absence", { excusedAbsenceDays: 1 }),
      mk(3, "2026-03-04", "Excused"),
      mk(4, "2026-03-05", "Absent", { penalties: [{ type: "غياب", value: 1 }] }),
    ];
    const out = buildAttendanceExportRows({ records, employees: [emp("7")], reportStartDate: "2026-03-02", reportEndDate: "2026-03-05" });
    const di = (h: string) => out.detailHeaders.indexOf(h);
    const labels = out.detailRows.slice(1).map((r) => r[di("الحالة")]);
    expect(labels).toEqual(["إجازة رسمية", "غياب بعذر", "بإذن", "غياب"]);
    const detailTotal = out.detailRows.slice(1).reduce((s, r) => s + Number(r[di("إجمالي الجزاءات")]), 0);
    const summaryRow = out.summaryRows[1];
    expect(summaryRow[out.summaryHeaders.indexOf("إجمالي الجزاءات")]).toBe(detailTotal);
    expect(detailTotal).toBe(2);
    Object.values(STATUS_AR).forEach((v) => expect(typeof v).toBe("string"));
  });
});

describe("performance", () => {
  it("processes 300 employees × 30 days (18,000 punches) in well under 2 seconds", () => {
    const employees = Array.from({ length: 300 }, (_, i) => emp(String(1000 + i)));
    const punches: BiometricPunch[] = [];
    let id = 1;
    for (const e of employees) {
      for (let d = 1; d <= 30; d++) {
        const dd = String(d).padStart(2, "0");
        punches.push(punch(e.code, `2026-03-${dd}T08:55:00`, id++), punch(e.code, `2026-03-${dd}T17:05:00`, id++));
      }
    }
    const t0 = performance.now();
    const records = run(employees, punches, "2026-03-01", "2026-03-30");
    const ms = performance.now() - t0;
    expect(records).toHaveLength(300 * 30);
    expect(ms).toBeLessThan(2000);
  });
});
