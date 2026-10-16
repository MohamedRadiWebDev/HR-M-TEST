import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import {
  adjustmentSchema,
  employeeSchema,
  leaveSchema,
  officialHolidaySchema,
  ruleSchema,
  type Adjustment,
  type AttendanceRecord,
  type BiometricPunch,
  type Employee,
  type Leave,
  type OfficialHoliday,
  type SpecialRule,
} from "@shared/schema";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { formatWallIso, instantToCairoWall } from "@shared/wallclock";
import { parsePunchWallClock } from "@shared/punch-parser";
import type { Effect } from "@/store/effectsStore";
import { useAttendanceStore, type AttendanceState } from "@/store/attendanceStore";
import { useEffectsStore } from "@/store/effectsStore";
import { useEffectsHistoryStore } from "@/store/effectsHistoryStore";
import { storage } from "@/data/storage";

export const BACKUP_SCHEMA_VERSION = 2;
export const APP_VERSION = "2.0.0";

export type BackupModuleKey =
  | "employees"
  | "punches"
  | "attendanceRecords"
  | "rules"
  | "leaves"
  | "adjustments"
  | "officialHolidays"
  | "effects"
  | "config";

export const BACKUP_MODULES: { key: BackupModuleKey; label: string }[] = [
  { key: "employees", label: "الموظفون" },
  { key: "punches", label: "البصمات" },
  { key: "attendanceRecords", label: "سجلات الحضور" },
  { key: "rules", label: "القواعد الخاصة" },
  { key: "leaves", label: "الإجازات" },
  { key: "adjustments", label: "التسويات" },
  { key: "officialHolidays", label: "الإجازات الرسمية" },
  { key: "effects", label: "المؤثرات" },
  { key: "config", label: "الإعدادات" },
];

export type BackupMeta = {
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  /** "wall": punch / check-in times are floating wall-clock text (v2). Absent in v1 (real instants). */
  punchTimeModel?: "wall";
  selectedModules: BackupModuleKey[];
  recordCounts: Record<string, number>;
};

type SerializedPunch = { id: number; employeeCode: string; punchDatetime: string };
type SerializedRecord = Omit<AttendanceRecord, "checkIn" | "checkOut"> & { checkIn: string | null; checkOut: string | null };

export type BackupPayload = {
  meta: BackupMeta;
  modules: {
    employees?: Employee[];
    punches?: SerializedPunch[];
    attendanceRecords?: SerializedRecord[];
    rules?: SpecialRule[];
    leaves?: Leave[];
    adjustments?: Adjustment[];
    officialHolidays?: OfficialHoliday[];
    effects?: Effect[];
    config?: AttendanceState["config"];
  };
};

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------
export const buildBackupPayload = (params: {
  state: AttendanceState;
  effects?: Effect[];
  selectedModules: BackupModuleKey[];
}): BackupPayload => {
  const { state, selectedModules } = params;
  const modules: BackupPayload["modules"] = {};
  const has = (key: BackupModuleKey) => selectedModules.includes(key);

  if (has("employees")) modules.employees = state.employees;
  if (has("punches")) {
    modules.punches = state.punches.map((p) => ({ id: p.id, employeeCode: p.employeeCode, punchDatetime: formatWallIso(p.punchDatetime) }));
  }
  if (has("attendanceRecords")) {
    modules.attendanceRecords = state.attendanceRecords.map((r) => ({
      ...r,
      checkIn: r.checkIn ? formatWallIso(r.checkIn) : null,
      checkOut: r.checkOut ? formatWallIso(r.checkOut) : null,
    }));
  }
  if (has("rules")) modules.rules = state.rules;
  if (has("leaves")) modules.leaves = state.leaves;
  if (has("adjustments")) modules.adjustments = state.adjustments;
  if (has("officialHolidays")) modules.officialHolidays = state.officialHolidays;
  if (has("effects")) modules.effects = params.effects ?? [];
  if (has("config")) modules.config = state.config;

  const recordCounts: Record<string, number> = {};
  Object.entries(modules).forEach(([key, value]) => {
    recordCounts[key] = Array.isArray(value) ? value.length : 1;
  });

  return {
    meta: {
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      punchTimeModel: "wall",
      selectedModules,
      recordCounts,
    },
    modules,
  };
};

