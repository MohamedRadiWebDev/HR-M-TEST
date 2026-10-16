import { describe, expect, it } from "vitest";
import type { AttendanceRecord, Employee } from "@shared/schema";
import { DEFAULT_PORTAL_SETTINGS, type PortalRequest } from "@shared/portal";
import { payrollPeriodOf } from "@shared/payroll-period";
import { buildApprovalChain, canAct, currentStep, decide, resubmit } from "../approvals";
import { leaveBalance } from "../balances";
import { detectOvertime } from "../overtime";
import { buildLoanSchedule, computePayslip, grossOf, periodKeyOf } from "../payroll";
import { countLeaveDays, leaveDates, requestToEffects } from "../requestEffects";
import { respondentKey, surveyResults, upcomingOccasions } from "../misc";

const emp = (code: string, extra: Partial<Employee> = {}): Employee =>
  ({ id: 1, code, nameAr: `emp-${code}`, directManager: null, hireDate: null, terminationDate: null, birthDate: null, ...extra }) as Employee;

const req = (over: Partial<PortalRequest> = {}): PortalRequest => ({
  id: "r1", code: "REQ-1", employeeCode: "1", type: "leave_annual", date: "2026-03-02", status: "pending", source: "employee",
  chain: [], comments: [], createdAt: "x", updatedAt: "x", ...over,
});

describe("approval chain", () => {
  const boss = emp("10", { nameAr: "المدير العام" });
  const mid = emp("20", { nameAr: "مدير القسم", directManager: "10" });
  const worker = emp("30", { directManager: "مدير القسم" }); // manager written by NAME
  const all = [boss, mid, worker];

  it("direct manager → manager's manager → HR (manager found by code OR name)", () => {
    const chain = buildApprovalChain(worker, all);
    expect(chain.map((s) => [s.role, s.approverCode])).toEqual([["manager", "20"], ["manager", "10"], ["hr", null]]);
  });
  it("falls back to HR only when there is no manager and never loops", () => {
    expect(buildApprovalChain(emp("99"), all).map((s) => s.role)).toEqual(["hr"]);
    const a = emp("1", { directManager: "2" });
    const b = emp("2", { directManager: "1" });
    expect(buildApprovalChain(a, [a, b]).length).toBeLessThanOrEqual(3);
  });

  it("walks the chain; only the right person may act; HR can override", () => {
    const r = req({ employeeCode: "30", chain: buildApprovalChain(worker, all) });
    expect(canAct(r, { code: "10", isHr: false })).toBe(false); // not their step yet
    expect(canAct(r, { code: "20", isHr: false })).toBe(true);
    expect(() => decide(r, { code: "10", isHr: false }, "approve", "")).toThrow();

    const s1 = decide(r, { code: "20", isHr: false }, "approve", "تمام");
    expect(s1.outcome).toBe("advanced");
    expect(s1.request.status).toBe("pending");
    expect(currentStep(s1.request)?.approverCode).toBe("10");
    const s2 = decide(s1.request, { isHr: true, name: "HR" }, "approve", undefined); // HR overrides the manager's step
    const s3 = decide(s2.request, { isHr: true }, "approve", undefined);
    expect(s3.outcome).toBe("approved");
    expect(s3.request.status).toBe("approved");
    expect(s3.request.comments.map((c) => c.text)).toEqual(["تمام"]);
  });

  it("reject ends it; return lets the employee resubmit from step 1", () => {
    const r = req({ chain: buildApprovalChain(emp("1", { directManager: "10" }), all) });
    const rejected = decide(r, { code: "10", isHr: false }, "reject", "لا");
    expect(rejected.request.status).toBe("rejected");
    expect(canAct(rejected.request, { isHr: true })).toBe(false);

    const returned = decide(r, { code: "10", isHr: false }, "return", "أضف السبب");
    expect(returned.request.status).toBe("returned");
    const again = resubmit(returned.request, { reason: "تمت الإضافة" });
    expect(again.status).toBe("pending");
    expect(again.chain.every((s) => s.status === "waiting")).toBe(true);
  });
});

