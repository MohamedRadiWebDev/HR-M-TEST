import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearPersistedState, loadPersistedState, persistState, loadAutoBackup, type PersistedSnapshot } from "@/store/persistence";
import { parseWallIso } from "@shared/wallclock";

// minimal browser globals used by the persistence layer
const memory = new Map<string, string>();
(globalThis as any).window = new EventTarget();
(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};

const snapshot = (): PersistedSnapshot => ({
  schemaVersion: 2,
  savedAt: "x",
  state: {
    employees: [{ id: 1, code: "1", nameAr: "أحمد" } as never],
    rules: [], adjustments: [], leaves: [], officialHolidays: [],
    attendanceRecords: [{ id: 1, employeeCode: "1", date: "2026-03-02", checkIn: parseWallIso("2026-03-02T09:00:00"), checkOut: null } as never],
    config: { autoBackupEnabled: true, defaultPermissionMinutes: 120, defaultHalfDayMinutes: 240, defaultHalfDaySide: "صباح", payrollMonthStartDay: 24 },
    nextIds: { employee: 2, rule: 1, adjustment: 1, leave: 1, record: 2 },
  },
  punches: [{ id: 1, employeeCode: "1", punchDatetime: parseWallIso("2026-03-02T08:55:00")! }],
  effects: [],
});

describe("IndexedDB persistence", () => {
  beforeEach(async () => {
    memory.clear();
    await clearPersistedState();
  });

  it("returns 'none' for a fresh browser", async () => {
    expect((await loadPersistedState()).status).toBe("none");
  });

  it("saves and loads everything – PUNCHES included (they used to be lost on refresh)", async () => {
    await persistState(snapshot());
    const loaded = await loadPersistedState();
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.snapshot.punches).toHaveLength(1);
    expect(loaded.snapshot.punches[0].punchDatetime.toISOString()).toBe("2026-03-02T08:55:00.000Z");
    expect(loaded.snapshot.state.attendanceRecords[0].checkIn).toBeInstanceOf(Date);
    expect(loaded.snapshot.state.employees[0].nameAr).toBe("أحمد");
  });

  it("keeps an automatic backup when asked to", async () => {
    await persistState(snapshot(), { autoBackup: true });
    const backup = await loadAutoBackup();
    expect(backup?.snapshot.punches).toHaveLength(1);
  });

  it("migrates the legacy localStorage format (old instants → Cairo wall-clock, effects kept)", async () => {
    memory.set("hr_attendance_state_v1", JSON.stringify({
      schemaVersion: 1,
      savedAt: "2026-01-01T00:00:00Z",
      state: {
        employees: [{ id: 1, code: "7", nameAr: "قديم" }], rules: [], adjustments: [], leaves: [], officialHolidays: [],
        attendanceRecords: [{ id: 1, employeeCode: "7", date: "2025-12-10", checkIn: "2025-12-10T07:00:00.000Z", checkOut: null }],
        config: {}, nextIds: { employee: 2, rule: 1, adjustment: 1, leave: 1, record: 2 },
      },
    }));
    memory.set("hr_effects_v2", JSON.stringify([{ id: "e1", employeeCode: "7", date: "2025-12-10", type: "مأمورية", fromTime: "10:00:00", toTime: "11:00:00", source: "manual", createdAt: "x", updatedAt: "x" }]));

    const loaded = await loadPersistedState();
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.migratedFromLegacy).toBe(true);
    expect(loaded.snapshot.state.attendanceRecords[0].checkIn?.toISOString()).toBe("2025-12-10T09:00:00.000Z");
    expect(loaded.snapshot.effects).toHaveLength(1);
  });

  it("flags data from a newer app version as incompatible instead of overwriting it", async () => {
    await persistState(snapshot());
    // simulate a future version by bumping the stored schemaVersion
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("hr_attendance_v2", 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put({ schemaVersion: 99, savedAt: "x" }, "meta");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
    expect((await loadPersistedState()).status).toBe("incompatible");
  });
});
