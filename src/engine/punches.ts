import type { BiometricPunch } from "@shared/schema";
export const buildPunchConsumptionKey = (employeeCode: string, punchDatetime: Date) =>
  `${employeeCode}__${punchDatetime.getTime()}`;

export const filterConsumedPunches = <T extends { employeeCode: string; punchDatetime: Date }>(
  punches: T[],
  consumed: Set<string> | null | undefined
) => {
  if (!consumed || consumed.size === 0) return punches;
  return punches.filter((punch) => !consumed.has(buildPunchConsumptionKey(punch.employeeCode, punch.punchDatetime)));
};

