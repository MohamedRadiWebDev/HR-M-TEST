import { normalizeDateToIso } from "@shared/date-normalization";
import { normalizeShiftStart } from "@shared/time-normalization";
import { isoDayOfWeek } from "@shared/wallclock";
import type { Employee, SpecialRule } from "@shared/schema";
import { ENGINE_CONFIG } from "./config";
import { ruleAppliesToEmployee } from "./scope";
import { addSecondsToHm } from "./time";

export const resolveShiftForDate = ({
  employee,
  dateStr,
  rules,
}: {
  employee: Employee;
  dateStr: string;
  rules: SpecialRule[];
}) => {
  const activeRules = rules
    .filter((rule) => {
      // ISO dates compare correctly as strings – no Date allocations in the hot path.
      const start = normalizeDateToIso(rule.startDate) || rule.startDate;
      const end = normalizeDateToIso(rule.endDate) || rule.endDate;
      if (dateStr < start || dateStr > end) return false;
      return ruleAppliesToEmployee(rule, employee);
    })
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const dayOfWeek = isoDayOfWeek(dateStr);

  // The employee's own shift start (master data) is the baseline; the shift lasts N hours.
  let shiftStart = normalizeShiftStart(employee.shiftStart, ENGINE_CONFIG.defaultShiftStart);
  let shiftEnd = addSecondsToHm(shiftStart, ENGINE_CONFIG.shiftDurationHours * 3600);

  const shiftRule = activeRules.find((rule) => rule.ruleType === "custom_shift");
  if (shiftRule) {
    const params = (shiftRule.params ?? {}) as { shiftStart?: string; shiftEnd?: string };
    shiftStart = params.shiftStart || shiftStart;
    shiftEnd = params.shiftEnd || (params.shiftStart ? addSecondsToHm(params.shiftStart, ENGINE_CONFIG.shiftDurationHours * 3600) : shiftEnd);
  } else if (dayOfWeek === ENGINE_CONFIG.shortDayOfWeek) {
    // Short day (Saturday): starts one hour later and lasts `shortDayDurationHours`.
    shiftStart = addSecondsToHm(shiftStart, ENGINE_CONFIG.shortDayStartShiftHours * 3600);
    shiftEnd = addSecondsToHm(shiftStart, ENGINE_CONFIG.shortDayDurationHours * 3600);
  }

  return { activeRules, dayOfWeek, shiftStart, shiftEnd };
};

