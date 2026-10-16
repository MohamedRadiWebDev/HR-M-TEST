import { diffEffects, purgeLegacyEffectAdjustments, rebuildEffectLeaves } from "@/effects/applyEffects";
import { useAttendanceStore, type ProcessResult } from "@/store/attendanceStore";
import type { Effect } from "@/store/effectsStore";

/**
 * Call after ANY change to the effects list (import, edit, delete, undo, redo, quick-add).
 * Rebuilds effect-generated leaves and recomputes attendance for exactly the employees/days that
 * changed – including the ones that were just removed.
 */
export const syncEffectsChange = async (before: Effect[], after: Effect[]): Promise<ProcessResult | null> => {
  const store = useAttendanceStore.getState();

  const nextLeaves = rebuildEffectLeaves(after, store.leaves);
  if (JSON.stringify(nextLeaves) !== JSON.stringify(store.leaves)) store.setLeaves(nextLeaves);

  const cleaned = purgeLegacyEffectAdjustments(store.adjustments);
  if (cleaned.length !== store.adjustments.length) store.setAdjustments(cleaned);

  const diff = diffEffects(before, after);
  if (!diff.changed || diff.dates.length === 0) return null;

  return store.processAttendance({
    startDate: diff.dates[0],
    endDate: diff.dates[diff.dates.length - 1],
    employeeCodes: diff.employeeCodes,
  });
};