// ---------------------------------------------------------------------------------------------
// Encryption (optional) – AES-256-GCM, key from PBKDF2-SHA256
// ---------------------------------------------------------------------------------------------
const MAGIC = strToU8("HRBK1");
const PBKDF2_ITERATIONS = 250_000;

export class BackupPasswordRequiredError extends Error {
  constructor(message = "هذه النسخة مشفّرة. أدخل كلمة المرور.") {
    super(message);
    this.name = "BackupPasswordRequiredError";
  }
}

const deriveKey = async (password: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey("raw", strToU8(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

const encryptBytes = async (data: Uint8Array, password: string): Promise<Uint8Array> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource));
  const out = new Uint8Array(MAGIC.length + salt.length + iv.length + cipher.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + salt.length);
  out.set(cipher, MAGIC.length + salt.length + iv.length);
  return out;
};

const isEncrypted = (bytes: Uint8Array) => MAGIC.every((b: number, i: number) => bytes[i] === b);

const decryptBytes = async (bytes: Uint8Array, password: string): Promise<Uint8Array> => {
  const salt = bytes.slice(MAGIC.length, MAGIC.length + 16);
  const iv = bytes.slice(MAGIC.length + 16, MAGIC.length + 28);
  const cipher = bytes.slice(MAGIC.length + 28);
  try {
    const key = await deriveKey(password, salt);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, cipher as BufferSource));
  } catch {
    throw new Error("كلمة المرور غير صحيحة أو الملف تالف.");
  }
};

// ---------------------------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------------------------
const moduleFile = (key: string) => `${key}.json`;

export const createBackupBytes = async (payload: BackupPayload, password?: string): Promise<Uint8Array> => {
  const files: Record<string, Uint8Array> = { "meta.json": strToU8(JSON.stringify(payload.meta, null, 2)) };
  Object.entries(payload.modules).forEach(([key, value]) => {
    if (value !== undefined) files[moduleFile(key)] = strToU8(JSON.stringify(value));
  });
  const zipped = zipSync(files, { level: 6 });
  return password ? encryptBytes(zipped, password) : zipped;
};

export const createBackupBlob = async (payload: BackupPayload, password?: string) =>
  new Blob([(await createBackupBytes(payload, password)) as BlobPart], {
    type: password ? "application/octet-stream" : "application/zip",
  });

export const backupFileName = (encrypted: boolean) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return `hr-attendance-backup-${stamp}${encrypted ? ".hrbak" : ".zip"}`;
};

// ---------------------------------------------------------------------------------------------
// Read + validate
// ---------------------------------------------------------------------------------------------
const lenientArray = <T extends z.ZodTypeAny>(schema: T) => z.array(schema);

const looseRecord = z
  .object({ id: z.number(), employeeCode: z.string(), date: z.string() })
  .passthrough();

const modulesSchemas: Record<BackupModuleKey, z.ZodTypeAny> = {
  employees: lenientArray(employeeSchema.passthrough()),
  punches: lenientArray(z.object({ id: z.number(), employeeCode: z.string(), punchDatetime: z.string() })),
  attendanceRecords: lenientArray(looseRecord),
  rules: lenientArray(ruleSchema.passthrough()),
  leaves: lenientArray(leaveSchema.passthrough()),
  adjustments: lenientArray(adjustmentSchema.passthrough()),
  officialHolidays: lenientArray(officialHolidaySchema),
  effects: lenientArray(z.object({ employeeCode: z.string(), date: z.string(), type: z.string() }).passthrough()),
  config: z.object({}).passthrough(),
};

