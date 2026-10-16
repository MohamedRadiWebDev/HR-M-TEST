import type { AttendanceRecord, Employee } from "@shared/schema";
import { parseTimeToSeconds } from "@/lib/datetime";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { normalizeDateToIso } from "@shared/date-normalization";
import { summarizePenalties } from "@/engine/penalties";
import { ENGINE_CONFIG } from "@/engine/config";

/** Arabic label for every status the engine can produce ("" = not applicable). */
export const STATUS_AR: Record<string, string> = {
  Present: "حضور",
  Late: "تأخير",
  Absent: "غياب",
  Excused: "بإذن",
  "Excused Absence": "غياب بعذر",
  "Official Holiday": "إجازة رسمية",
  Friday: "إجازة",
  "Friday Attended": "حضور",
  Leave: "إجازة",
  "Comp Day": "إجازة",
  "Leave Deduction": "خصم",
  "Joining Period": "",
  "Termination Period": "",
};
export const STATUS_AR_VALUES = Array.from(new Set(Object.values(STATUS_AR).filter(Boolean)));

const dayNames = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

export const DETAIL_HEADERS = [
  "التاريخ",
  "اليوم",
  "الكود",
  "اسم الموظف",
  "القسم",
  "تاريخ التعيين",
  "تاريخ ترك العمل",
  "فترة الالتحاق",
  "فترة الترك",
  "الدخول",
  "الخروج",
  "ساعات العمل",
  "الإضافي",
  "نوع اليوم",
  "الحالة",
  "تأخير",
  "انصراف مبكر",
  "سهو بصمة",
  "غياب",
  "إجمالي الجزاءات",
  "ملاحظات",
  "مدير الإدارة",
] as const;

export const SUMMARY_HEADERS = [
  "الكود",
  "اسم الموظف",
  "القسم",
  "تاريخ التعيين",
  "تاريخ ترك العمل",
  "فترة الالتحاق",
  "فترة الترك",
  "بدل يوم الجمع",
  "بدل أيام الإجازات الرسمية",
  "إجمالي أيام البدل",
  "إجمالي التأخيرات",
  "إجمالي الانصراف المبكر",
  "إجمالي سهو البصمة",
  "إجمالي الغياب",
  "إجمالي الجزاءات",
  "ملاحظات",
  "مدير الإدارة",
  "إجمالي الإضافي",
] as const;

const toExcelDateSerial = (value: string) => {
  const [yearRaw, monthRaw, dayRaw] = value.split("-").map(Number);
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || !Number.isFinite(dayRaw)) return "";
  return (Date.UTC(yearRaw, monthRaw - 1, dayRaw) - Date.UTC(1899, 11, 30)) / 86400000;
};

const normalizeDateText = (value: unknown): string => normalizeDateToIso(value);

const parseIsoDateToUtcMs = (value: string): number | null => {
  const [y, m, d] = value.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return Date.UTC(y, m - 1, d);
};

const arabicDayName = (isoDate: string) => {
  const ms = parseIsoDateToUtcMs(isoDate);
  if (ms === null) return "";
  return dayNames[new Date(ms).getUTCDay()] || "";
};

/** HH:mm:ss of a floating wall-clock Date (or of an HH:mm[:ss] / ISO text). */
const toTimeText = (value: unknown) => {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  if (value instanceof Date) {
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
  }
  const text = String(value);
  if (text.includes("T")) return text.split("T")[1].slice(0, 8);
  return text.slice(0, 8);
};

const cleanNotes = (value: string | null | undefined) => {
  const note = String(value || "").replace(/[\r\n]+/g, " ").trim();
  if (!note) return "";
  if (/^Shift\s+\d{1,2}:\d{2}-\d{1,2}:\d{2}/i.test(note)) return "";
  return note;
};

export const calculateOnboardingDays = (hireDate: string, reportStartDate: string, reportEndDate?: string): number => {
  if (!hireDate || !reportStartDate) return 0;
  const hireMs = parseIsoDateToUtcMs(hireDate);
  const startMs = parseIsoDateToUtcMs(reportStartDate);
  if (hireMs === null || startMs === null) return 0;
  if (hireMs <= startMs) return 0;
  const raw = Math.floor((hireMs - startMs) / 86400000);
  if (!reportEndDate) return Math.max(0, raw);
  const endMs = parseIsoDateToUtcMs(reportEndDate);
  if (endMs === null || endMs < startMs) return Math.max(0, raw);
  const rangeDays = Math.floor((endMs - startMs) / 86400000) + 1;
  return Math.max(0, Math.min(raw, rangeDays));
};

