import { normalizeDateToIso } from "@shared/date-normalization";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { payrollPeriodContaining, payrollPeriodOf, shiftPayrollPeriod, type PayrollPeriod } from "@shared/payroll-period";
import { REQUEST_TYPES, type DeductionStatus, type Loan, type PortalRequest, type RequestType } from "@shared/portal";
import { syncEffectsChange } from "@/effects/syncEffects";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsStore } from "@/store/effectsStore";
import { usePortalStore } from "@/store/portalStore";
import { buildApprovalChain, canAct, currentStep, decide, resubmit, type Actor, type Decision } from "./approvals";
import { detectOvertime } from "./overtime";
import { buildLoanSchedule, computePayslip, periodKeyOf } from "./payroll";
import { requestToEffects } from "./requestEffects";
import { makeNotification, newId } from "./misc";

/** Notifications for HR are addressed to this pseudo employee code. */
export const HR_INBOX = "HR";

const portal = () => usePortalStore.getState();
const att = () => useAttendanceStore.getState();
const notify = (code: string, title: string, body?: string, link?: string) => portal().upsert("notifications", makeNotification(code, title, body, link));
const holidaySet = () => new Set(att().officialHolidays.map((h) => h.date));
const employeeOf = (code: string) => att().employees.find((e) => normalizeEmployeeCode(e.code) === normalizeEmployeeCode(code));

// ================================================================== requests
export type RequestInput = {
  employeeCode: string; type: RequestType; date: string; endDate?: string; fromTime?: string; toTime?: string; hours?: number; reason?: string;
  source?: PortalRequest["source"];
};

export const validateRequest = (input: RequestInput): string | null => {
  const meta = REQUEST_TYPES[input.type];
  const date = normalizeDateToIso(input.date);
  if (!date) return "التاريخ غير صالح.";
  if (meta.multiDay && input.endDate) {
    const end = normalizeDateToIso(input.endDate);
    if (!end || end < date) return "تاريخ النهاية يجب ألا يسبق البداية.";
  }
  if (input.type === "punch_correction") {
    if (!input.fromTime) return "حدد وقت البصمة المنسية.";
  } else if (meta.needsTimes) {
    if (!input.fromTime || !input.toTime) return "حدد وقت البداية والنهاية.";
    if (input.toTime <= input.fromTime) return "وقت النهاية يجب أن يكون بعد البداية.";
  }
  if (meta.needsHours && !(Number(input.hours) > 0)) return "حدد عدد ساعات صحيح.";
  if (!employeeOf(input.employeeCode)) return "الموظف غير موجود.";
  return null;
};

export const submitRequest = (input: RequestInput): PortalRequest => {
  const error = validateRequest(input);
  if (error) throw new Error(error);
  const employee = employeeOf(input.employeeCode)!;
  const now = new Date().toISOString();
  const request: PortalRequest = {
    id: newId(),
    code: portal().nextRequestCode(),
    employeeCode: employee.code,
    type: input.type,
    date: normalizeDateToIso(input.date),
    endDate: input.endDate ? normalizeDateToIso(input.endDate) || undefined : undefined,
    fromTime: input.fromTime,
    toTime: input.toTime,
    hours: input.hours,
    reason: input.reason?.trim() || undefined,
    status: "pending",
    source: input.source ?? "employee",
    chain: buildApprovalChain(employee, att().employees),
    comments: [],
    createdAt: now,
    updatedAt: now,
  };
  portal().upsert("requests", request);
  const first = request.chain[0];
  notify(first.role === "manager" ? first.approverCode! : HR_INBOX, `طلب جديد ${request.code}`, `${employee.nameAr} - ${REQUEST_TYPES[request.type].label}`, "/portal/team");
  return request;
};

/** What happens in the attendance system once the LAST approval is given. */
const applyApproved = async (request: PortalRequest) => {
  if (request.type === "punch_correction" && request.fromTime) {
    // the approved time is added as a real punch, then that day is recomputed
    att().importPunches([{ employeeCode: request.employeeCode, punchDatetime: `${request.date}T${request.fromTime}:00` }]);
    await att().processAttendance({ startDate: request.date, endDate: request.date, employeeCodes: [request.employeeCode] });
    return;
  }
  const effects = requestToEffects(request, holidaySet());
  if (effects.length === 0) return;
  const before = useEffectsStore.getState().effects;
  useEffectsStore.getState().upsertEffects(effects);
  await syncEffectsChange(before, useEffectsStore.getState().effects);
};