const parseJson = (files: Record<string, Uint8Array>, name: string) => {
  try {
    return JSON.parse(strFromU8(files[name]));
  } catch {
    throw new Error(`الملف ${name} داخل النسخة الاحتياطية تالف.`);
  }
};

export const readBackupFile = async (file: File | Blob, password?: string): Promise<BackupPayload> => {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (isEncrypted(bytes)) {
    if (!password) throw new BackupPasswordRequiredError();
    bytes = await decryptBytes(bytes, password);
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("الملف ليس نسخة احتياطية صالحة (تعذر فك الضغط).");
  }
  if (!files["meta.json"]) throw new Error("ملف النسخة الاحتياطية لا يحتوي على meta.json.");

  const meta = parseJson(files, "meta.json") as BackupMeta;
  if (meta.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error("هذه النسخة أنشأها إصدار أحدث من التطبيق ولا يمكن قراءتها.");
  }
  if (![1, 2].includes(meta.schemaVersion)) throw new Error("إصدار النسخة الاحتياطية غير مدعوم.");

  const modules: BackupPayload["modules"] = {};
  (Object.keys(modulesSchemas) as BackupModuleKey[]).forEach((key) => {
    const name = moduleFile(key);
    if (!files[name]) return;
    const parsed = modulesSchemas[key].safeParse(parseJson(files, name));
    if (!parsed.success) {
      throw new Error(`بيانات "${BACKUP_MODULES.find((m) => m.key === key)?.label ?? key}" في النسخة غير صالحة: ${parsed.error.issues[0]?.message ?? ""}`);
    }
    (modules as Record<string, unknown>)[key] = parsed.data;
  });

  return { meta, modules };
};

// ---------------------------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------------------------
const restorePunches = (payload: BackupPayload): BiometricPunch[] => {
  const legacy = payload.meta.punchTimeModel !== "wall";
  const out: BiometricPunch[] = [];
  (payload.modules.punches ?? []).forEach((p) => {
    // v1 stored real instants (ISO with Z) → Cairo wall-clock for that instant (DST-correct).
    const when = legacy ? instantToCairoWall(new Date(p.punchDatetime)) : parsePunchWallClock(p.punchDatetime);
    if (when && !Number.isNaN(when.getTime())) out.push({ id: p.id, employeeCode: p.employeeCode, punchDatetime: when });
  });
  return out;
};

const restoreRecords = (payload: BackupPayload): AttendanceRecord[] => {
  const legacy = payload.meta.punchTimeModel !== "wall";
  const revive = (value: string | null): Date | null => {
    if (!value) return null;
    const date = legacy ? instantToCairoWall(new Date(value)) : parsePunchWallClock(value);
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };
  return (payload.modules.attendanceRecords ?? []).map((r) => ({ ...r, checkIn: revive(r.checkIn), checkOut: revive(r.checkOut) })) as AttendanceRecord[];
};

/** Merge `incoming` into `current` by a content key; new rows get fresh ids so ids never collide. */
const mergeById = <T extends { id: number }>(current: T[], incoming: T[], keyOf: (row: T) => string): T[] => {
  const known = new Set(current.map(keyOf));
  let nextId = current.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const additions: T[] = [];
  incoming.forEach((row) => {
    const key = keyOf(row);
    if (known.has(key)) return;
    known.add(key);
    additions.push({ ...row, id: nextId++ });
  });
  return current.concat(additions);
};

export type RestoreSummary = Record<string, number>;

export type RestoreOptions = {
  mode: "replace" | "merge";
  modules: BackupModuleKey[];
};

