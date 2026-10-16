import { normalizeEmployeeCode } from "@shared/employee-code";
import type { AttendanceRecord } from "@shared/schema";
import type { PayrollPeriod } from "@shared/payroll-period";
import type { Bonus, DeductionItem, Loan, LoanInstallment, Payslip, PayslipLine, PortalRequest, PortalSettings, SalaryProfile } from "@shared/portal";
import { summarizePenalties } from "@/engine/penalties";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad2 = (n: number) => String(n).padStart(2, "0");

export const periodKeyOf = (period: Pick<PayrollPeriod, "year" | "month">) => `${period.year}-${pad2(period.month)}`;

export const grossOf = (s: SalaryProfile) => r2(s.basic + s.housing + s.transport + s.phone + s.nature + s.other + s.pressure);

export const buildLoanSchedule = (amount: number, installments: number, firstPeriod: Pick<PayrollPeriod, "year" | "month">): LoanInstallment[] => {
  const count = Math.max(1, Math.trunc(installments));
  const base = r2(amount / count);
  return Array.from({ length: count }, (_, i) => {
    const index = firstPeriod.year * 12 + (firstPeriod.month - 1) + i;
    const isLast = i === count - 1;
    return {
      n: i + 1,
      periodKey: `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`,
      amount: isLast ? r2(amount - base * (count - 1)) : base,
      status: "due" as const,
    };
  });
};

export type PayslipInput = {
  salary: SalaryProfile;
  period: PayrollPeriod;
  records: AttendanceRecord[];
  requests: PortalRequest[];
  bonuses: Bonus[];
  deductions: DeductionItem[];
  loans: Loan[];
  settings: PortalSettings;
};

/**
 * Basic payroll maths (for review by HR/finance before use – it does NOT include taxes or social insurance):
 *   daily rate = gross / payrollDaysBase;  hourly = daily / 8
 *   deductions = (penalty days + unpaid-leave days) × daily rate, items in status "notified"/"upheld", loan instalments of the period
 *   additions  = approved overtime hours × hourly × multiplier, bonuses of the period
 */
export const computePayslip = (input: PayslipInput): Omit<Payslip, "id" | "status" | "createdAt"> => {
  const { salary, period, settings } = input;
  const code = normalizeEmployeeCode(salary.employeeCode);
  const key = periodKeyOf(period);
  const gross = grossOf(salary);
  const daily = gross / settings.payrollDaysBase;
  const hourly = daily / 8;

  const mine = input.records.filter((r) => normalizeEmployeeCode(r.employeeCode) === code && r.date >= period.start && r.date <= period.end);
  let penaltyDays = 0;
  let unpaidLeaveDays = 0;
  mine.forEach((r) => {
    penaltyDays += summarizePenalties(r.penalties, Number(r.excusedAbsenceDays || 0)).total;
    if (!r.terminationPeriodDays && r.status !== "Joining Period") unpaidLeaveDays += Number(r.leaveDeductionDays || 0);
  });
  const attendanceDays = penaltyDays + unpaidLeaveDays;

  const earnings: PayslipLine[] = [
    { label: "الراتب الأساسي", amount: salary.basic },
    { label: "بدل السكن", amount: salary.housing },
    { label: "بدل النقل", amount: salary.transport },
    { label: "بدل الهاتف", amount: salary.phone },
    { label: "بدل طبيعة العمل", amount: salary.nature },
    { label: "بدلات أخرى", amount: salary.other },
    { label: "بدل ضغط العمل", amount: salary.pressure },
  ].filter((l) => l.amount > 0);

  const overtimeHours = input.requests
    .filter((r) => r.type === "overtime" && r.status === "approved" && normalizeEmployeeCode(r.employeeCode) === code && r.date >= period.start && r.date <= period.end)
    .reduce((sum, r) => sum + (r.hours ?? 0), 0);
  if (overtimeHours > 0) earnings.push({ label: `عمل إضافي (${r2(overtimeHours)} ساعة)`, amount: r2(overtimeHours * hourly * settings.overtimeMultiplier) });
  input.bonuses
    .filter((b) => normalizeEmployeeCode(b.employeeCode) === code && b.periodKey === key)
    .forEach((b) => earnings.push({ label: `مكافأة: ${b.reason}`, amount: r2(b.amount) }));

  const deductions: PayslipLine[] = [];
  if (attendanceDays > 0) deductions.push({ label: `خصم الحضور (${r2(attendanceDays)} يوم)`, amount: Math.min(gross, r2(attendanceDays * daily)) });
  input.deductions
    .filter((d) => normalizeEmployeeCode(d.employeeCode) === code && d.periodKey === key && (d.status === "notified" || d.status === "upheld"))
    .forEach((d) => deductions.push({ label: `${d.category}: ${d.reason}`, amount: r2(d.amount) }));
  input.loans
    .filter((l) => normalizeEmployeeCode(l.employeeCode) === code && l.status === "approved")
    .forEach((l) =>
      l.schedule.filter((i) => i.periodKey === key).forEach((i) => deductions.push({ label: `قسط سلفة (${i.n}/${l.schedule.length})`, amount: i.amount }))
    );

  const totalEarnings = r2(earnings.reduce((s, l) => s + l.amount, 0));
  const totalDeductions = r2(deductions.reduce((s, l) => s + l.amount, 0));
  return {
    employeeCode: salary.employeeCode,
    periodKey: key,
    periodLabel: period.label,
    start: period.start,
    end: period.end,
    gross,
    earnings,
    deductions,
    net: r2(totalEarnings - totalDeductions),
    attendanceDays: r2(attendanceDays),
  };
};
