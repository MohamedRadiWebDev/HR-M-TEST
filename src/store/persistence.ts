/**
 * Persistence layer – IndexedDB (no 5 MB localStorage limit, async, structured-clone friendly).
 *
 * Stored keys (object store "kv"):
 *   meta        { schemaVersion, savedAt }
 *   state       employees / rules / leaves / adjustments / holidays / records / config / nextIds
 *   punches     compact rows  [id, employeeCode, "YYYY-MM-DDTHH:mm:ss"]
 *   effects     Effect[]
 *   autoBackup  { createdAt, snapshot }           (only when auto-backup is enabled)
 *
 * Old versions kept everything in localStorage; that data is migrated automatically on first load.
 */
import type { AttendanceRecord, BiometricPunch } from "@shared/schema";
import { formatWallIso, instantToCairoWall, parseWallIso } from "@shared/wallclock";
import { clearLegacyEffects, readLegacyEffects, type Effect } from "@/store/effectsStore";
import type { AttendanceState } from "@/store/attendanceStore";

export const STORAGE_SCHEMA_VERSION = 2;
export const PERSISTENCE_ERROR_EVENT = "hr:persistence-error";
export const PERSISTENCE_SAVED_EVENT = "hr:persistence-saved";

const DB_NAME = "hr_attendance_v2";
const DB_VERSION = 1;
const STORE = "kv";

const LEGACY_STATE_KEY = "hr_attendance_state_v1";
const LEGACY_KEYS = [
  LEGACY_STATE_KEY,
  "hr_attendance_punches_v1",
  "hr_attendance_last_saved_at",
  "hr_attendance_auto_backup",
];
const LAST_SAVED_KEY = "hr_attendance_last_saved_at";
const DATE_RANGE_KEYS = ["attendanceStartDate", "attendanceEndDate"];

export type PersistedState = Omit<AttendanceState, "punches">;

export type PersistedSnapshot = {
  schemaVersion: number;
  savedAt: string;
  state: PersistedState;
  punches: BiometricPunch[];
  effects: Effect[];
};

export type LoadResult =
  | { status: "none" }
  | { status: "ok"; snapshot: PersistedSnapshot; migratedFromLegacy?: boolean }
  | { status: "incompatible"; reason: string }
  | { status: "unavailable"; reason: string };

type PunchRow = [number, string, string];

// ---------------------------------------------------------------------------------------------
// IndexedDB plumbing
// ---------------------------------------------------------------------------------------------
const hasIndexedDb = () => typeof indexedDB !== "undefined";

let dbPromise: Promise<IDBDatabase> | null = null;
const openDb = (): Promise<IDBDatabase> => {
  if (!hasIndexedDb()) return Promise.reject(new Error("IndexedDB غير متاح في هذا المتصفح"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("تعذر فتح قاعدة البيانات المحلية"));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("قاعدة البيانات المحلية مفتوحة في تبويب آخر"));
    };
  });
  return dbPromise;
};

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> => {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? (request.result as T) : undefined);
    tx.onerror = () => reject(tx.error ?? new Error("فشلت عملية الحفظ"));
    tx.onabort = () => reject(tx.error ?? new Error("تم إلغاء عملية الحفظ (قد تكون مساحة التخزين ممتلئة)"));
  });
};

const getAll = async (keys: string[]): Promise<Record<string, unknown>> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const out: Record<string, unknown> = {};
    keys.forEach((key) => {
      store.get(key).onsuccess = (event) => {
        out[key] = (event.target as IDBRequest).result;
      };
    });
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
};

// ---------------------------------------------------------------------------------------------
// (De)serialisation
// ---------------------------------------------------------------------------------------------
const toPunchRows = (punches: BiometricPunch[]): PunchRow[] =>
  punches.map((p) => [p.id, p.employeeCode, formatWallIso(p.punchDatetime)]);