export const decideRequest = async (id: string, actor: Actor, decision: Decision, comment?: string) => {
  const request = portal().requests.find((r) => r.id === id);
  if (!request) throw new Error("الطلب غير موجود.");
  const { request: updated, outcome } = decide(request, actor, decision, comment?.trim() || undefined);
  portal().upsert("requests", updated);
  const label = REQUEST_TYPES[request.type].label;

  if (outcome === "approved") {
    await applyApproved(updated);
    notify(request.employeeCode, `تمت الموافقة على طلبك ${request.code}`, label, "/portal/requests");
  } else if (outcome === "rejected") {
    notify(request.employeeCode, `تم رفض طلبك ${request.code}`, comment || label, "/portal/requests");
  } else if (outcome === "returned") {
    notify(request.employeeCode, `أُعيد إليك الطلب ${request.code} لاستكمال معلوماته`, comment || label, "/portal/requests");
  } else {
    const next = currentStep(updated);
    if (next) notify(next.role === "manager" ? next.approverCode! : HR_INBOX, `طلب ${request.code} بانتظار موافقتك`, label, "/portal/team");
  }
  return { request: updated, outcome };
};

export const cancelRequest = (id: string, employeeCode: string) => {
  const request = portal().requests.find((r) => r.id === id);
  if (!request || normalizeEmployeeCode(request.employeeCode) !== normalizeEmployeeCode(employeeCode)) throw new Error("لا يمكنك إلغاء هذا الطلب.");
  if (request.status !== "pending" && request.status !== "returned") throw new Error("لا يمكن إلغاء طلب تم البت فيه.");
  portal().patch("requests", id, { status: "cancelled", updatedAt: new Date().toISOString() });
};

export const resubmitRequest = (id: string, patch: Partial<PortalRequest>) => {
  const request = portal().requests.find((r) => r.id === id);
  if (!request || request.status !== "returned") throw new Error("يمكن إعادة إرسال الطلبات المرجّعة فقط.");
  const updated = resubmit(request, { ...patch, chain: buildApprovalChain(employeeOf(request.employeeCode), att().employees) });
  portal().upsert("requests", updated);
  const first = updated.chain[0];
  notify(first.role === "manager" ? first.approverCode! : HR_INBOX, `طلب ${request.code} أُعيد إرساله`, REQUEST_TYPES[request.type].label, "/portal/team");
  return updated;
};

export const actorCanAct = canAct;

/** HR: turns overtime found in the punches into approval requests (nothing is paid automatically). */
export const runOvertimeDetection = (minHours = 0.5): number => {
  const candidates = detectOvertime(att().attendanceRecords, portal().requests, minHours);
  candidates.forEach((c) =>
    submitRequest({ employeeCode: c.employeeCode, type: "overtime", date: c.date, hours: c.hours, reason: "عمل إضافي مكتشف (بصمة)", source: "auto" })
  );
  return candidates.length;
};

// ================================================================== payroll
export const generatePayslips = (period: PayrollPeriod, options: { publish: boolean; employeeCodes?: string[] }) => {
  const p = portal();
  const only = options.employeeCodes?.map(normalizeEmployeeCode);
  let count = 0;
  p.salaryProfiles.forEach((salary) => {
    if (only && !only.includes(normalizeEmployeeCode(salary.employeeCode))) return;
    const base = computePayslip({
      salary, period, records: att().attendanceRecords, requests: p.requests, bonuses: p.bonuses,
      deductions: p.deductions, loans: p.loans, settings: p.settings,
    });
    const existing = p.payslips.find((x) => normalizeEmployeeCode(x.employeeCode) === normalizeEmployeeCode(salary.employeeCode) && x.periodKey === base.periodKey);
    portal().upsert("payslips", { ...base, id: existing?.id ?? newId(), status: options.publish ? "published" : "draft", createdAt: new Date().toISOString() });
    if (options.publish && existing?.status !== "published") notify(salary.employeeCode, `قسيمة راتب ${base.periodLabel}`, `الصافي: ${base.net.toLocaleString("ar-EG")}`, "/portal/payslips");
    count += 1;
  });
  if (options.publish) {
    // instalments of this payroll month are now paid
    const key = periodKeyOf(period);
    portal().loans.forEach((loan) => {
      if (loan.schedule.some((i) => i.periodKey === key && i.status === "due")) {
        const schedule = loan.schedule.map((i) => (i.periodKey === key ? { ...i, status: "paid" as const } : i));
        portal().patch("loans", loan.id, { schedule, status: schedule.every((i) => i.status === "paid") ? "closed" : loan.status });
      }
    });
  }
  return count;
};

