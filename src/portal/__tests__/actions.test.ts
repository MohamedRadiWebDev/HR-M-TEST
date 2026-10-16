import { beforeEach, describe, expect, it } from "vitest";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsStore } from "@/store/effectsStore";
import { usePortalStore } from "@/store/portalStore";
import { payrollPeriodOf, shiftPayrollPeriod } from "@shared/payroll-period";
import {
  addDeduction, assignCustody, cancelRequest, currentPayrollPeriod, decideLoan, decideRequest, generatePayslips,
  objectToDeduction, publishAnnouncement, requestLoan, resolveDeduction, resubmitRequest, runOvertimeDetection, submitRequest,
} from "../actions";
import { leaveBalance } from "../balances";

const att = () => useAttendanceStore.getState();
const pt = () => usePortalStore.getState();
const HR = { isHr: true, name: "HR" };

const reset = () => {
  useAttendanceStore.setState({
    employees: [], punches: [], rules: [], adjustments: [], leaves: [], officialHolidays: [], attendanceRecords: [],
    nextIds: { employee: 1, rule: 1, adjustment: 1, leave: 1, record: 1 },
  });
  useEffectsStore.getState().replaceEffects([]);
  usePortalStore.getState().reset();
};

const seed = () => {
  att().importEmployees([
    { code: "10", nameAr: "المدير" },
    { code: "30", nameAr: "الموظف", directManager: "10", shiftStart: "09:00" },
  ]);
};
const proc = (start: string, end: string) => att().processAttendance({ startDate: start, endDate: end });
const rec = (date: string, code = "30") => att().attendanceRecords.find((r) => r.date === date && r.employeeCode === code)!;

describe("requests → approvals → attendance", () => {
  beforeEach(() => { reset(); seed(); });

  it("a mission approved by manager then HR cancels the lateness of that day", async () => {
    att().importPunches([{ employeeCode: "30", punchDatetime: "2026-03-02T10:30:00" }, { employeeCode: "30", punchDatetime: "2026-03-02T17:00:00" }]);
    await proc("2026-03-02", "2026-03-02");
    expect(rec("2026-03-02").penalties?.map((p) => p.type)).toContain("تأخير");

    const r = submitRequest({ employeeCode: "30", type: "mission", date: "2026-03-02", fromTime: "09:00", toTime: "12:00", reason: "زيارة عميل" });
    expect(r.code).toBe("REQ-001");
    expect(r.chain.map((s) => s.role)).toEqual(["manager", "hr"]);
    expect(pt().notifications.some((n) => n.employeeCode === "10")).toBe(true); // manager notified

    await expect(decideRequest(r.id, { code: "99", isHr: false }, "approve")).rejects.toThrow(); // stranger
    expect((await decideRequest(r.id, { code: "10", isHr: false, name: "المدير" }, "approve", "تمام")).outcome).toBe("advanced");
    expect(pt().notifications.some((n) => n.employeeCode === "HR")).toBe(true); // next approver notified
    expect(rec("2026-03-02").penalties?.map((p) => p.type)).toContain("تأخير"); // not final yet

    expect((await decideRequest(r.id, HR, "approve")).outcome).toBe("approved");
    expect(rec("2026-03-02").penalties).toEqual([]);
    expect(pt().notifications.some((n) => n.employeeCode === "30" && n.title.includes("تمت الموافقة"))).toBe(true);
  });

  it("annual leave creates one effect per working day and consumes the balance", async () => {
    att().createOfficialHoliday({ date: "2026-03-04", name: "عطلة" });
    const r = submitRequest({ employeeCode: "30", type: "leave_annual", date: "2026-03-02", endDate: "2026-03-09" });
    await decideRequest(r.id, { code: "10", isHr: false }, "approve");
    await decideRequest(r.id, HR, "approve");
    const effects = useEffectsStore.getState().effects;
    expect(effects.map((e) => e.date)).toEqual(["2026-03-02", "2026-03-03", "2026-03-05", "2026-03-07", "2026-03-08", "2026-03-09"]); // no Fri, no holiday
    const balance = leaveBalance({ employeeCode: "30", year: 2026, requests: pt().requests, settings: pt().settings, holidays: new Set(["2026-03-04"]) });
    expect(balance).toMatchObject({ used: 6, remaining: 15 });
  });

  it("an approved punch correction adds the missing punch and clears 'سهو بصمة'", async () => {
    att().importPunches([{ employeeCode: "30", punchDatetime: "2026-03-03T08:55:00" }]);
    await proc("2026-03-03", "2026-03-03");
    expect(rec("2026-03-03").penalties?.map((p) => p.type)).toContain("سهو بصمة");
    const r = submitRequest({ employeeCode: "30", type: "punch_correction", date: "2026-03-03", fromTime: "17:05", reason: "نسيت البصمة" });
    await decideRequest(r.id, { code: "10", isHr: false }, "approve");
    await decideRequest(r.id, HR, "approve");
    expect(rec("2026-03-03").penalties).toEqual([]);
    expect(att().punches).toHaveLength(2);
  });

  it("reject / return / resubmit / cancel rules", async () => {
    const a = submitRequest({ employeeCode: "30", type: "half_day", date: "2026-03-02" });
    await decideRequest(a.id, { code: "10", isHr: false }, "return", "حدد الفترة");
    expect(pt().requests.find((r) => r.id === a.id)?.status).toBe("returned");
    resubmitRequest(a.id, { reason: "صباحًا" });
    const again = pt().requests.find((r) => r.id === a.id)!;
    expect(again.status).toBe("pending");
    expect(again.chain.every((s) => s.status === "waiting")).toBe(true);

    await decideRequest(a.id, { code: "10", isHr: false }, "reject", "لا");
    expect(pt().requests.find((r) => r.id === a.id)?.status).toBe("rejected");
    expect(() => cancelRequest(a.id, "30")).toThrow(); // decided requests cannot be cancelled

    const b = submitRequest({ employeeCode: "30", type: "absence_excuse", date: "2026-03-03" });
    expect(() => cancelRequest(b.id, "10")).toThrow(); // only the owner
    cancelRequest(b.id, "30");
    expect(pt().requests.find((r) => r.id === b.id)?.status).toBe("cancelled");
  });

  it("validates input", () => {
    expect(() => submitRequest({ employeeCode: "30", type: "mission", date: "2026-03-02", fromTime: "12:00", toTime: "10:00" })).toThrow();
    expect(() => submitRequest({ employeeCode: "30", type: "leave_annual", date: "2026-03-05", endDate: "2026-03-02" })).toThrow();
    expect(() => submitRequest({ employeeCode: "30", type: "overtime", date: "2026-03-02" })).toThrow();
    expect(() => submitRequest({ employeeCode: "999", type: "half_day", date: "2026-03-02" })).toThrow();
  });
});

