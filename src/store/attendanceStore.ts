import { create } from "zustand";
import {
  ADJUSTMENT_TYPES,
  RULE_TYPES,
  insertAdjustmentSchema,
  insertLeaveSchema,
  insertOfficialHolidaySchema,
  type Adjustment,
  type AttendanceRecord,
  type BiometricPunch,
  type Employee,
  type InsertAdjustment,
  type InsertEmployee,
  type InsertLeave,
  type InsertOfficialHoliday,
  type InsertSpecialRule,
  type Leave,
  type OfficialHoliday,
  type SpecialRule,
} from "@shared/schema";
import { canonicalAdjustmentType } from "@/engine/attendanceEngine";
import { runEngine } from "@/engine/runEngine";
import { normalizeDateToIso } from "@shared/date-normalization";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { normalizeShiftStart } from "@shared/time-normalization";
import { DEFAULT_PAYROLL_START_DAY } from "@shared/payroll-period";
import { parsePunchWallClock } from "@shared/punch-parser";
import { useEffectsStore } from "@/store/effectsStore";
import { useEffectsHistoryStore } from "@/store/effectsHistoryStore";
import { usePortalStore } from "@/store/portalStore";
import { storage, type PersistedSnapshot } from "@/data/storage";

const blankToNull = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
};

/** Every optional employee column, so stored employees always have the complete shape. */
const EMPTY_EMPLOYEE_FIELDS = {
  sector: null, department: null, section: null, jobTitle: null, branch: null, governorate: null,
  hireDate: null, terminationDate: null, terminationReason: null, serviceDuration: null,
  directManager: null, deptManager: null, nationalId: null, birthDate: null, address: null,
  birthPlace: null, personalPhone: null, emergencyPhone: null, shiftStart: null,
};

/** Normalises a (possibly messy) employee row: trimmed code, ISO dates, valid shift start. */
const normalizeEmployeeRow = (row: Partial<InsertEmployee>): Omit<Employee, "id"> => {
  const record = row as Record<string, unknown>;
  const merged = { ...EMPTY_EMPLOYEE_FIELDS, ...row } as Omit<Employee, "id">;
  return {
    ...merged,
    code: normalizeEmployeeCode(String(record.code ?? "")),
    nameAr: String(record.nameAr ?? "").trim(),
    section: String(record.section || record.department || "").trim() || "غير مسجل",
    hireDate: blankToNull(normalizeDateToIso(record.hireDate ?? record.hire_date)),
    terminationDate: blankToNull(normalizeDateToIso(record.terminationDate)),
    birthDate: blankToNull(normalizeDateToIso(record.birthDate)),
    shiftStart: normalizeShiftStart(record.shiftStart),
  };
};

const getMaxId = (rows: Array<{ id?: number }>) => rows.reduce((max, row) => Math.max(max, row.id || 0), 0);
const recordKey = (code: string, date: string) => `${normalizeEmployeeCode(code)}__${date}`;

export type InvalidRow = { rowIndex?: number; reason?: string };

export type AttendanceState = {
  employees: Employee[];
  punches: BiometricPunch[];
  rules: SpecialRule[];
  adjustments: Adjustment[];
  leaves: Leave[];
  officialHolidays: OfficialHoliday[];
  attendanceRecords: AttendanceRecord[];
  config: {
    autoBackupEnabled: boolean;
    attendanceStartDate?: string | null;
    attendanceEndDate?: string | null;
    defaultPermissionMinutes: number;
    defaultHalfDayMinutes: number;
    defaultHalfDaySide: "صباح" | "مساء";
    /** First day of the payroll month: 24 → "24th of last month … 23rd" (1 = calendar month). */
    payrollMonthStartDay: number;
  };
  nextIds: {
    employee: number;
    rule: number;
    adjustment: number;
    leave: number;
    record: number;
  };
};

export type ProcessResult = { message: string; processedCount: number; skipped?: boolean };

