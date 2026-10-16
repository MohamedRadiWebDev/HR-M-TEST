import { normalizeEmployeeCode } from "@shared/employee-code";
import { PENALTY_TYPE } from "@/engine/config";
import type { AttendanceRecord, BiometricPunch } from "@shared/schema";
import { wallDateKey } from "@shared/wallclock";
import { addDaysIso } from "@shared/wallclock";

type PenaltyLike = { type?: string; value?: number };
const penaltiesOf = (record: Pick<AttendanceRecord, "penalties">): PenaltyLike[] =>
  Array.isArray(record.penalties) ? (record.penalties as PenaltyLike[]) : [];

export type RecordFlags = {
  absent: boolean;
  late: boolean;
  earlyLeave: boolean;
  missingStamp: boolean;
  comp: boolean;
  hasPenalty: boolean;
};

/** Single source of truth for "what is wrong with this day" (row colours + the exceptions filter). */
export const classifyRecord = (record: AttendanceRecord): RecordFlags => {
  const types = penaltiesOf(record).map((p) => String(p.type ?? ""));
  return {
    absent: record.status === "Absent" || types.includes(PENALTY_TYPE.absence),
    late: record.status === "Late" || types.includes(PENALTY_TYPE.late),
    earlyLeave: types.includes(PENALTY_TYPE.earlyLeave),
    missingStamp: types.includes(PENALTY_TYPE.missingStamp),
    comp: Number(record.compDayCredit || 0) > 0 || record.status === "Comp Day",
    hasPenalty: types.length > 0,
  };
};

export function buildRecordToneClass(record: AttendanceRecord) {
  const f = classifyRecord(record);
  if (f.absent) return "bg-red-50/60 hover:bg-red-50 dark:bg-red-950/30 dark:hover:bg-red-950/40";
  if (f.missingStamp) return "bg-orange-50/60 hover:bg-orange-50 dark:bg-orange-950/25 dark:hover:bg-orange-950/35";
  if (f.late || f.earlyLeave) return "bg-yellow-50/60 hover:bg-yellow-50 dark:bg-yellow-950/25 dark:hover:bg-yellow-950/35";
  if (f.comp) return "bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-950/25 dark:hover:bg-emerald-950/35";
  return "hover:bg-background dark:hover:bg-muted/40";
}

/** Punches that belong to the working day `dateStr` (overnight days also include the next-morning exit). */
export function getPunchesForAttendanceWindow(
  punches: Array<Pick<BiometricPunch, "employeeCode" | "punchDatetime">>,
  employeeCode: string,
  dateStr: string,
  isOvernight: boolean
) {
  const code = normalizeEmployeeCode(employeeCode);
  const nextDay = addDaysIso(dateStr, 1);
  return punches
    .filter((punch) => {
      if (normalizeEmployeeCode(punch.employeeCode) !== code) return false;
      const key = wallDateKey(punch.punchDatetime);
      if (key === dateStr) return true;
      return isOvernight && key === nextDay && punch.punchDatetime.getUTCHours() < 6;
    })
    .sort((a, b) => a.punchDatetime.getTime() - b.punchDatetime.getTime());
}

export function filterAttendanceRecords(
  records: AttendanceRecord[],
  startDate?: string,
  endDate?: string,
  employeeCode?: string
) {
  const codes = employeeCode
    ? new Set(employeeCode.split(",").map((code) => normalizeEmployeeCode(code)).filter(Boolean))
    : null;

  return records.filter((record) => {
    if (startDate && record.date < startDate) return false;
    if (endDate && record.date > endDate) return false;
    if (codes && codes.size > 0 && !codes.has(normalizeEmployeeCode(record.employeeCode))) return false;
    return true;
  });
}

export const dayKey = (employeeCode: string, date: string) => `${normalizeEmployeeCode(employeeCode)}__${date}`;

/** Whether the person worked on an official holiday (manual override wins over the automatic guess). */
export const getWorkedOnHoliday = (record: AttendanceRecord) => {
  if (!record.isOfficialHoliday) return false;
  if (record.workedOnOfficialHoliday !== null && record.workedOnOfficialHoliday !== undefined) {
    return Boolean(record.workedOnOfficialHoliday);
  }
  return (
    Boolean(record.checkIn || record.checkOut) ||
    (typeof record.totalHours === "number" && record.totalHours > 0) ||
    Boolean(record.missionStart && record.missionEnd)
  );
};

/** Human-readable reasons shown in the "why this status" tooltip. */
export const explainReasons = (record: AttendanceRecord, matchedEffects: number) => {
  const reasons: string[] = [];
  if (record.status === "Joining Period") reasons.push("قبل تاريخ التعيين (فترة الالتحاق)");
  if (record.status === "Termination Period" || Number(record.terminationPeriodDays || 0) > 0) reasons.push("بعد تاريخ ترك العمل (فترة الترك)");
  if (record.status === "Friday" || record.status === "Friday Attended") reasons.push("يوم جمعة");
  if (record.isOfficialHoliday) reasons.push("إجازة رسمية");
  if (Number(record.compDayCredit || 0) > 0) reasons.push("محتسب كبدل / Comp Day");
  penaltiesOf(record).forEach((p) => {
    const t = String(p.type || "").trim();
    if (t) reasons.push(`جزاء: ${t}${p.value !== undefined ? ` (${p.value})` : ""}`);
  });
  if (matchedEffects) reasons.push(`مؤثرات مطبّقة: ${matchedEffects}`);
  if (reasons.length === 0) reasons.push("لا يوجد أسباب إضافية");
  return reasons;
};
