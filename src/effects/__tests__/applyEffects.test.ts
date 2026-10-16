import { describe, expect, it } from "vitest";
import { diffEffects, purgeLegacyEffectAdjustments, rebuildEffectLeaves } from "@/effects/applyEffects";
import type { Effect } from "@/store/effectsStore";
import type { Adjustment, Leave } from "@shared/schema";

const fx = (id: string, type: string, date = "2026-03-02", code = "1"): Effect =>
  ({ id, employeeCode: code, date, type, fromTime: "", toTime: "", source: "manual", createdAt: "x", updatedAt: "x" }) as Effect;

describe("effect → leave sync", () => {
  it("creates leaves for official/collections effects and removes them when the effect is gone", () => {
    const withEffect = rebuildEffectLeaves([fx("a", "إجازة رسمية")], []);
    expect(withEffect).toHaveLength(1);
    expect(withEffect[0]).toMatchObject({ type: "official", scope: "emp", scopeValue: "1", source: "effects" });

    const afterDelete = rebuildEffectLeaves([], withEffect);
    expect(afterDelete).toHaveLength(0); // no ghost
  });

  it("never touches manual leaves", () => {
    const manual = { id: 1, type: "annual", scope: "all", scopeValue: null, startDate: "2026-03-01", endDate: "2026-03-02", note: "", createdAt: null, source: null } as Leave;
    expect(rebuildEffectLeaves([fx("a", "إجازة تحصيل")], [manual])).toHaveLength(2);
    expect(rebuildEffectLeaves([], [manual])).toEqual([manual]);
  });

  it("purges adjustments copied by older versions", () => {
    const legacy = { id: 1, source: "effects_import" } as Adjustment;
    const manual = { id: 2, source: "manual" } as Adjustment;
    expect(purgeLegacyEffectAdjustments([legacy, manual])).toEqual([manual]);
  });
});

describe("diffEffects", () => {
  it("includes removed effects (their day must be recomputed)", () => {
    const before = [fx("a", "مأمورية", "2026-03-02"), fx("b", "مأمورية", "2026-03-05", "2")];
    const after = [fx("b", "مأمورية", "2026-03-05", "2")];
    expect(diffEffects(before, after)).toMatchObject({ changed: true, dates: ["2026-03-02"], employeeCodes: ["1"] });
  });
  it("reports no change for identical lists and catches edits", () => {
    const list = [fx("a", "مأمورية")];
    expect(diffEffects(list, list).changed).toBe(false);
    expect(diffEffects(list, [{ ...list[0], toTime: "13:00" }]).changed).toBe(true);
  });
});