export type AttendanceActions = {
  importEmployees: (rows: InsertEmployee[]) => { count: number; inserted: number; updated: number };
  createEmployee: (row: InsertEmployee) => Employee;
  updateEmployee: (id: number, updates: Partial<InsertEmployee>) => Employee | null;
  importPunches: (rows: { employeeCode: string; punchDatetime: string }[]) => { count: number; invalid: number };
  createRule: (row: InsertSpecialRule) => SpecialRule;
  updateRule: (id: number, updates: Partial<InsertSpecialRule>) => SpecialRule | null;
  deleteRule: (id: number) => void;
  importRules: (rows: InsertSpecialRule[]) => { count: number; invalid: InvalidRow[] };
  createAdjustment: (row: InsertAdjustment) => Adjustment;
  importAdjustments: (rows: InsertAdjustment[]) => { inserted: number; duplicates: number; invalid: InvalidRow[] };
  createLeave: (row: InsertLeave) => Leave;
  deleteLeave: (id: number) => void;
  importLeaves: (rows: InsertLeave[]) => { inserted: number; duplicates: number; invalid: InvalidRow[] };
  createOfficialHoliday: (row: InsertOfficialHoliday) => OfficialHoliday;
  deleteOfficialHoliday: (id: number) => void;
  setOfficialHolidays: (rows: OfficialHoliday[]) => void;
  /**
   * Recomputes attendance for the range. Runs in a Web Worker, so it is async.
   * Refuses to run (skipped = true) when NO punches are loaded but records already exist, because
   * that would replace real attendance with "Absent".
   */
  processAttendance: (params: {
    startDate: string;
    endDate: string;
    /** @deprecated punches are wall-clock values; no offset is needed. */
    timezoneOffsetMinutes?: number;
    employeeCodes?: string[];
    allowEmptyPunches?: boolean;
  }) => Promise<ProcessResult>;
  wipeData: () => Promise<void>;
  setEmployees: (rows: Employee[]) => void;
  setPunches: (rows: BiometricPunch[]) => void;
  setRules: (rows: SpecialRule[]) => void;
  setLeaves: (rows: Leave[]) => void;
  setAdjustments: (rows: Adjustment[]) => void;
  setAttendanceRecords: (rows: AttendanceRecord[]) => void;
  updateAttendanceRecord: (id: number, updates: Partial<AttendanceRecord>) => void;
  /** Toggles "worked on the official holiday" and keeps every dependent comp-day field consistent. */
  setWorkedOnOfficialHoliday: (id: number, worked: boolean) => void;
  setConfig: (config: AttendanceState["config"]) => void;
  getSnapshot: () => AttendanceState;
};

export type AttendanceStoreState = AttendanceState & AttendanceActions;

const createInitialState = (): AttendanceState => ({
  employees: [],
  punches: [],
  rules: [],
  adjustments: [],
  leaves: [],
  officialHolidays: [],
  attendanceRecords: [],
  config: {
    autoBackupEnabled: false,
    attendanceStartDate: null,
    attendanceEndDate: null,
    defaultPermissionMinutes: 120,
    defaultHalfDayMinutes: 240,
    defaultHalfDaySide: "صباح",
    payrollMonthStartDay: DEFAULT_PAYROLL_START_DAY,
  },
  nextIds: { employee: 1, rule: 1, adjustment: 1, leave: 1, record: 1 },
});

const selectSnapshot = (state: AttendanceStoreState): AttendanceState => ({
  employees: state.employees,
  punches: state.punches,
  rules: state.rules,
  adjustments: state.adjustments,
  leaves: state.leaves,
  officialHolidays: state.officialHolidays,
  attendanceRecords: state.attendanceRecords,
  config: state.config,
  nextIds: state.nextIds,
});

const adjustmentKey = (a: Pick<Adjustment, "employeeCode" | "date" | "type" | "fromTime" | "toTime" | "source">) =>
  [normalizeEmployeeCode(a.employeeCode), a.date, a.type, a.fromTime, a.toTime, a.source].join("|");

const leaveKey = (l: Pick<Leave, "type" | "scope" | "scopeValue" | "startDate" | "endDate">) =>
  [l.type, l.scope, l.scopeValue ?? "", l.startDate, l.endDate].join("|");

// Serialise engine runs so two quick actions can never interleave their merge step.
let processingQueue: Promise<unknown> = Promise.resolve();
const enqueue = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = processingQueue.then(job, job);
  processingQueue = run.catch(() => undefined);
  return run;
};

