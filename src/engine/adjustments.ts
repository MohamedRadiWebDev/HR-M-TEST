import type { AdjustmentType } from "@shared/schema";
import { timeStringToSeconds } from "./time";

export type AdjustmentInput = {
  type: AdjustmentType;
  fromTime: string;
  toTime: string;
};

export const computeAdjustmentEffects = ({
  shiftStart,
  shiftEnd,
  adjustments,
  checkInSeconds,
  checkOutSeconds,
}: {
  shiftStart: string;
  shiftEnd: string;
  adjustments: AdjustmentInput[];
  checkInSeconds?: number | null;
  checkOutSeconds?: number | null;
}) => {
  const shiftStartSeconds = timeStringToSeconds(shiftStart);
  const shiftEndSeconds = timeStringToSeconds(shiftEnd);
  let effectiveShiftStartSeconds = shiftStartSeconds;
  let effectiveShiftEndSeconds = shiftEndSeconds;
  let missionStartSeconds: number | null = null;
  let missionEndSeconds: number | null = null;
  let suppressPenalties = false;
  let halfDayExcused = false;

  for (const adjustment of adjustments) {
    const fromSeconds = timeStringToSeconds(adjustment.fromTime);
    const toSeconds = timeStringToSeconds(adjustment.toTime);
    if (adjustment.type === "اذن صباحي") {
      effectiveShiftStartSeconds = Math.max(effectiveShiftStartSeconds, toSeconds);
    }
    if (adjustment.type === "اذن مسائي") {
      effectiveShiftEndSeconds = Math.min(effectiveShiftEndSeconds, fromSeconds);
    }
    if (adjustment.type === "إجازة نص يوم") {
      if (fromSeconds === shiftStartSeconds) {
        effectiveShiftStartSeconds = toSeconds;
        halfDayExcused = true;
      }
      if (toSeconds === shiftEndSeconds) {
        effectiveShiftEndSeconds = fromSeconds;
        halfDayExcused = true;
      }
    }
    if (adjustment.type === "مأمورية") {
      missionStartSeconds = missionStartSeconds === null ? fromSeconds : Math.min(missionStartSeconds, fromSeconds);
      missionEndSeconds = missionEndSeconds === null ? toSeconds : Math.max(missionEndSeconds, toSeconds);
      suppressPenalties = true;
    }
  }

  const allFirstCandidates = [checkInSeconds ?? null, missionStartSeconds].filter(
    (value): value is number => value !== null && value !== undefined
  );
  const allLastCandidates = [checkOutSeconds ?? null, missionEndSeconds].filter(
    (value): value is number => value !== null && value !== undefined
  );
  const firstStampSeconds = allFirstCandidates.length > 0 ? Math.min(...allFirstCandidates) : null;
  const lastStampSeconds = allLastCandidates.length > 0 ? Math.max(...allLastCandidates) : null;

  return {
    effectiveShiftStartSeconds,
    effectiveShiftEndSeconds,
    missionStartSeconds,
    missionEndSeconds,
    suppressPenalties,
    halfDayExcused,
    firstStampSeconds,
    lastStampSeconds,
  };
};