describe("overtime → approval → payroll", () => {
  beforeEach(() => { reset(); seed(); });

  it("detected overtime becomes requests (once) and is paid only after approval", async () => {
    att().importPunches([{ employeeCode: "30", punchDatetime: "2026-03-02T09:00:00" }, { employeeCode: "30", punchDatetime: "2026-03-02T20:00:00" }]);
    await proc("2026-03-02", "2026-03-02");
    expect(rec("2026-03-02").overtimeHours).toBeGreaterThan(0);

    expect(runOvertimeDetection()).toBe(1);
    expect(runOvertimeDetection()).toBe(0); // no duplicates
    const request = pt().requests[0];
    expect(request).toMatchObject({ type: "overtime", source: "auto" });

    pt().upsert("salaryProfiles", { id: "s", employeeCode: "30", basic: 8000, housing: 0, transport: 0, phone: 0, nature: 0, other: 0, pressure: 0 });
    const period = payrollPeriodOf(2026, 3, 24);
    generatePayslips(period, { publish: false });
    expect(pt().payslips[0].net).toBe(8000); // pending overtime is not paid

    await decideRequest(request.id, { code: "10", isHr: false }, "approve");
    await decideRequest(request.id, HR, "approve");
    generatePayslips(period, { publish: false });
    expect(pt().payslips).toHaveLength(1); // regenerated in place
    expect(pt().payslips[0].net).toBeGreaterThan(8000);
  });
});

describe("loans, deductions, payslips", () => {
  beforeEach(() => {
    reset(); seed();
    pt().upsert("salaryProfiles", { id: "s", employeeCode: "30", basic: 6000, housing: 0, transport: 0, phone: 0, nature: 0, other: 0, pressure: 0 });
  });

  it("loan: request → HR approves → instalments start next payroll month → paid when payslips are published", () => {
    const loan = requestLoan("30", 3000, 3, "ظرف طارئ");
    expect(() => requestLoan("30", 0, 3)).toThrow();
    decideLoan(loan.id, true);
    const approved = pt().loans[0];
    const next = shiftPayrollPeriod(currentPayrollPeriod(), 1, att().config.payrollMonthStartDay);
    expect(approved.status).toBe("approved");
    expect(approved.schedule[0].periodKey).toBe(`${next.year}-${String(next.month).padStart(2, "0")}`);

    generatePayslips(next, { publish: true });
    expect(pt().payslips[0].deductions.some((l) => l.label.startsWith("قسط سلفة"))).toBe(true);
    expect(pt().loans[0].schedule[0].status).toBe("paid");
    generatePayslips(next, { publish: true }); // idempotent: still deducted, no second payment
    expect(pt().payslips).toHaveLength(1);
    expect(pt().payslips[0].deductions.some((l) => l.label.startsWith("قسط سلفة"))).toBe(true);
    expect(pt().notifications.filter((n) => n.title.startsWith("قسيمة راتب"))).toHaveLength(1);
  });

  it("deduction: notified → objected (held out of payroll) → cancelled / upheld", () => {
    const period = payrollPeriodOf(2026, 3, 24);
    addDeduction("30", 500, "تأخر تسليم", "التزام", period);
    const id = pt().deductions[0].id;
    generatePayslips(period, { publish: false });
    expect(pt().payslips[0].net).toBe(5500);

    objectToDeduction(id, "كان بإذن");
    generatePayslips(period, { publish: false });
    expect(pt().payslips[0].net).toBe(6000); // held while objected
    expect(() => objectToDeduction(id, "تاني")).toThrow();

    resolveDeduction(id, "upheld", "الاعتراض غير مقبول");
    generatePayslips(period, { publish: false });
    expect(pt().payslips[0].net).toBe(5500);
    expect(() => resolveDeduction(id, "cancelled", "x")).toThrow(); // already resolved
  });
});

describe("custody + announcements", () => {
  beforeEach(() => { reset(); seed(); });
  it("custody starts pending with a notification; announcements notify everybody", () => {
    assignCustody("30", "لابتوب", "SN-1");
    expect(pt().custody[0]).toMatchObject({ status: "pending", name: "لابتوب" });
    expect(pt().notifications.some((n) => n.employeeCode === "30" && n.title.includes("عهدة"))).toBe(true);
    publishAnnouncement("إجازة العيد", "الشركة مغلقة");
    expect(pt().announcements).toHaveLength(1);
    expect(pt().notifications.filter((n) => n.title.startsWith("إعلان")).map((n) => n.employeeCode).sort()).toEqual(["10", "30"]);
  });
});
