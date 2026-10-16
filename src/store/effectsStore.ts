import { create } from "zustand";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { normalizeEffectDateKey, normalizeEffectTimeKey, normalizeEffectType } from "@shared/effect-normalization";
import { useEffectsHistoryStore } from "@/store/effectsHistoryStore";

export type EffectSource = "manual" | "excel";

export type Effect = {
  id: string;
  employeeCode: string;
  employeeName?: string;
  date: string;
  fromTime?: string;
  toTime?: string;
  type: string;
  status?: string;
  note?: string;
  source: EffectSource;
  createdAt: string;
  updatedAt: string;
};

type EffectsState = {
  effects: Effect[];
  /** Replace everything (recorded in undo history). */
  setEffects: (rows: Effect[]) => void;
  upsertEffects: (rows: Omit<Effect, "id" | "createdAt" | "updatedAt">[]) => { inserted: number; updated: number; total: number };
  updateEffect: (id: string, patch: Partial<Effect>) => void;
  clearEffects: () => void;
  removeEffect: (id: string) => void;
  /** Replace without touching undo history (used by undo/redo, restore and hydration). */
  replaceEffects: (rows: Effect[]) => void;
  /** Employee code changed in the master data → keep effects attached to the employee. */
  renameEmployeeCode: (from: string, to: string) => void;
};

const effectKey = (row: Pick<Effect, "employeeCode" | "date" | "type" | "fromTime" | "toTime">) =>
  `${normalizeEmployeeCode(row.employeeCode)}|${row.date}|${String(row.type || "").trim()}|${row.fromTime || ""}|${row.toTime || ""}`;

const toTimeValue = (value: unknown) => String(value || "").trim();

export const migrateEffect = (row: any): Effect | null => {
  if (!row) return null;
  const employeeCode = normalizeEmployeeCode(row.employeeCode || "");
  const date = normalizeEffectDateKey(row.date);
  const type = normalizeEffectType(row.type);
  if (!employeeCode || !date || !type) return null;
  const now = new Date().toISOString();
  return {
    id: String(row.id || crypto.randomUUID()),
    employeeCode,
    employeeName: row.employeeName ? String(row.employeeName) : undefined,
    date,
    fromTime: normalizeEffectTimeKey(toTimeValue(row.fromTime ?? row.from)),
    toTime: normalizeEffectTimeKey(toTimeValue(row.toTime ?? row.to)),
    type,
    status: row.status ? String(row.status) : undefined,
    note: row.note ? String(row.note) : undefined,
    source: row.source === "manual" ? "manual" : "excel",
    createdAt: String(row.createdAt || now),
    updatedAt: String(row.updatedAt || row.createdAt || now),
  };
};


const normalizeRows = (rows: unknown[]): Effect[] => rows.map(migrateEffect).filter(Boolean) as Effect[];
const record = (current: Effect[]) => useEffectsHistoryStore.getState().capture(current);

/** Reads effects stored by older versions in localStorage (used once, by the migration). */
export const readLegacyEffects = (): Effect[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem("hr_effects_v2") ?? localStorage.getItem("hr_effects_v1");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? normalizeRows(parsed) : [];
  } catch {
    return [];
  }
};

export const clearLegacyEffects = () => {
  try {
    localStorage?.removeItem("hr_effects_v2");
    localStorage?.removeItem("hr_effects_v1");
  } catch {
    // ignore
  }
};

export const useEffectsStore = create<EffectsState>((set, get) => ({
  effects: [],

  replaceEffects: (rows) => set({ effects: normalizeRows(rows) }),

  setEffects: (rows) => {
    record(get().effects);
    set({ effects: normalizeRows(rows) });
  },

  upsertEffects: (rows) => {
    const stats = { inserted: 0, updated: 0, total: 0 };
    const state = get();
    record(state.effects);
    const now = new Date().toISOString();
    const keyToId = new Map<string, string>();
    const idToRow = new Map<string, Effect>();
    state.effects.forEach((effect) => {
      keyToId.set(effectKey(effect), effect.id);
      idToRow.set(effect.id, effect);
    });

    rows.forEach((row) => {
      const normalizedRow = migrateEffect({ ...row, id: undefined, createdAt: now, updatedAt: now });
      if (!normalizedRow) return;
      const key = effectKey(normalizedRow);
      const existingId = keyToId.get(key);
      if (existingId && idToRow.has(existingId)) {
        const old = idToRow.get(existingId)!;
        idToRow.set(existingId, {
          ...old,
          employeeName: normalizedRow.employeeName || old.employeeName,
          status: normalizedRow.status,
          note: normalizedRow.note,
          source: normalizedRow.source,
          updatedAt: now,
        });
        stats.updated += 1;
      } else {
        const created: Effect = { ...normalizedRow, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
        keyToId.set(key, created.id);
        idToRow.set(created.id, created);
        stats.inserted += 1;
      }
    });

    const next = Array.from(idToRow.values()).sort(
      (a, b) => a.date.localeCompare(b.date) || a.employeeCode.localeCompare(b.employeeCode)
    );
    stats.total = next.length;
    set({ effects: next });
    return stats;
  },

  updateEffect: (id, patch) => {
    const state = get();
    record(state.effects);
    const now = new Date().toISOString();
    set({
      effects: state.effects.map((row) => {
        if (row.id !== id) return row;
        const updated = migrateEffect({ ...row, ...patch, id: row.id, createdAt: row.createdAt, updatedAt: now }) || row;
        return { ...updated, id: row.id, createdAt: row.createdAt, updatedAt: now };
      }),
    });
  },

  clearEffects: () => {
    record(get().effects);
    set({ effects: [] });
  },

  removeEffect: (id) => {
    const state = get();
    record(state.effects);
    set({ effects: state.effects.filter((row) => row.id !== id) });
  },

  renameEmployeeCode: (from, to) => {
    const fromCode = normalizeEmployeeCode(from);
    const toCode = normalizeEmployeeCode(to);
    if (!fromCode || !toCode || fromCode === toCode) return;
    set({
      effects: get().effects.map((row) =>
        normalizeEmployeeCode(row.employeeCode) === fromCode ? { ...row, employeeCode: toCode } : row
      ),
    });
  },
}));