/** Applies a backup to the stores. A snapshot of the CURRENT data is stored first (undo safety net). */
export const restoreBackup = async (payload: BackupPayload, options: RestoreOptions): Promise<RestoreSummary> => {
  const store = useAttendanceStore.getState();
  await storage.savePreRestoreSnapshot().catch(() => undefined);

  const summary: RestoreSummary = {};
  const wants = (key: BackupModuleKey) => options.modules.includes(key) && payload.modules[key] !== undefined;
  const replace = options.mode === "replace";
  const code = (value: string) => normalizeEmployeeCode(value);

  if (wants("employees")) {
    const rows = payload.modules.employees!;
    if (replace) store.setEmployees(rows);
    else store.setEmployees(mergeById(useAttendanceStore.getState().employees, rows, (e) => code(e.code)));
    summary.employees = rows.length;
  }
  if (wants("punches")) {
    const rows = restorePunches(payload);
    if (replace) store.setPunches(rows);
    else {
      const current = useAttendanceStore.getState().punches;
      store.setPunches(mergeById(current, rows, (p) => `${code(p.employeeCode)}|${p.punchDatetime.getTime()}`));
    }
    summary.punches = rows.length;
  }
  if (wants("attendanceRecords")) {
    const rows = restoreRecords(payload);
    if (replace) store.setAttendanceRecords(rows);
    else {
      const current = useAttendanceStore.getState().attendanceRecords;
      const incomingKeys = new Set(rows.map((r) => `${code(r.employeeCode)}|${r.date}`));
      // Backup rows win for the same employee/day.
      const kept = current.filter((r) => !incomingKeys.has(`${code(r.employeeCode)}|${r.date}`));
      store.setAttendanceRecords(mergeById(kept, rows, (r) => `${code(r.employeeCode)}|${r.date}`));
    }
    summary.attendanceRecords = rows.length;
  }
  if (wants("rules")) {
    const rows = payload.modules.rules!;
    if (replace) store.setRules(rows);
    else store.setRules(mergeById(useAttendanceStore.getState().rules, rows, (r) => [r.name, r.scope, r.startDate, r.endDate, r.ruleType].join("|")));
    summary.rules = rows.length;
  }
  if (wants("leaves")) {
    const rows = payload.modules.leaves!.map((l) => ({ ...l, createdAt: l.createdAt ? new Date(l.createdAt) : null }));
    if (replace) store.setLeaves(rows);
    else store.setLeaves(mergeById(useAttendanceStore.getState().leaves, rows, (l) => [l.type, l.scope, l.scopeValue ?? "", l.startDate, l.endDate].join("|")));
    summary.leaves = rows.length;
  }
  if (wants("adjustments")) {
    const rows = payload.modules.adjustments!.map((a) => ({ ...a, importedAt: a.importedAt ? new Date(a.importedAt) : null }));
    if (replace) store.setAdjustments(rows);
    else store.setAdjustments(mergeById(useAttendanceStore.getState().adjustments, rows, (a) => [code(a.employeeCode), a.date, a.type, a.fromTime, a.toTime, a.source].join("|")));
    summary.adjustments = rows.length;
  }
  if (wants("officialHolidays")) {
    const rows = payload.modules.officialHolidays!;
    if (replace) store.setOfficialHolidays(rows);
    else store.setOfficialHolidays(mergeById(useAttendanceStore.getState().officialHolidays, rows, (h) => h.date));
    summary.officialHolidays = rows.length;
  }
  if (wants("effects")) {
    const rows = payload.modules.effects!;
    const effects = useEffectsStore.getState();
    if (replace) effects.replaceEffects(rows);
    else {
      const known = new Set(effects.effects.map((e) => `${code(e.employeeCode)}|${e.date}|${e.type}|${e.fromTime ?? ""}|${e.toTime ?? ""}`));
      effects.replaceEffects(effects.effects.concat(rows.filter((e) => !known.has(`${code(e.employeeCode)}|${e.date}|${e.type}|${e.fromTime ?? ""}|${e.toTime ?? ""}`))));
    }
    useEffectsHistoryStore.getState().clear();
    summary.effects = rows.length;
  }
  if (wants("config")) {
    store.setConfig({ ...useAttendanceStore.getState().config, ...payload.modules.config! });
    summary.config = 1;
  }
  return summary;
};