export const calculateTerminationPeriodDays = (terminationDate: string, reportEndDate: string): number => {
  if (!terminationDate || !reportEndDate) return 0;
  const terminationMs = parseIsoDateToUtcMs(terminationDate);
  const endMs = parseIsoDateToUtcMs(reportEndDate);
  if (terminationMs === null || endMs === null) return 0;
  if (terminationMs >= endMs) return 0;
  return Math.max(0, Math.floor((endMs - terminationMs) / 86400000));
};

export type AttendanceExportResult = {
  detailHeaders: string[];
  detailRows: any[][];
  summaryHeaders: string[];
  summaryRows: any[][];
};

const mapRowsByHeaders = (headers: readonly string[], rows: Record<string, any>[]) => [
  [...headers],
  ...rows.map((row) => headers.map((header) => row[header] ?? "")),
];

const buildEmployeeMeta = (employee?: Employee) => {
  const hireDate = normalizeDateText(employee?.hireDate);
  const terminationDate = normalizeDateText(employee?.terminationDate);
  return {
    name: String(employee?.nameAr || "").trim() || "(غير موجود بالماستر)",
    department: String(employee?.section || employee?.department || "").trim() || "غير مسجل",
    manager: String(employee?.deptManager || employee?.directManager || "").trim(),
    hireDate,
    terminationDate,
    hireDateSerial: hireDate ? toExcelDateSerial(hireDate) : "",
    terminationDateSerial: terminationDate ? toExcelDateSerial(terminationDate) : "",
  };
};

