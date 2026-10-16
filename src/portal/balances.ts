import { normalizeEmployeeCode } from "@shared/employee-code";
import type { PortalRequest, PortalSettings } from "@shared/portal";
import { countLeaveDays } from "./requestEffects";

export type LeaveBalance = { quota: number; used: number; pending: number; remaining: number };

/** Annual-leave balance for a calendar year: quota − approved days (pending days shown separately). */
export const leaveBalance = (params: {
  employeeCode: string;
  year: number;
  requests: PortalRequest[];
  settings: PortalSettings;
  holidays: ReadonlySet<string>;
}): LeaveBalance => {
  const code = normalizeEmployeeCode(params.employeeCode);
  const quota = params.settings.leaveQuotaOverrides[code] ?? params.settings.annualLeaveDays;
  let used = 0;
  let pending = 0;
  params.requests.forEach((r) => {
    if (r.type !== "leave_annual" || normalizeEmployeeCode(r.employeeCode) !== code || !r.date.startsWith(String(params.year))) return;
    const days = countLeaveDays(r, params.holidays);
    if (r.status === "approved") used += days;
    else if (r.status === "pending" || r.status === "returned") pending += days;
  });
  return { quota, used, pending, remaining: quota - used };
};