const fromPunchRows = (rows: PunchRow[] | undefined): BiometricPunch[] => {
  if (!Array.isArray(rows)) return [];
  const out: BiometricPunch[] = [];
  rows.forEach(([id, employeeCode, iso]) => {
    const punchDatetime = parseWallIso(iso);
    if (punchDatetime) out.push({ id, employeeCode, punchDatetime });
  });
  return out;
};

export const reviveRecordDates = (records: AttendanceRecord[] | undefined, legacyInstants = false): AttendanceRecord[] =>
  (records ?? []).map((record) => {
    const revive = (value: unknown): Date | null => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) return null;
      // Records written by v1 were real instants in the browser zone → convert to Cairo wall-clock.
      return legacyInstants ? instantToCairoWall(date) : date;
    };
    return { ...record, checkIn: revive(record.checkIn), checkOut: revive(record.checkOut) };
  });

// ---------------------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------------------
const migrateLegacy = (): PersistedSnapshot | null => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LEGACY_STATE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  const state = (parsed?.state ?? parsed) as PersistedState | undefined;
  if (!state || typeof state !== "object" || !Array.isArray((state as PersistedState).employees)) {
    throw new Error("البيانات القديمة غير قابلة للقراءة");
  }
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    savedAt: String(parsed?.savedAt ?? new Date().toISOString()),
    state: {
      ...state,
      attendanceRecords: reviveRecordDates(state.attendanceRecords as AttendanceRecord[], true),
    },
    punches: [],
    effects: readLegacyEffects(),
  };
};

export const loadPersistedState = async (): Promise<LoadResult> => {
  if (!hasIndexedDb()) return { status: "unavailable", reason: "IndexedDB غير متاح – لن يتم حفظ البيانات بعد إغلاق الصفحة." };

  try {
    const stored = await getAll(["meta", "state", "punches", "effects"]);
    const meta = stored.meta as { schemaVersion?: number; savedAt?: string } | undefined;

    if (meta && stored.state) {
      if (Number(meta.schemaVersion) > STORAGE_SCHEMA_VERSION) {
        return { status: "incompatible", reason: "البيانات المحفوظة أنشأها إصدار أحدث من التطبيق." };
      }
      return {
        status: "ok",
        snapshot: {
          schemaVersion: STORAGE_SCHEMA_VERSION,
          savedAt: String(meta.savedAt ?? ""),
          state: stored.state as PersistedState,
          punches: fromPunchRows(stored.punches as PunchRow[] | undefined),
          effects: (stored.effects as Effect[] | undefined) ?? [],
        },
      };
    }

    // Nothing in IndexedDB yet → try the legacy localStorage format.
    try {
      const legacy = migrateLegacy();
      if (legacy) return { status: "ok", snapshot: legacy, migratedFromLegacy: true };
    } catch (error) {
      return {
        status: "incompatible",
        reason: error instanceof Error ? error.message : "تعذر تحويل البيانات القديمة.",
      };
    }
    return { status: "none" };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : "تعذر قراءة البيانات المحفوظة." };
  }
};

/** Call after a successful migration + first save so legacy copies stop shadowing the new store. */
export const removeLegacyStorage = () => {
  if (typeof localStorage === "undefined") return;
  LEGACY_KEYS.filter((key) => key !== LAST_SAVED_KEY).forEach((key) => localStorage.removeItem(key));
  clearLegacyEffects();
};

