import { normalizeEffectTimeKey, normalizeEffectType as normalizeUnifiedEffectType } from "@shared/effect-normalization";
import { ADJUSTMENT_TYPES, type Adjustment, type AdjustmentType } from "@shared/schema";
import { ENGINE_CONFIG } from "./config";
import { secondsToHms, timeStringToSeconds } from "./time";

export type ImportedEffect = {
  employeeCode: string;
  date: string;
  from?: string;
  to?: string;
  fromTime?: string;
  toTime?: string;
  type: string;
  status?: string;
  note?: string;
};

const buildSyntheticAdjustment = (employeeCode: string, date: string, type: string, fromTime: string, toTime: string, note?: string): Adjustment => ({
  id: -1,
  employeeCode,
  date,
  type: type as AdjustmentType,
  fromTime,
  toTime,
  source: "effects_store",
  sourceFileName: null,
  importedAt: null,
  note: note || null,
});

const CANONICAL_ADJUSTMENT_TYPES = new Map<string, AdjustmentType>([
  ...ADJUSTMENT_TYPES.map((type) => [normalizeUnifiedEffectType(type), type] as [string, AdjustmentType]),
  ["اجازة نصف يوم", "إجازة نص يوم"],
]);

/** Maps any spelling (hamza / ta marbuta / "نصف") of an adjustment type to the canonical constant. */
export const canonicalAdjustmentType = (value: string): string =>
  CANONICAL_ADJUSTMENT_TYPES.get(normalizeUnifiedEffectType(value)) ?? value;

/** Effect types that are applied through leaves/holidays, not through the daily engine. */
const LEAVE_LIKE_EFFECT_TYPES = new Set(["اجازة رسمية", "اجازة تحصيل"]);

export const applyEffectsToDailyRecord = ({
  employeeCode,
  dateStr,
  dayAdjustments,
  dayEffects,
  shiftStart,
  shiftEnd,
  defaultPermissionMinutes = ENGINE_CONFIG.defaultPermissionMinutes,
  defaultHalfDayMinutes = ENGINE_CONFIG.defaultHalfDayMinutes,
  punchHint,
}: {
  employeeCode: string;
  dateStr: string;
  dayAdjustments: Adjustment[];
  dayEffects: ImportedEffect[];
  shiftStart: string;
  shiftEnd: string;
  defaultPermissionMinutes?: number;
  defaultHalfDayMinutes?: number;
  /** Seconds-of-day of the first/last punch; used to decide morning vs evening for a plain "إذن". */
  punchHint?: { firstSeconds: number | null; lastSeconds: number | null };
}) => {
  const mergedAdjustments = dayAdjustments.map((adj) => ({ ...adj, type: canonicalAdjustmentType(adj.type) as AdjustmentType }));
  const notes: string[] = [];
  const missionRanges: Array<{ from: string; to: string }> = [];
  const shiftStartSeconds = timeStringToSeconds(shiftStart);
  const shiftEndSeconds = timeStringToSeconds(shiftEnd);
  const permissionSeconds = Math.max(0, Number(defaultPermissionMinutes || ENGINE_CONFIG.defaultPermissionMinutes)) * 60;
  const halfDaySeconds = Math.max(0, Number(defaultHalfDayMinutes || ENGINE_CONFIG.defaultHalfDayMinutes)) * 60;

  dayEffects.forEach((effect) => {
    let type = normalizeUnifiedEffectType(effect.type);
    const from = normalizeEffectTimeKey(effect.fromTime || effect.from || "");
    const to = normalizeEffectTimeKey(effect.toTime || effect.to || "");

    if (LEAVE_LIKE_EFFECT_TYPES.has(type)) return; // handled as a Leave, nothing to do per-day

    // Plain "إذن" / "إذن عام": decide morning vs evening from the given times, else from the punches.
    if (type === "اذن" || type === "اذن عام") {
      const midpoint = (shiftStartSeconds + shiftEndSeconds) / 2;
      if (from) {
        type = timeStringToSeconds(from) < midpoint ? "اذن صباحي" : "اذن مسائي";
      } else if (punchHint?.firstSeconds != null && punchHint.firstSeconds > shiftStartSeconds + ENGINE_CONFIG.graceMinutes * 60) {
        type = "اذن صباحي";
      } else {
        type = "اذن مسائي";
      }
    }

    if (type === "مأمورية") {
      if (from && to) missionRanges.push({ from, to });
      else notes.push("مأمورية ناقص ساعات");
      return;
    }

    if (type === "اذن صباحي" || type === "اذن مسائي") {
      const fromResolved = from || (type === "اذن صباحي" ? secondsToHms(shiftStartSeconds) : secondsToHms(Math.max(0, shiftEndSeconds - permissionSeconds)));
      const toResolved = to || (type === "اذن صباحي" ? secondsToHms(shiftStartSeconds + permissionSeconds) : secondsToHms(shiftEndSeconds));
      mergedAdjustments.push(buildSyntheticAdjustment(employeeCode, dateStr, type, fromResolved, toResolved, effect.note));
      return;
    }

    if (type === "اجازة نصف يوم" || type === "اجازة نص يوم") {
      const fromResolved = from || secondsToHms(shiftStartSeconds);
      const toResolved = to || secondsToHms(shiftStartSeconds + halfDaySeconds);
      mergedAdjustments.push(buildSyntheticAdjustment(employeeCode, dateStr, "إجازة نص يوم", fromResolved, toResolved, effect.note));
      return;
    }

    const simple: Record<string, AdjustmentType> = {
      "اجازة بالخصم": "إجازة بالخصم",
      "غياب بعذر": "غياب بعذر",
      "اجازة من الرصيد": "إجازة من الرصيد",
      "اجازة بدل": "إجازة بدل",
    };
    if (simple[type]) {
      mergedAdjustments.push(buildSyntheticAdjustment(employeeCode, dateStr, simple[type], "00:00:00", "00:00:00", effect.note));
      return;
    }

    notes.push(`نوع مؤثر غير معروف: ${effect.type}`);
  });

  if (missionRanges.length > 0) {
    const missionStart = missionRanges.reduce((min, r) => timeStringToSeconds(r.from) < timeStringToSeconds(min) ? r.from : min, missionRanges[0].from);
    const missionEnd = missionRanges.reduce((max, r) => timeStringToSeconds(r.to) > timeStringToSeconds(max) ? r.to : max, missionRanges[0].to);
    if (missionRanges.length > 1) notes.push("تم دمج أكثر من مأمورية في أوسع نطاق");
    mergedAdjustments.push(buildSyntheticAdjustment(employeeCode, dateStr, "مأمورية", missionStart, missionEnd));
  }

  return { mergedAdjustments, notes };
};

