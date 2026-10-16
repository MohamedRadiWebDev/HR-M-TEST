import { beforeEach, describe, expect, it } from "vitest";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsStore } from "@/store/effectsStore";
import { syncEffectsChange } from "@/effects/syncEffects";

const store = () => useAttendanceStore.getState();
const reset = () => {
  useAttendanceStore.setState({
    employees: [], punches: [], rules: [], adjustments: [], leaves: [], officialHolidays: [], attendanceRecords: [],
    nextIds: { employee: 1, rule: 1, adjustment: 1, leave: 1, record: 1 },
  });
  useEffectsStore.getState().replaceEffects([]);
};
const seed = () => {
  store().importEmployees([{ code: "1", nameAr: "أحمد", shiftStart: "09:00" }]);
  store().importPunches([
    { employeeCode: "1", punchDatetime: "2026-03-02T08:55:00" },
    { employeeCode: "1", punchDatetime: "2026-03-02T17:05:00" },
  ]);
};

describe("employees", () => {
  beforeEach(reset);

  it("re-importing an existing employee UPDATES it (blank cells never erase data)", () => {
    seed();
    const r = store().importEmployees([{ code: "1", nameAr: "أحمد", terminationDate: "15/03/2026", shiftStart: "07:00" }]);
    expect(r).toMatchObject({ inserted: 0, updated: 1 });
    const e = store().employees[0];
    expect(e.terminationDate).toBe("2026-03-15"); // normalised, day-first
    expect(e.shiftStart).toBe("07:00");

    store().importEmployees([{ code: "1", nameAr: "أحمد", terminationDate: "", shiftStart: "" }]);
    expect(store().employees[0].terminationDate).toBe("2026-03-15");
    expect(store().employees[0].shiftStart).toBe("07:00");
  });

  it("normalises hire/birth dates and refuses duplicate codes", () => {
    const e = store().createEmployee({ code: " 5 ", nameAr: "منى", hireDate: "01/02/2025", birthDate: "٠١/٠٣/١٩٩٠", shiftStart: "8" });
    expect(e).toMatchObject({ code: "5", hireDate: "2025-02-01", birthDate: "1990-03-01", shiftStart: "08:00" });
    expect(() => store().createEmployee({ code: "5", nameAr: "مكرر" })).toThrow();
  });

  it("changing an employee code moves punches, adjustments, records and effects with it", async () => {
    seed();
    store().createAdjustment({ employeeCode: "1", date: "2026-03-02", type: "مأمورية", fromTime: "10:00:00", toTime: "11:00:00", source: "t" });
    useEffectsStore.getState().upsertEffects([{ employeeCode: "1", date: "2026-03-02", type: "مأمورية", source: "manual" }]);
    await store().processAttendance({ startDate: "2026-03-02", endDate: "2026-03-02" });

    const id = store().employees[0].id;
    store().updateEmployee(id, { code: "99" });
    expect(store().punches.every((p) => p.employeeCode === "99")).toBe(true);
    expect(store().adjustments[0].employeeCode).toBe("99");
    expect(store().attendanceRecords.every((r) => r.employeeCode === "99")).toBe(true);
    expect(useEffectsStore.getState().effects[0].employeeCode).toBe("99");

    store().createEmployee({ code: "3", nameAr: "x" });
    expect(() => store().updateEmployee(id, { code: "3" })).toThrow();
  });
});

describe("official holidays", () => {
  beforeEach(reset);
  it("keeps ids unique after deletions and rejects duplicate dates", () => {
    const a = store().createOfficialHoliday({ date: "2026-04-25", name: "A" });
    const b = store().createOfficialHoliday({ date: "2026-05-01", name: "B" });
    const c = store().createOfficialHoliday({ date: "2026-06-30", name: "C" });
    store().deleteOfficialHoliday(b.id);
    const d = store().createOfficialHoliday({ date: "2026-07-23", name: "D" });
    expect(new Set([a.id, c.id, d.id]).size).toBe(3);
    store().deleteOfficialHoliday(d.id);
    expect(store().officialHolidays.map((h) => h.name)).toEqual(["A", "C"]);
    expect(() => store().createOfficialHoliday({ date: "25/04/2026", name: "dup" })).toThrow();
  });
});