// ---------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------
export const persistState = async (snapshot: PersistedSnapshot, options: { autoBackup?: boolean } = {}) => {
  const savedAt = new Date().toISOString();
  try {
    await withStore("readwrite", (store) => {
      store.put({ schemaVersion: STORAGE_SCHEMA_VERSION, savedAt }, "meta");
      store.put(snapshot.state, "state");
      store.put(toPunchRows(snapshot.punches), "punches");
      store.put(snapshot.effects, "effects");
      if (options.autoBackup) {
        store.put({ createdAt: savedAt, snapshot: { ...snapshot, punches: toPunchRows(snapshot.punches) } }, "autoBackup");
      }
    });
    try {
      localStorage.setItem(LAST_SAVED_KEY, savedAt);
    } catch {
      // tiny key – ignore
    }
    window.dispatchEvent(new CustomEvent(PERSISTENCE_SAVED_EVENT, { detail: { savedAt } }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل حفظ البيانات";
    window.dispatchEvent(new CustomEvent(PERSISTENCE_ERROR_EVENT, { detail: { message } }));
    throw error;
  }
};

/** Last automatic backup (only exists when auto-backup is enabled). */
export const loadAutoBackup = async (): Promise<{ createdAt: string; snapshot: PersistedSnapshot } | null> => {
  try {
    const stored = (await getAll(["autoBackup"])).autoBackup as
      | { createdAt: string; snapshot: Omit<PersistedSnapshot, "punches"> & { punches: PunchRow[] } }
      | undefined;
    if (!stored) return null;
    return { createdAt: stored.createdAt, snapshot: { ...stored.snapshot, punches: fromPunchRows(stored.snapshot.punches) } };
  } catch {
    return null;
  }
};

export const clearPersistedState = async () => {
  try {
    await withStore("readwrite", (store) => {
      store.clear();
    });
  } catch {
    // nothing to clear / unavailable
  }
  if (typeof localStorage !== "undefined") {
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    DATE_RANGE_KEYS.forEach((key) => localStorage.removeItem(key));
    clearLegacyEffects();
  }
};

export const getLastSavedAt = (): string | null => {
  try {
    return localStorage.getItem(LAST_SAVED_KEY);
  } catch {
    return null;
  }
};

/** Asks the browser not to evict our data under storage pressure. */
export const requestPersistentStorage = async () => {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // best effort
  }
};

/** Raw dump of whatever is stored – lets the user rescue data the app cannot read. */
export const exportIncompatibleBackup = async (): Promise<Blob> => {
  const dump: Record<string, unknown> = {};
  try {
    Object.assign(dump, await getAll(["meta", "state", "punches", "effects"]));
  } catch {
    // ignore
  }
  if (typeof localStorage !== "undefined") {
    LEGACY_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value) dump[`localStorage:${key}`] = value;
    });
  }
  return new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), dump })], { type: "application/json" });
};

/** Safety net: stores the current data right before a destructive restore. */
export const savePreRestoreSnapshot = async () => {
  const { useAttendanceStore } = await import("@/store/attendanceStore");
  const { useEffectsStore } = await import("@/store/effectsStore");
  const { punches, ...state } = useAttendanceStore.getState().getSnapshot();
  const snapshot = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    state,
    punches: toPunchRows(punches),
    effects: useEffectsStore.getState().effects,
  };
  await withStore("readwrite", (store) => {
    store.put({ createdAt: snapshot.savedAt, snapshot }, "preRestoreSnapshot");
  });
};

export const loadPreRestoreSnapshot = async (): Promise<{ createdAt: string; snapshot: PersistedSnapshot } | null> => {
  try {
    const stored = (await getAll(["preRestoreSnapshot"])).preRestoreSnapshot as
      | { createdAt: string; snapshot: Omit<PersistedSnapshot, "punches"> & { punches: PunchRow[] } }
      | undefined;
    if (!stored) return null;
    return { createdAt: stored.createdAt, snapshot: { ...stored.snapshot, punches: fromPunchRows(stored.snapshot.punches) } };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------
// Portal data (requests, payroll, custody, …) – one blob so it can be saved independently of attendance
// ---------------------------------------------------------------------------------------------
export const savePortal = async (data: unknown) => {
  try {
    await withStore("readwrite", (store) => {
      store.put(data, "portal");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "فشل حفظ بيانات البوابة";
    window.dispatchEvent(new CustomEvent(PERSISTENCE_ERROR_EVENT, { detail: { message } }));
    throw error;
  }
};

export const loadPortal = async (): Promise<unknown | null> => {
  try {
    return (await getAll(["portal"])).portal ?? null;
  } catch {
    return null;
  }
};
