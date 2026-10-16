import type { Adjustment, Leave } from "@shared/schema";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { normalizeEffectType } from "@shared/effect-normalization";
import type { Effect } from "@/store/effectsStore";

/** Marks leaves generated from effects so they can be rebuilt/removed together with their effects. */
export const EFFECT_LEAVE_SOURCE = "effects";
/** Older versions copied every effect into `adjustments`; those copies are purged on sync. */
const LEGACY_EFFECT_ADJUSTMENT_SOURCE = "effects_import";

/**
 * How effects reach attendance:
 *  - Daily effects (إذن، مأمورية، نص يوم، غياب بعذر، …) are read DIRECTLY by the engine from the
 *    effects store, so nothing is copied into `adjustments` any more (that copy used to outlive the
 *    effect after it was deleted or edited).
 *  - "إجازة رسمية" / "إجازة تحصيل" effects become Leaves tagged `source = "effects"`. They are fully
 *    regenerated from the current effects on every sync, so deleting an effect removes its leave.
 */
export const rebuildEffectLeaves = (effects: Effect[], leaves: Leave[]): Leave[] => {
  const manual = leaves.filter((leave) => leave.source !== EFFECT_LEAVE_SOURCE);
  const known = new Set(manual.map((l) => `${l.type}|${l.scope}|${l.scopeValue ?? ""}|${l.startDate}|${l.endDate}`));
  let nextId = leaves.reduce((max, l) => Math.max(max, l.id || 0), 0) + 1;
  const generated: Leave[] = [];

  effects.forEach((effect) => {
    const code = normalizeEmployeeCode(effect.employeeCode);
    if (!code || !effect.date) return;
    const type = normalizeEffectType(effect.type);
    if (type !== "اجازة رسمية" && type !== "اجازة تحصيل") return;

    const leaveType = type === "اجازة رسمية" ? "official" : "collections";
    const key = `${leaveType}|emp|${code}|${effect.date}|${effect.date}`;
    if (known.has(key)) return;
    known.add(key);
    generated.push({
      id: nextId++,
      type: leaveType,
      scope: "emp",
      scopeValue: code,
      startDate: effect.date,
      endDate: effect.date,
      note: effect.note || "",
      createdAt: new Date(),
      source: EFFECT_LEAVE_SOURCE,
    });
  });

  return manual.concat(generated);
};

export const purgeLegacyEffectAdjustments = (adjustments: Adjustment[]): Adjustment[] =>
  adjustments.filter((adj) => adj.source !== LEGACY_EFFECT_ADJUSTMENT_SOURCE);

const signature = (e: Effect) =>
  [normalizeEmployeeCode(e.employeeCode), e.date, e.type, e.fromTime ?? "", e.toTime ?? "", e.status ?? "", e.note ?? ""].join("|");

/** Employees + dates touched by the difference between two effect lists (both sides, so removals count). */
export const diffEffects = (before: Effect[], after: Effect[]) => {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterById = new Map(after.map((e) => [e.id, e]));
  const touched: Effect[] = [];

  before.forEach((e) => {
    const other = afterById.get(e.id);
    if (!other || signature(other) !== signature(e)) touched.push(e);
  });
  after.forEach((e) => {
    const other = beforeById.get(e.id);
    if (!other || signature(other) !== signature(e)) touched.push(e);
  });

  const dates = Array.from(new Set(touched.map((e) => e.date).filter(Boolean))).sort();
  const employeeCodes = Array.from(new Set(touched.map((e) => normalizeEmployeeCode(e.employeeCode)).filter(Boolean)));
  return { dates, employeeCodes, changed: touched.length > 0 };
};
