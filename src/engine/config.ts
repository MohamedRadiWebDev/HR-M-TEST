/**
 * All attendance business constants live here so they are reviewed/changed in ONE place.
 * (They used to be magic numbers scattered through the engine and the exporters.)
 */
export const ENGINE_CONFIG = {
  /** Shift start used when an employee has none (HH:mm). */
  defaultShiftStart: "09:00",
  /** Regular shift length in hours (shift end = shift start + this). */
  shiftDurationHours: 8,
  /** Day of week (0 = Sunday … 6 = Saturday) that has a short shift. */
  shortDayOfWeek: 6,
  /** Short day starts this many hours after the normal start… */
  shortDayStartShiftHours: 1,
  /** …and lasts this many hours (09:00 shift → 10:00–16:00). */
  shortDayDurationHours: 6,
  /** Minutes after shift start/end before late / early-leave penalties apply. */
  graceMinutes: 15,
  /** Late penalty tiers (late minutes → penalty days). First matching tier wins. */
  lateTiers: [
    { overMinutes: 60, penalty: 1 },
    { overMinutes: 30, penalty: 0.5 },
    { overMinutes: 0, penalty: 0.25 },
  ],
  earlyLeavePenalty: 0.5,
  missingStampPenalty: 0.5,
  /** Raw penalty recorded for an absent day. */
  absencePenalty: 1,
  /** Absence is weighted in totals / payroll exports (an absent day costs this many days). */
  absenceWeight: 2,
  /** Excused absence (غياب بعذر) costs no penalty days. Change to 1 to treat it as a deduction. */
  excusedAbsencePenalty: 0,
  /** Overtime only starts this long after shift end, and counts whole hours. */
  overtimeStartAfterShiftHours: 1,
  /** Defaults for permissions / half-day leave without explicit times. */
  defaultPermissionMinutes: 120,
  defaultHalfDayMinutes: 240,
  /** Punches inside this window on a Friday count as attending on the weekly day off. */
  fridayAttendanceWindow: { startHour: 11, endHour: 17 },
  /** Punches between 00:00 and this hour may belong to the previous working day. */
  overnightMaxHour: 5,
} as const;

export const PENALTY_TYPE = {
  late: "تأخير",
  earlyLeave: "انصراف مبكر",
  missingStamp: "سهو بصمة",
  absence: "غياب",
} as const;

export const latePenaltyForMinutes = (lateMinutes: number): number => {
  if (lateMinutes <= ENGINE_CONFIG.graceMinutes) return 0;
  const tier = ENGINE_CONFIG.lateTiers.find((t) => lateMinutes > t.overMinutes);
  return tier ? tier.penalty : 0;
};