export const useAttendanceStore = create<AttendanceStoreState>((set, get) => ({
  ...createInitialState(),

  // ------------------------------------------------------------------ employees
  importEmployees: (rows) => {
    const current = get();
    const employees = [...current.employees];
    const indexByCode = new Map(employees.map((emp, i) => [normalizeEmployeeCode(emp.code), i]));
    let nextId = Math.max(current.nextIds.employee, getMaxId(employees) + 1);
    let inserted = 0;
    let updated = 0;

    rows.forEach((raw) => {
      const normalized = normalizeEmployeeRow(raw);
      if (!normalized.code || !String(normalized.nameAr ?? "").trim()) return;
      const existingIndex = indexByCode.get(normalized.code);

      if (existingIndex !== undefined) {
        // Upsert: non-empty cells update the employee; empty cells never erase existing data.
        const existing = employees[existingIndex];
        const patch: Record<string, unknown> = {};
        Object.entries(normalized).forEach(([key, value]) => {
          if (key === "id" || key === "code") return;
          if (value === null || value === undefined || value === "") return;
          if (key === "section" && value === "غير مسجل") return;
          if (key === "shiftStart" && !String((raw as Record<string, unknown>).shiftStart ?? "").trim()) return;
          patch[key] = value;
        });
        const merged = { ...existing, ...patch } as Employee;
        if (JSON.stringify(merged) !== JSON.stringify(existing)) {
          employees[existingIndex] = merged;
          updated += 1;
        }
        return;
      }

      const created: Employee = { ...normalized, id: nextId++ };
      employees.push(created);
      indexByCode.set(normalized.code, employees.length - 1);
      inserted += 1;
    });

    set({ employees, nextIds: { ...current.nextIds, employee: nextId } });
    return { count: inserted, inserted, updated };
  },

  createEmployee: (row) => {
    const current = get();
    const normalized = normalizeEmployeeRow(row);
    if (!normalized.code) throw new Error("كود الموظف مطلوب");
    if (current.employees.some((emp) => normalizeEmployeeCode(emp.code) === normalized.code)) {
      throw new Error("كود الموظف موجود بالفعل");
    }
    const employee: Employee = { ...normalized, id: Math.max(current.nextIds.employee, getMaxId(current.employees) + 1) };
    set({
      employees: [...current.employees, employee],
      nextIds: { ...current.nextIds, employee: employee.id + 1 },
    });
    return employee;
  },

  updateEmployee: (id, updates) => {
    const current = get();
    const existing = current.employees.find((emp) => emp.id === id);
    if (!existing) return null;

    const merged: Employee = { ...normalizeEmployeeRow({ ...existing, ...updates }), id };
    const oldCode = normalizeEmployeeCode(existing.code);

    if (merged.code !== oldCode) {
      if (!merged.code) throw new Error("كود الموظف مطلوب");
      if (current.employees.some((emp) => emp.id !== id && normalizeEmployeeCode(emp.code) === merged.code)) {
        throw new Error("كود الموظف موجود بالفعل");
      }
      // Keep every record attached to the employee when the code changes.
      const rename = <T extends { employeeCode: string }>(rows: T[]) =>
        rows.map((row) => (normalizeEmployeeCode(row.employeeCode) === oldCode ? { ...row, employeeCode: merged.code } : row));
      set({
        employees: current.employees.map((emp) => (emp.id === id ? merged : emp)),
        punches: rename(current.punches),
        adjustments: rename(current.adjustments),
        attendanceRecords: rename(current.attendanceRecords),
      });
      useEffectsStore.getState().renameEmployeeCode(oldCode, merged.code);
      return merged;
    }

    set({ employees: current.employees.map((emp) => (emp.id === id ? merged : emp)) });
    return merged;
  },

  // ------------------------------------------------------------------ punches
  importPunches: (rows) => {
    const current = get();
    const existing = new Set(current.punches.map((p) => `${normalizeEmployeeCode(p.employeeCode)}|${p.punchDatetime.getTime()}`));
    const additions: BiometricPunch[] = [];
    let invalid = 0;
    let nextId = getMaxId(current.punches) + 1;

    rows.forEach((row) => {
      const code = normalizeEmployeeCode(row.employeeCode);
      const when = parsePunchWallClock(row.punchDatetime);
      if (!code || !when) {
        invalid += 1;
        return;
      }
      const key = `${code}|${when.getTime()}`;
      if (existing.has(key)) return;
      existing.add(key);
      additions.push({ id: nextId++, employeeCode: code, punchDatetime: when });
    });

    if (additions.length > 0) set({ punches: current.punches.concat(additions) });
    return { count: additions.length, invalid };
  },

  // ------------------------------------------------------------------ rules
  createRule: (row) => {
    const current = get();
    const rule = {
      ...row,
      id: Math.max(current.nextIds.rule, getMaxId(current.rules) + 1),
      priority: row.priority ?? 0,
      startDate: normalizeDateToIso(row.startDate) || row.startDate,
      endDate: normalizeDateToIso(row.endDate) || row.endDate,
    } as SpecialRule;
    set({ rules: [...current.rules, rule], nextIds: { ...current.nextIds, rule: rule.id + 1 } });
    return rule;
  },

  updateRule: (id, updates) => {
    const current = get();
    const existing = current.rules.find((rule) => rule.id === id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id } as SpecialRule;
    set({ rules: current.rules.map((rule) => (rule.id === id ? updated : rule)) });
    return updated;
  },

  deleteRule: (id) => set({ rules: get().rules.filter((rule) => rule.id !== id) }),

  importRules: (rows) => {
    const current = get();
    const invalid: InvalidRow[] = [];
    const seen = new Set(current.rules.map((r) => [r.name, r.scope, r.startDate, r.endDate, r.ruleType].join("|")));
    const additions: SpecialRule[] = [];
    let nextId = Math.max(current.nextIds.rule, getMaxId(current.rules) + 1);

    rows.forEach((row, index) => {
      const startDate = normalizeDateToIso(row.startDate);
      const endDate = normalizeDateToIso(row.endDate);
      if (!row.name || !row.scope) return invalid.push({ rowIndex: index + 2, reason: "الاسم والنطاق مطلوبان" });
      if (!(RULE_TYPES as readonly string[]).includes(row.ruleType)) {
        return invalid.push({ rowIndex: index + 2, reason: `نوع قاعدة غير معروف: ${row.ruleType}` });
      }
      if (!startDate || !endDate) return invalid.push({ rowIndex: index + 2, reason: "تاريخ البداية/النهاية غير صالح" });
      if (startDate > endDate) return invalid.push({ rowIndex: index + 2, reason: "تاريخ البداية بعد النهاية" });
      const key = [row.name, row.scope, startDate, endDate, row.ruleType].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      additions.push({ ...row, id: nextId++, priority: row.priority ?? 0, startDate, endDate } as SpecialRule);
    });

    if (additions.length) set({ rules: [...current.rules, ...additions], nextIds: { ...current.nextIds, rule: nextId } });
    return { count: additions.length, invalid };
  },

  // ------------------------------------------------------------------ adjustments
  createAdjustment: (row) => {
    const current = get();
    const adjustment = {
      ...row,
      id: Math.max(current.nextIds.adjustment, getMaxId(current.adjustments) + 1),
      employeeCode: normalizeEmployeeCode(row.employeeCode),
      type: canonicalAdjustmentType(row.type) as Adjustment["type"],
      date: normalizeDateToIso(row.date) || row.date,
      sourceFileName: row.sourceFileName ?? null,
      importedAt: row.importedAt ?? new Date(),
      note: row.note ?? null,
    } as Adjustment;
    set({ adjustments: [...current.adjustments, adjustment], nextIds: { ...current.nextIds, adjustment: adjustment.id + 1 } });
    return adjustment;
  },

  importAdjustments: (rows) => {
    const current = get();
    const invalid: InvalidRow[] = [];
    const seen = new Set(current.adjustments.map(adjustmentKey));
    const additions: Adjustment[] = [];
    let nextId = Math.max(current.nextIds.adjustment, getMaxId(current.adjustments) + 1);
    let duplicates = 0;

    rows.forEach((row, index) => {
      const date = normalizeDateToIso(row.date);
      const type = canonicalAdjustmentType(String(row.type ?? ""));
      const code = normalizeEmployeeCode(row.employeeCode);
      if (!code) return invalid.push({ rowIndex: index + 2, reason: "كود الموظف مطلوب" });
      if (!date) return invalid.push({ rowIndex: index + 2, reason: "تاريخ غير صالح" });
      if (!(ADJUSTMENT_TYPES as readonly string[]).includes(type)) {
        return invalid.push({ rowIndex: index + 2, reason: `نوع غير معروف: ${row.type}` });
      }
      const adjustment = {
        ...row,
        employeeCode: code,
        date,
        type,
        fromTime: row.fromTime ?? "",
        toTime: row.toTime ?? "",
        sourceFileName: row.sourceFileName ?? null,
        importedAt: row.importedAt ?? new Date(),
        note: row.note ?? null,
        id: nextId,
      } as Adjustment;
      const key = adjustmentKey(adjustment);
      if (seen.has(key)) {
        duplicates += 1;
        return;
      }
      seen.add(key);
      nextId += 1;
      additions.push(adjustment);
    });

    if (additions.length) {
      set({ adjustments: [...current.adjustments, ...additions], nextIds: { ...current.nextIds, adjustment: nextId } });
    }
    return { inserted: additions.length, duplicates, invalid };
  },

  // ------------------------------------------------------------------ leaves
  createLeave: (row) => {
    const current = get();
    const leave = {
      ...row,
      id: Math.max(current.nextIds.leave, getMaxId(current.leaves) + 1),
      startDate: normalizeDateToIso(row.startDate) || row.startDate,
      endDate: normalizeDateToIso(row.endDate) || row.endDate,
      scopeValue: row.scopeValue ?? null,
      note: row.note ?? null,
      createdAt: new Date(),
      source: row.source ?? null,
    } as Leave;
    set({ leaves: [...current.leaves, leave], nextIds: { ...current.nextIds, leave: leave.id + 1 } });
    return leave;
  },

  deleteLeave: (id) => set({ leaves: get().leaves.filter((leave) => leave.id !== id) }),

  importLeaves: (rows) => {
    const current = get();
    const invalid: InvalidRow[] = [];
    const seen = new Set(current.leaves.map(leaveKey));
    const additions: Leave[] = [];
    let nextId = Math.max(current.nextIds.leave, getMaxId(current.leaves) + 1);
    let duplicates = 0;

    rows.forEach((row, index) => {
      const startDate = normalizeDateToIso(row.startDate);
      const endDate = normalizeDateToIso(row.endDate);
      if (!row.type || !row.scope) return invalid.push({ rowIndex: index + 2, reason: "النوع والنطاق مطلوبان" });
      if (!startDate || !endDate) return invalid.push({ rowIndex: index + 2, reason: "تاريخ غير صالح" });
      if (startDate > endDate) return invalid.push({ rowIndex: index + 2, reason: "تاريخ البداية بعد النهاية" });
      const leave = { ...row, id: nextId, startDate, endDate, scopeValue: row.scopeValue ?? null, note: row.note ?? null, createdAt: new Date(), source: row.source ?? null } as Leave;
      const key = leaveKey(leave);
      if (seen.has(key)) {
        duplicates += 1;
        return;
      }
      seen.add(key);
      nextId += 1;
      additions.push(leave);
    });

    if (additions.length) set({ leaves: [...current.leaves, ...additions], nextIds: { ...current.nextIds, leave: nextId } });
    return { inserted: additions.length, duplicates, invalid };
  },

  // ------------------------------------------------------------------ holidays
  createOfficialHoliday: (row) => {
    const current = get();
    const date = normalizeDateToIso(row.date);
    if (!date) throw new Error("تاريخ الإجازة غير صالح");
    if (current.officialHolidays.some((h) => h.date === date)) throw new Error("هذا التاريخ مضاف بالفعل كإجازة رسمية");
    // max + 1 (not length + 1): ids stay unique after deletions.
    const holiday: OfficialHoliday = { ...row, date, id: getMaxId(current.officialHolidays) + 1 };
    set({ officialHolidays: [...current.officialHolidays, holiday] });
    return holiday;
  },

  deleteOfficialHoliday: (id) => set({ officialHolidays: get().officialHolidays.filter((h) => h.id !== id) }),

  setOfficialHolidays: (rows) => set({ officialHolidays: rows }),

  // ------------------------------------------------------------------ processing
  processAttendance: ({ startDate, endDate, employeeCodes, allowEmptyPunches }) =>
    enqueue(async () => {
      const current = get();
      const codeFilter = employeeCodes?.length ? new Set(employeeCodes.map(normalizeEmployeeCode)) : null;
      const inScope = (code: string) => !codeFilter || codeFilter.has(normalizeEmployeeCode(code));
      const inRange = (record: AttendanceRecord) => record.date >= startDate && record.date <= endDate && inScope(record.employeeCode);

      const employeeCount = codeFilter
        ? current.employees.filter((e) => inScope(e.code)).length
        : current.employees.length;
      if (employeeCount === 0) return { message: "لا يوجد موظفون للمعالجة", processedCount: 0, skipped: true };

      if (!allowEmptyPunches && current.punches.length === 0 && current.attendanceRecords.some(inRange)) {
        return {
          message: "لا توجد بصمات محمّلة، لذلك لم تتم إعادة المعالجة (لحماية السجلات الحالية من التحويل إلى غياب). استورد ملف البصمة أولاً.",
          processedCount: 0,
          skipped: true,
        };
      }

      const overrides: [string, boolean][] = [];
      current.attendanceRecords.forEach((record) => {
        if (record.workedOnOfficialHoliday === null || record.workedOnOfficialHoliday === undefined) return;
        overrides.push([recordKey(record.employeeCode, record.date), record.workedOnOfficialHoliday]);
      });

      const computed = await runEngine({
        employees: current.employees,
        punches: current.punches,
        rules: current.rules,
        leaves: current.leaves,
        officialHolidays: current.officialHolidays,
        adjustments: current.adjustments,
        effects: useEffectsStore.getState().effects,
        startDate,
        endDate,
        employeeCodes,
        overrides,
        defaultPermissionMinutes: current.config.defaultPermissionMinutes,
        defaultHalfDayMinutes: current.config.defaultHalfDayMinutes,
      });

      // Merge against the LATEST state (the user may have edited while the worker was running).
      const latest = get();
      let nextId = Math.max(latest.nextIds.record, getMaxId(latest.attendanceRecords) + 1);
      const withIds = computed.map((record) => ({ ...record, id: nextId++ }));
      const remaining = latest.attendanceRecords.filter((record) => !inRange(record));

      set({
        attendanceRecords: remaining.concat(withIds),
        nextIds: { ...latest.nextIds, record: nextId },
      });

      const dayCount = Math.max(1, Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1);
      return {
        message: `تمت معالجة ${withIds.length} سجل (${employeeCount} موظف × ${dayCount} يوم)`,
        processedCount: withIds.length,
      };
    }),

  wipeData: async () => {
    await storage.clear();
    useEffectsStore.getState().replaceEffects([]);
    useEffectsHistoryStore.getState().clear();
    usePortalStore.getState().reset();
    set({ ...createInitialState() });
  },

  setEmployees: (rows) => set({ employees: rows, nextIds: { ...get().nextIds, employee: getMaxId(rows) + 1 } }),
  setPunches: (rows) => set({ punches: rows }),
  setRules: (rows) => set({ rules: rows, nextIds: { ...get().nextIds, rule: getMaxId(rows) + 1 } }),
  setLeaves: (rows) => set({ leaves: rows, nextIds: { ...get().nextIds, leave: getMaxId(rows) + 1 } }),
  setAdjustments: (rows) => set({ adjustments: rows, nextIds: { ...get().nextIds, adjustment: getMaxId(rows) + 1 } }),
  setAttendanceRecords: (rows) => set({ attendanceRecords: rows, nextIds: { ...get().nextIds, record: getMaxId(rows) + 1 } }),

  updateAttendanceRecord: (id, updates) => {
    set({ attendanceRecords: get().attendanceRecords.map((r) => (r.id === id ? { ...r, ...updates } : r)) });
  },

  setWorkedOnOfficialHoliday: (id, worked) => {
    set({
      attendanceRecords: get().attendanceRecords.map((record) => {
        if (record.id !== id) return record;
        const credit = worked ? 1 : 0;
        return {
          ...record,
          workedOnOfficialHoliday: worked,
          compDayCredit: credit,
          compDaysOfficial: credit,
          compDaysTotal: credit + (record.compDaysFriday ?? 0),
        };
      }),
    });
  },

  setConfig: (config) => set({ config }),
  getSnapshot: () => selectSnapshot(get()),
}));

// ---------------------------------------------------------------------------------------------
// Persistence wiring
// ---------------------------------------------------------------------------------------------
export const buildSnapshot = (): PersistedSnapshot => {
  const { punches, ...state } = selectSnapshot(useAttendanceStore.getState());
  return {
    schemaVersion: 2,
    savedAt: new Date().toISOString(),
    state,
    punches,
    effects: useEffectsStore.getState().effects,
  };
};

export const applySnapshot = (snapshot: PersistedSnapshot) => {
  const initial = createInitialState();
  useAttendanceStore.setState({
    ...initial,
    ...snapshot.state,
    config: { ...initial.config, ...(snapshot.state.config ?? {}) },
    nextIds: { ...initial.nextIds, ...(snapshot.state.nextIds ?? {}) },
    punches: snapshot.punches,
  });
  useEffectsStore.getState().replaceEffects(snapshot.effects ?? []);
  useEffectsHistoryStore.getState().clear();
};
