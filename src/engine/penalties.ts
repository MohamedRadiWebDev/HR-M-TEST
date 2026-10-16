import { ENGINE_CONFIG, PENALTY_TYPE } from "./config";

export const computePenaltyEntries = ({
  isExcused,
  latePenaltyValue,
  lateMinutes,
  missingCheckout,
  missingCheckin = false,
  earlyLeaveTriggered,
}: {
  isExcused: boolean;
  latePenaltyValue: number;
  lateMinutes: number;
  missingCheckout: boolean;
  missingCheckin?: boolean;
  earlyLeaveTriggered: boolean;
}) => {
  if (isExcused) return [] as { type: string; value: number; minutes?: number }[];
  const entries: { type: string; value: number; minutes?: number }[] = [];
  if (latePenaltyValue > 0) {
    entries.push({ type: PENALTY_TYPE.late, value: latePenaltyValue, minutes: lateMinutes });
  }
  if (missingCheckout || missingCheckin) {
    entries.push({ type: PENALTY_TYPE.missingStamp, value: ENGINE_CONFIG.missingStampPenalty });
  } else if (earlyLeaveTriggered) {
    entries.push({ type: PENALTY_TYPE.earlyLeave, value: ENGINE_CONFIG.earlyLeavePenalty });
  }
  return entries;
};


export type PenaltyTotals = {
  late: number;
  early: number;
  missing: number;
  /** Absent days (raw, 1 per day). */
  absenceDays: number;
  /** Absence as charged: days × `absenceWeight`. */
  weightedAbsence: number;
  /** late + early + missing + weightedAbsence (+ excused-absence charge, 0 by default). */
  total: number;
};

/**
 * THE one place that turns penalty entries into totals. The detail sheet, the summary sheet, the
 * dashboard and the employee profile must all use it so their numbers can never disagree.
 */
export const summarizePenalties = (
  penalties: ReadonlyArray<{ type?: string; value?: number }> | null | undefined,
  excusedAbsenceDays = 0
): PenaltyTotals => {
  const totals = { late: 0, early: 0, missing: 0, absenceDays: 0 };
  (penalties ?? []).forEach((penalty) => {
    const value = Number(penalty.value || 0);
    if (penalty.type === PENALTY_TYPE.late) totals.late += value;
    else if (penalty.type === PENALTY_TYPE.earlyLeave) totals.early += value;
    else if (penalty.type === PENALTY_TYPE.missingStamp) totals.missing += value;
    else if (penalty.type === PENALTY_TYPE.absence) totals.absenceDays += value;
  });
  const weightedAbsence = totals.absenceDays * ENGINE_CONFIG.absenceWeight;
  return {
    ...totals,
    weightedAbsence,
    total:
      totals.late +
      totals.early +
      totals.missing +
      weightedAbsence +
      excusedAbsenceDays * ENGINE_CONFIG.excusedAbsencePenalty,
  };
};