describe("imports", () => {
  beforeEach(reset);
  it("dedupes adjustments and reports invalid rows", () => {
    const row = { employeeCode: "1", date: "2026-03-02", type: "مأمورية" as const, fromTime: "10:00:00", toTime: "11:00:00", source: "file" };
    const first = store().importAdjustments([row, row, { ...row, date: "nonsense" }, { ...row, type: "اجازة نصف يوم" as never }]);
    expect(first.inserted).toBe(2); // مأمورية + the half-day spelling variant (canonicalised)
    expect(first.duplicates).toBe(1);
    expect(first.invalid).toHaveLength(1);
    expect(store().importAdjustments([row]).inserted).toBe(0);
  });

  it("validates rules and leaves", () => {
    const rules = store().importRules([
      { name: "ok", scope: "all", startDate: "01/03/2026", endDate: "31/03/2026", ruleType: "custom_shift", params: {}, priority: 1 },
      { name: "bad type", scope: "all", startDate: "2026-03-01", endDate: "2026-03-31", ruleType: "nope" as never, params: {}, priority: 0 },
      { name: "reversed", scope: "all", startDate: "2026-03-31", endDate: "2026-03-01", ruleType: "custom_shift", params: {}, priority: 0 },
    ]);
    expect(rules.count).toBe(1);
    expect(rules.invalid).toHaveLength(2);
    expect(store().rules[0].startDate).toBe("2026-03-01");

    const leaves = store().importLeaves([
      { type: "annual", scope: "all", startDate: "2026-03-01", endDate: "2026-03-02" },
      { type: "annual", scope: "all", startDate: "2026-03-01", endDate: "2026-03-02" },
      { type: "annual", scope: "all", startDate: "bad", endDate: "2026-03-02" },
    ]);
    expect(leaves).toMatchObject({ inserted: 1, duplicates: 1 });
    expect(leaves.invalid).toHaveLength(1);
  });

  it("imports punches as wall-clock and drops duplicates / invalid rows", () => {
    const r = store().importPunches([
      { employeeCode: "1", punchDatetime: "2026-07-10T09:00:00" },
      { employeeCode: "1", punchDatetime: "2026-07-10T09:00:00" },
      { employeeCode: "1", punchDatetime: "10/07/2026 5:00 PM" },
      { employeeCode: "", punchDatetime: "2026-07-10T09:00:00" },
      { employeeCode: "1", punchDatetime: "garbage" },
    ]);
    expect(r).toEqual({ count: 2, invalid: 2 });
    expect(store().punches[0].punchDatetime.toISOString()).toBe("2026-07-10T09:00:00.000Z"); // wall-clock, not shifted
  });
});

describe("processing", () => {
  beforeEach(reset);

  it("computes records and keeps ids unique", async () => {
    seed();
    const result = await store().processAttendance({ startDate: "2026-03-02", endDate: "2026-03-04" });
    expect(result.processedCount).toBe(3);
    const ids = store().attendanceRecords.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    expect(store().attendanceRecords.find((r) => r.date === "2026-03-02")?.status).toBe("Present");
  });

  it("REFUSES to overwrite real records with 'Absent' when no punches are loaded (e.g. after a refresh)", async () => {
    seed();
    await store().processAttendance({ startDate: "2026-03-02", endDate: "2026-03-04" });
    useAttendanceStore.setState({ punches: [] }); // what a refresh used to do
    const result = await store().processAttendance({ startDate: "2026-03-02", endDate: "2026-03-04" });
    expect(result.skipped).toBe(true);
    expect(store().attendanceRecords.find((r) => r.date === "2026-03-02")?.status).toBe("Present");
  });

  it("toggling 'worked on the official holiday' updates every dependent field and survives reprocessing", async () => {
    seed();
    store().createOfficialHoliday({ date: "2026-03-04", name: "H" });
    await store().processAttendance({ startDate: "2026-03-02", endDate: "2026-03-04" });
    const holiday = store().attendanceRecords.find((r) => r.date === "2026-03-04")!;
    store().setWorkedOnOfficialHoliday(holiday.id, true);
    const updated = store().attendanceRecords.find((r) => r.id === holiday.id)!;
    expect(updated).toMatchObject({ workedOnOfficialHoliday: true, compDayCredit: 1, compDaysOfficial: 1 });
    expect(updated.compDaysTotal).toBe(1 + (updated.compDaysFriday ?? 0));

    await store().processAttendance({ startDate: "2026-03-02", endDate: "2026-03-04" });
    expect(store().attendanceRecords.find((r) => r.date === "2026-03-04")?.compDaysOfficial).toBe(1);
  });
});

describe("effects ↔ attendance sync", () => {
  beforeEach(reset);

  it("deleting an effect removes its impact (no ghost adjustment)", async () => {
    store().importEmployees([{ code: "1", nameAr: "أحمد", shiftStart: "09:00" }]);
    store().importPunches([{ employeeCode: "1", punchDatetime: "2026-03-02T10:30:00" }, { employeeCode: "1", punchDatetime: "2026-03-02T17:00:00" }]);
    await store().processAttendance({ startDate: "2026-03-02", endDate: "2026-03-02" });
    expect(store().attendanceRecords[0].penalties?.map((p) => p.type)).toContain("تأخير");

    const fx = useEffectsStore.getState();
    const before0 = fx.effects;
    fx.upsertEffects([{ employeeCode: "1", date: "2026-03-02", type: "مأمورية", fromTime: "09:00:00", toTime: "12:00:00", source: "manual" }]);
    await syncEffectsChange(before0, useEffectsStore.getState().effects);
    expect(store().attendanceRecords[0].penalties).toEqual([]); // mission excuses the lateness

    const before1 = useEffectsStore.getState().effects;
    useEffectsStore.getState().removeEffect(before1[0].id);
    await syncEffectsChange(before1, useEffectsStore.getState().effects);
    expect(store().attendanceRecords[0].penalties?.map((p) => p.type)).toContain("تأخير"); // back to normal
  });

  it("official-holiday effect becomes a leave and disappears with the effect", async () => {
    store().importEmployees([{ code: "1", nameAr: "أحمد" }]);
    const before = useEffectsStore.getState().effects;
    useEffectsStore.getState().upsertEffects([{ employeeCode: "1", date: "2026-03-02", type: "إجازة رسمية", source: "manual" }]);
    await syncEffectsChange(before, useEffectsStore.getState().effects);
    expect(store().leaves).toHaveLength(1);

    const before2 = useEffectsStore.getState().effects;
    useEffectsStore.getState().removeEffect(before2[0].id);
    await syncEffectsChange(before2, useEffectsStore.getState().effects);
    expect(store().leaves).toHaveLength(0);
  });
});