export const currentPayrollPeriod = () => payrollPeriodContaining(new Date().toISOString().slice(0, 10), att().config.payrollMonthStartDay);

// ================================================================== loans, deductions
export const requestLoan = (employeeCode: string, amount: number, installments: number, reason?: string): Loan => {
  if (!(amount > 0) || !(installments >= 1)) throw new Error("المبلغ وعدد الأقساط مطلوبان.");
  const loan: Loan = { id: newId(), employeeCode, amount, installments: Math.trunc(installments), reason, status: "requested", schedule: [], createdAt: new Date().toISOString() };
  portal().upsert("loans", loan);
  notify(HR_INBOX, "طلب سلفة جديد", `${employeeOf(employeeCode)?.nameAr ?? employeeCode}: ${amount}`, "/hr/payroll");
  return loan;
};

export const decideLoan = (id: string, approve: boolean) => {
  const loan = portal().loans.find((l) => l.id === id);
  if (!loan || loan.status !== "requested") throw new Error("لا يمكن البت في هذه السلفة.");
  if (!approve) {
    portal().patch("loans", id, { status: "rejected" });
    notify(loan.employeeCode, "تم رفض طلب السلفة");
    return;
  }
  // instalments start with the NEXT payroll month
  const first = shiftPayrollPeriod(currentPayrollPeriod(), 1, att().config.payrollMonthStartDay);
  portal().patch("loans", id, { status: "approved", schedule: buildLoanSchedule(loan.amount, loan.installments, first) });
  notify(loan.employeeCode, "تمت الموافقة على السلفة", `${loan.installments} قسط يبدأ من ${first.label}`, "/portal/loans");
};

export const objectToDeduction = (id: string, objection: string) => {
  const item = portal().deductions.find((d) => d.id === id);
  if (!item || item.status !== "notified") throw new Error("لا يمكن الاعتراض على هذا الخصم.");
  if (!objection.trim()) throw new Error("اكتب سبب الاعتراض.");
  portal().patch("deductions", id, { status: "objected", objection: objection.trim() });
  notify(HR_INBOX, "اعتراض على خصم", `${employeeOf(item.employeeCode)?.nameAr ?? item.employeeCode}: ${objection.trim()}`, "/hr/payroll");
};

export const resolveDeduction = (id: string, outcome: Extract<DeductionStatus, "upheld" | "cancelled">, resolution: string) => {
  const item = portal().deductions.find((d) => d.id === id);
  if (!item || item.status !== "objected") throw new Error("لا يوجد اعتراض لحسمه.");
  portal().patch("deductions", id, { status: outcome, resolution });
  notify(item.employeeCode, outcome === "cancelled" ? "تم قبول اعتراضك وإلغاء الخصم" : "تم رفض اعتراضك على الخصم", resolution, "/portal/deductions");
};

export const addDeduction = (employeeCode: string, amount: number, reason: string, category: string, period: PayrollPeriod) => {
  portal().upsert("deductions", { id: newId(), employeeCode, amount, reason, category, periodKey: periodKeyOf(period), status: "notified", createdAt: new Date().toISOString() });
  notify(employeeCode, "تم تسجيل خصم عليك", `${category}: ${reason} (${amount}) - لك حق الاعتراض`, "/portal/deductions");
};

// ================================================================== custody / announcements
export const assignCustody = (employeeCode: string, name: string, serial?: string) => {
  portal().upsert("custody", { id: newId(), employeeCode, name, serial, status: "pending", assignedAt: new Date().toISOString() });
  notify(employeeCode, "عهدة جديدة بانتظار تأكيد استلامك", name, "/portal/custody");
};

export const publishAnnouncement = (title: string, body: string) => {
  portal().upsert("announcements", { id: newId(), title, body, createdAt: new Date().toISOString() });
  att().employees.forEach((e) => notify(e.code, `إعلان: ${title}`, undefined, "/portal/announcements"));
};

export { payrollPeriodOf };
