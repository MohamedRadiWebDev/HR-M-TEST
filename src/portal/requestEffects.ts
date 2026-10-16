import { addDaysIso, isoDayOfWeek } from "@shared/wallclock";
import { REQUEST_TYPES, type PortalRequest } from "@shared/portal";
import type { Effect } from "@/store/effectsStore";

/** Working days of a leave request: Fridays and official holidays are not counted. */
export const leaveDates = (request: Pick<PortalRequest, "date" | "endDate">, holidays: ReadonlySet<string>): string[] => {
  const end = request.endDate && request.endDate >= request.date ? request.endDate : request.date;
  const out: string[] = [];
  for (let d = request.date; d <= end && out.length < 400; d = addDaysIso(d, 1)) {
    if (isoDayOfWeek(d) === 5 || holidays.has(d)) continue;
    out.push(d);
  }
  return out;
};

export const countLeaveDays = (request: Pick<PortalRequest, "date" | "endDate" | "type">, holidays: ReadonlySet<string>) =>
  REQUEST_TYPES[request.type].multiDay ? leaveDates(request, holidays).length : request.type === "half_day" ? 0.5 : 1;

/** What an approved request means for the attendance engine. */
export const requestToEffects = (
  request: PortalRequest,
  holidays: ReadonlySet<string>
): Omit<Effect, "id" | "createdAt" | "updatedAt">[] => {
  const meta = REQUEST_TYPES[request.type];
  if (!meta.effect) return [];
  const dates = meta.multiDay ? leaveDates(request, holidays) : [request.date];
  return dates.map((date) => ({
    employeeCode: request.employeeCode,
    date,
    type: meta.effect!,
    fromTime: meta.needsTimes ? request.fromTime : undefined,
    toTime: meta.needsTimes ? request.toTime : undefined,
    status: "معتمد",
    note: `طلب ${request.code}`,
    source: "manual" as const,
  }));
};