describe("request → attendance effects", () => {
  const holidays = new Set(["2026-03-04"]);
  it("leave days skip Fridays and official holidays", () => {
    // Mon 2 → Mon 9 March: Fri 6 and the holiday Wed 4 are not counted
    const r = req({ date: "2026-03-02", endDate: "2026-03-09" });
    expect(leaveDates(r, holidays)).toEqual(["2026-03-02", "2026-03-03", "2026-03-05", "2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(countLeaveDays(r, holidays)).toBe(6);
    expect(countLeaveDays(req({ type: "half_day" }), holidays)).toBe(0.5);
  });
  it("maps each request type to the engine's effect type", () => {
    expect(requestToEffects(req({ type: "leave_annual", date: "2026-03-02", endDate: "2026-03-03" }), holidays).map((e) => e.type)).toEqual(["إجازة من الرصيد", "إجازة من الرصيد"]);
    const mission = requestToEffects(req({ type: "mission", fromTime: "10:00", toTime: "12:00" }), holidays)[0];
    expect(mission).toMatchObject({ type: "مأمورية", fromTime: "10:00", toTime: "12:00", note: "طلب REQ-1" });
    expect(requestToEffects(req({ type: "overtime", hours: 2 }), holidays)).toEqual([]);
  });
});

describe("leave balance", () => {
  it("counts approved days as used and pending separately", () => {
    const requests = [
      req({ id: "a", date: "2026-03-02", endDate: "2026-03-03", status: "approved" }),
      req({ id: "b", date: "2026-05-04", status: "pending" }),
      req({ id: "c", date: "2025-12-01", status: "approved" }), // other year
      req({ id: "d", date: "2026-06-01", status: "rejected" }),
    ];
    const b = leaveBalance({ employeeCode: "1", year: 2026, requests, settings: DEFAULT_PORTAL_SETTINGS, holidays: new Set() });
    expect(b).toEqual({ quota: 21, used: 2, pending: 1, remaining: 19 });
    expect(leaveBalance({ employeeCode: "1", year: 2026, requests, settings: { ...DEFAULT_PORTAL_SETTINGS, leaveQuotaOverrides: { "1": 30 } }, holidays: new Set() }).quota).toBe(30);
  });
});

describe("overtime detection", () => {
  it("proposes requests for days with overtime that have none yet", () => {
    const rec = (d: string, ot: number) => ({ employeeCode: "1", date: d, overtimeHours: ot }) as AttendanceRecord;
    const found = detectOvertime([rec("2026-03-02", 2), rec("2026-03-03", 0.2), rec("2026-03-04", 1.256)], [req({ type: "overtime", date: "2026-03-02" })]);
    expect(found).toEqual([{ employeeCode: "1", date: "2026-03-04", hours: 1.26 }]);
  });
});

describe("payroll", () => {
  const period = payrollPeriodOf(2026, 3, 24);
  const salary = { id: "s", employeeCode: "1", basic: 5200, housing: 2000, transport: 800, phone: 0, nature: 0, other: 0, pressure: 0 };
  const base = { salary, period, records: [], requests: [], bonuses: [], deductions: [], loans: [], settings: DEFAULT_PORTAL_SETTINGS };

  it("gross, daily rate and a clean month", () => {
    expect(grossOf(salary)).toBe(8000);
    const p = computePayslip(base);
    expect(p).toMatchObject({ gross: 8000, net: 8000, periodKey: "2026-03", attendanceDays: 0 });
    expect(p.periodLabel).toBe("مارس 2026");
  });

  it("deducts attendance penalties (absence ×2) at gross/30 per day", () => {
    const rec = (date: string, penalties: { type: string; value: number }[], extra = {}) => ({ employeeCode: "1", date, penalties, excusedAbsenceDays: 0, leaveDeductionDays: 0, ...extra }) as AttendanceRecord;
    const records = [
      rec("2026-03-02", [{ type: "غياب", value: 1 }]), // 2 days
      rec("2026-03-03", [{ type: "تأخير", value: 0.5 }]),
      rec("2026-03-04", [], { leaveDeductionDays: 1 }), // unpaid leave 1 day
      rec("2026-04-10", [{ type: "غياب", value: 1 }]), // other payroll month → ignored
    ];
    const p = computePayslip({ ...base, records });
    expect(p.attendanceDays).toBe(3.5);
    expect(p.deductions[0].amount).toBeCloseTo((8000 / 30) * 3.5, 2);
    expect(p.net).toBeCloseTo(8000 - (8000 / 30) * 3.5, 2);
  });

  it("adds approved overtime and bonuses; applies notified/upheld deductions and due loan instalments only", () => {
    const loan = { id: "l", employeeCode: "1", amount: 3000, installments: 3, status: "approved" as const, schedule: buildLoanSchedule(3000, 3, { year: 2026, month: 3 }), createdAt: "x" };
    const p = computePayslip({
      ...base,
      requests: [req({ type: "overtime", status: "approved", date: "2026-03-05", hours: 2 }), req({ id: "x", type: "overtime", status: "pending", date: "2026-03-06", hours: 9 })],
      bonuses: [{ id: "b", employeeCode: "1", amount: 500, periodKey: "2026-03", reason: "تميز", createdAt: "x" }],
      deductions: [
        { id: "d1", employeeCode: "1", amount: 100, periodKey: "2026-03", reason: "جودة", category: "خصم", status: "notified", createdAt: "x" },
        { id: "d2", employeeCode: "1", amount: 999, periodKey: "2026-03", reason: "معترض عليه", category: "خصم", status: "objected", createdAt: "x" },
        { id: "d3", employeeCode: "1", amount: 50, periodKey: "2026-03", reason: "ملغي", category: "خصم", status: "cancelled", createdAt: "x" },
      ],
      loans: [loan],
    });
    const overtime = p.earnings.find((l) => l.label.startsWith("عمل إضافي"))!;
    expect(overtime.amount).toBeCloseTo((8000 / 30 / 8) * 2 * 1.35, 2); // pending overtime ignored
    expect(p.earnings.some((l) => l.label.includes("تميز"))).toBe(true);
    expect(p.deductions.map((l) => l.amount)).toEqual([100, 1000]); // objected + cancelled ignored, 1st of 3 instalments
  });

  it("never deducts more than the gross salary for attendance", () => {
    const records = Array.from({ length: 31 }, (_, i) => ({ employeeCode: "1", date: `2026-03-${String(i + 1).padStart(2, "0")}`, penalties: [{ type: "غياب", value: 1 }], excusedAbsenceDays: 0, leaveDeductionDays: 0 }) as AttendanceRecord);
    const p = computePayslip({ ...base, records: records.filter((r) => r.date >= period.start && r.date <= period.end) });
    expect(p.deductions[0].amount).toBeLessThanOrEqual(8000);
    expect(p.net).toBeGreaterThanOrEqual(0);
  });

  it("loan schedule: equal instalments, last one absorbs the rounding, months roll over the year", () => {
    const s = buildLoanSchedule(1000, 3, { year: 2026, month: 11 });
    expect(s.map((i) => i.periodKey)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(s.map((i) => i.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(periodKeyOf({ year: 2026, month: 3 })).toBe("2026-03");
  });
});

describe("occasions and surveys", () => {
  it("lists birthdays and anniversaries inside the window only", () => {
    const list = upcomingOccasions(
      [emp("1", { birthDate: "1990-10-16", hireDate: "2024-10-16" }), emp("2", { birthDate: "1990-12-01" }), emp("3", { hireDate: "2026-10-15" })],
      "2026-10-15", 7);
    expect(list.map((o) => [o.employeeCode, o.kind, o.years ?? 0])).toEqual([["1", "birthday", 0], ["1", "anniversary", 2]]);
  });

  it("anonymous results are aggregated; the respondent key never contains the code", () => {
    const survey = { id: "s1", title: "t", anonymous: true, open: true, createdAt: "x", questions: [
      { id: "q1", text: "قيّم", kind: "rating" as const }, { id: "q2", text: "اختر", kind: "choice" as const, options: ["أ", "ب"] }, { id: "q3", text: "رأيك", kind: "text" as const }] };
    const mk = (n: number, a: string, t: string) => ({ id: `r${n}`, surveyId: "s1", respondent: respondentKey("s1", `E${n}`), answers: { q1: n, q2: a, q3: t }, createdAt: "x" });
    const res = surveyResults(survey, [mk(4, "أ", "جيد"), mk(5, "أ", ""), mk(3, "ب", "ممتاز")]);
    expect(res.q1).toEqual({ kind: "rating", average: 4, count: 3 });
    expect(res.q2).toEqual({ kind: "choice", counts: { أ: 2, ب: 1 } });
    expect(res.q3).toEqual({ kind: "text", answers: ["جيد", "ممتاز"] });
    expect(respondentKey("s1", "E4")).not.toContain("E4");
    expect(respondentKey("s1", "E4")).toBe(respondentKey("s1", "E4"));
  });
});
