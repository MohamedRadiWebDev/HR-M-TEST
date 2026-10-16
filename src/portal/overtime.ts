import { normalizeEmployeeCode } from "@shared/employee-code";
import type { AttendanceRecord } from "@shared/schema";
import type { PortalRequest } from "@shared/portal";

export type OvertimeCandidate = { employeeCode: string; date: string; hours: number };

/**
 * Overtime detected from the punches becomes an APPROVAL REQUEST (it is not paid automatically).
 * Days that already have an overtime request (any status except cancelled) are skipped.
 */
export const detectOvertime = (records: AttendanceRecord[], requests: PortalRequest[], minHours = 0.5): OvertimeCandidate[] => {
  const have = new Set(
    requests
      .filter((r) => r.type === "overtime" && r.status !== "cancelled")
      .map((r) => `${normalizeEmployeeCode(r.employeeCode)}|${r.date}`)
  );
  return records
    .filter((r) => (r.overtimeHours ?? 0) >= minHours && !have.has(`${normalizeEmployeeCode(r.employeeCode)}|${r.date}`))
    .map((r) => ({ employeeCode: r.employeeCode, date: r.date, hours: Number((r.overtimeHours ?? 0).toFixed(2)) }));
};
