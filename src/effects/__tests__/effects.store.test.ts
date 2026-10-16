import { beforeEach, describe, expect, it } from "vitest";
import { useEffectsStore } from "@/store/effectsStore";
import { useEffectsHistoryStore } from "@/store/effectsHistoryStore";

const row = (employeeCode: string, date: string, type = "مأمورية", fromTime = "10:00", toTime = "12:00") => ({
  employeeCode, date, type, fromTime, toTime, source: "manual" as const,
});

describe("effects store + history", () => {
  beforeEach(() => {
    useEffectsStore.getState().replaceEffects([]);
    useEffectsHistoryStore.getState().clear();
  });

  it("upserts without duplicating the same effect", () => {
    const s = useEffectsStore.getState();
    expect(s.upsertEffects([row("1", "2026-03-02")])).toMatchObject({ inserted: 1, updated: 0 });
    expect(useEffectsStore.getState().upsertEffects([row("1", "2026-03-02")])).toMatchObject({ inserted: 0, updated: 1 });
    expect(useEffectsStore.getState().effects).toHaveLength(1);
  });

  it("undo and redo walk through history in both directions", () => {
    const store = () => useEffectsStore.getState();
    const history = () => useEffectsHistoryStore.getState();
    store().upsertEffects([row("1", "2026-03-02")]); // A
    store().upsertEffects([row("2", "2026-03-03")]); // B
    expect(store().effects).toHaveLength(2);

    const undo1 = history().undo();
    expect(store().effects).toHaveLength(1);
    expect(undo1?.before).toHaveLength(2);
    expect(history().canRedo()).toBe(true); // used to be wiped by undo

    history().undo();
    expect(store().effects).toHaveLength(0); // the FIRST change is undoable too
    expect(history().canUndo()).toBe(false);

    history().redo();
    history().redo();
    expect(store().effects).toHaveLength(2);
    expect(history().canRedo()).toBe(false);
  });

  it("a new change after undo clears the redo stack", () => {
    const store = () => useEffectsStore.getState();
    store().upsertEffects([row("1", "2026-03-02")]);
    useEffectsHistoryStore.getState().undo();
    store().upsertEffects([row("9", "2026-03-09")]);
    expect(useEffectsHistoryStore.getState().canRedo()).toBe(false);
  });

  it("renames the employee code on every effect", () => {
    useEffectsStore.getState().upsertEffects([row("1", "2026-03-02")]);
    useEffectsStore.getState().renameEmployeeCode("1", "77");
    expect(useEffectsStore.getState().effects[0].employeeCode).toBe("77");
  });
});