export const buildAttendanceExportRows = ({
  records,
  employees,
  reportStartDate,
  reportEndDate,
}: {
  records: AttendanceRecord[];
  employees: Employee[];
  reportStartDate?: string;
  reportEndDate?: string;
}): AttendanceExportResult => {
  const employeeMetaMap = new Map(employees.map((emp) => [normalizeEmployeeCode(emp.code), buildEmployeeMeta(emp)]));
  const effectiveReportStartDate = reportStartDate || (records.map((r) => String(r.date || "")).filter(Boolean).sort()[0] || "");
  const effectiveReportEndDate = reportEndDate || (records.map((r) => String(r.date || "")).filter(Boolean).sort().at(-1) || "");

  const detailObjects: Record<string, any>[] = [];
  const summaryByEmployee = new Map<string, {
    code: string;
    name: string;
    department: string;
    manager: string;
    hireDateSerial: string | number;
    terminationDateSerial: string | number;
    onboardingDays: number;
    terminationPeriodDays: number;
    compDaysFriday: number;
    compDaysOfficial: number;
    late: number;
    early: number;
    missing: number;
    absenceDays: number;
    overtimeHours: number;
    notes: string;
  }>();

  records.forEach((record) => {
    const normalizedCode = normalizeEmployeeCode(record.employeeCode);
    const employeeMeta = employeeMetaMap.get(normalizedCode) || buildEmployeeMeta();
    const onboardingDays = calculateOnboardingDays(employeeMeta.hireDate, effectiveReportStartDate, effectiveReportEndDate);
    const terminationPeriodDays = calculateTerminationPeriodDays(employeeMeta.terminationDate, effectiveReportEndDate);

    const penalties = Array.isArray(record.penalties) ? record.penalties : [];
    const isJoiningPeriod = record.status === "Joining Period";

    let dayType = "عمل";
    if (Number(record.terminationPeriodDays || 0) > 0 || record.status === "Termination Period") dayType = "فترة ترك";
    else if (isJoiningPeriod) dayType = "فترة التحاق";
    else if (record.leaveDeductionDays) dayType = "إجازة بالخصم";
    else if (record.excusedAbsenceDays) dayType = "غياب بعذر";
    else if (record.status === "Friday" || record.status === "Friday Attended") dayType = "جمعة";
    else if (record.isOfficialHoliday) dayType = "إجازة رسمية";
    else if (record.status === "Leave" || record.status === "Comp Day") dayType = "إجازة";

    const statusAr = STATUS_AR[record.status ?? ""] ?? "حضور";

    const totals = isJoiningPeriod
      ? { late: 0, early: 0, missing: 0, absenceDays: 0, weightedAbsence: 0, total: 0 }
      : summarizePenalties(penalties as { type?: string; value?: number }[], Number(record.excusedAbsenceDays || 0));
    const penaltiesByType = { late: totals.late, early: totals.early, missing: totals.missing, absence: totals.absenceDays };
    const totalPenalties = totals.total;

    detailObjects.push({
      "التاريخ": toExcelDateSerial(String(record.date || "")) || "",
      "اليوم": arabicDayName(String(record.date || "")),
      "الكود": record.employeeCode,
      "اسم الموظف": employeeMeta.name,
      "القسم": employeeMeta.department,
      "تاريخ التعيين": employeeMeta.hireDateSerial,
      "تاريخ ترك العمل": employeeMeta.terminationDateSerial,
      "فترة الالتحاق": onboardingDays,
      "فترة الترك": terminationPeriodDays,
      "الدخول": isJoiningPeriod ? "" : (record.checkIn ? parseTimeToSeconds(toTimeText(record.checkIn)) / 86400 : ""),
      "الخروج": isJoiningPeriod ? "" : (record.checkOut ? parseTimeToSeconds(toTimeText(record.checkOut)) / 86400 : ""),
      "ساعات العمل": isJoiningPeriod ? 0 : Number(record.totalHours || 0),
      "الإضافي": isJoiningPeriod ? 0 : Number(record.overtimeHours || 0),
      "نوع اليوم": dayType,
      "الحالة": statusAr,
      "تأخير": isJoiningPeriod ? 0 : penaltiesByType.late,
      "انصراف مبكر": isJoiningPeriod ? 0 : penaltiesByType.early,
      "سهو بصمة": isJoiningPeriod ? 0 : penaltiesByType.missing,
      "غياب": isJoiningPeriod ? 0 : penaltiesByType.absence,
      "إجمالي الجزاءات": totalPenalties,
      "ملاحظات": isJoiningPeriod ? "" : cleanNotes(record.notes),
      "مدير الإدارة": employeeMeta.manager,
    });

    const existing = summaryByEmployee.get(normalizedCode) || {
      code: record.employeeCode,
      name: employeeMeta.name,
      department: employeeMeta.department,
      manager: employeeMeta.manager,
      hireDateSerial: employeeMeta.hireDateSerial,
      terminationDateSerial: employeeMeta.terminationDateSerial,
      onboardingDays,
      terminationPeriodDays,
      compDaysFriday: 0,
      compDaysOfficial: 0,
      late: 0,
      early: 0,
      missing: 0,
      absenceDays: 0,
      overtimeHours: 0,
      notes: "",
    };

    if (!isJoiningPeriod) {
      existing.late += penaltiesByType.late;
      existing.early += penaltiesByType.early;
      existing.missing += penaltiesByType.missing;
      existing.overtimeHours += Number(record.overtimeHours || 0);
      existing.absenceDays += penaltiesByType.absence;
    }
    existing.compDaysFriday += Number(record.compDaysFriday || 0);
    existing.compDaysOfficial += Number(record.compDaysOfficial || 0);
    if (!existing.notes) existing.notes = cleanNotes(record.notes);

    summaryByEmployee.set(normalizedCode, existing);
  });

  const summaryObjects = Array.from(summaryByEmployee.values()).map((summary) => {
    const weightedAbsence = summary.absenceDays * ENGINE_CONFIG.absenceWeight;
    const totalPenalties = summary.late + summary.early + summary.missing + weightedAbsence;
    return {
      "الكود": summary.code,
      "اسم الموظف": summary.name,
      "القسم": summary.department,
      "تاريخ التعيين": summary.hireDateSerial,
      "تاريخ ترك العمل": summary.terminationDateSerial,
      "فترة الالتحاق": summary.onboardingDays,
      "فترة الترك": summary.terminationPeriodDays,
      "بدل يوم الجمع": summary.compDaysFriday,
      "بدل أيام الإجازات الرسمية": summary.compDaysOfficial,
      "إجمالي أيام البدل": summary.compDaysFriday + summary.compDaysOfficial,
      "إجمالي التأخيرات": summary.late,
      "إجمالي الانصراف المبكر": summary.early,
      "إجمالي سهو البصمة": summary.missing,
      "إجمالي الغياب": weightedAbsence,
      "إجمالي الجزاءات": totalPenalties,
      // Summary notes column is intended for manual notes by HR (do not auto-pull record notes).
      "ملاحظات": "",
      "مدير الإدارة": summary.manager,
      "إجمالي الإضافي": summary.overtimeHours,
    };
  });

  return {
    detailHeaders: [...DETAIL_HEADERS],
    detailRows: mapRowsByHeaders(DETAIL_HEADERS, detailObjects),
    summaryHeaders: [...SUMMARY_HEADERS],
    summaryRows: mapRowsByHeaders(SUMMARY_HEADERS, summaryObjects),
  };
};
