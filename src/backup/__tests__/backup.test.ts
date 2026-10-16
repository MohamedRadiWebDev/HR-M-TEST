import { beforeEach, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsStore } from "@/store/effectsStore";
import { usePortalStore } from "@/store/portalStore";
import {
  BackupPasswordRequiredError,
  buildBackupPayload,
  createBackupBlob,
  readBackupFile,
  restoreBackup,
  type BackupModuleKey,
} from "@/backup/backupService";

const ALL: BackupModuleKey[] = ["employees", "punches", "attendanceRecords", "rules", "leaves", "adjustments", "officialHolidays", "effects", "portal", "config"];
const s = () => useAttendanceStore.getState();

const reset = () => {
  useAttendanceStore.setState({
    employees: [], punches: [], rules: [], adjustments: [], leaves: [], officialHolidays: [], attendanceRecords: [],
    nextIds: { employee: 1, rule: 1, adjustment: 1, leave: 1, record: 1 },
  });
  useEffectsStore.getState().replaceEffects([]);
};

const seed = async () => {
  s().importEmployees([{ code: "1", nameAr: "أحمد", hireDate: "2025-01-01", nationalId: "29001010101010" }]);
  s().importPunches([
    { employeeCode: "1", punchDatetime: "2026-07-13T09:20:00" },
    { employeeCode: "1", punchDatetime: "2026-07-13T17:10:00" },
  ]);
  useEffectsStore.getState().upsertEffects([{ employeeCode: "1", date: "2026-07-13", type: "مأمورية", fromTime: "10:00:00", toTime: "11:00:00", source: "manual" }]);
  s().createOfficialHoliday({ date: "2026-07-23", name: "عيد" });
  await s().processAttendance({ startDate: "2026-07-13", endDate: "2026-07-13" });
};

const payloadNow = () => buildBackupPayload({ state: s().getSnapshot(), effects: useEffectsStore.getState().effects, portal: usePortalStore.getState().snapshot(), selectedModules: ALL });

describe("backup round trip", () => {
  beforeEach(reset);

  it("restores exactly what was exported (including punches, wall-clock times and effects)", async () => {
    await seed();
    const original = {
      employees: s().employees, records: s().attendanceRecords, punches: s().punches, effects: useEffectsStore.getState().effects,
    };
    const blob = await createBackupBlob(payloadNow());
    reset();
    const payload = await readBackupFile(blob);
    await restoreBackup(payload, { mode: "replace", modules: ALL });

    expect(s().employees).toEqual(original.employees);
    expect(s().punches.map((p) => p.punchDatetime.getTime())).toEqual(original.punches.map((p) => p.punchDatetime.getTime()));
    expect(s().attendanceRecords[0].checkIn?.getTime()).toBe(original.records[0].checkIn?.getTime());
    expect(useEffectsStore.getState().effects).toEqual(original.effects);
    expect(s().officialHolidays).toHaveLength(1);
  });

  it("round-trips portal data (requests, payroll…) and merges without duplicates", async () => {
    usePortalStore.getState().reset();
    usePortalStore.getState().upsert("announcements", { id: "a1", title: "إعلان", body: "نص", createdAt: "x" });
    usePortalStore.getState().upsert("requests", { id: "r1", code: "REQ-001", employeeCode: "1", type: "mission", date: "2026-03-02", status: "pending", source: "employee", chain: [], comments: [], createdAt: "x", updatedAt: "x" });
    usePortalStore.getState().nextRequestCode();
    const payload = await readBackupFile(await createBackupBlob(payloadNow()));
    usePortalStore.getState().reset();
    await restoreBackup(payload, { mode: "replace", modules: ["portal"] });
    expect(usePortalStore.getState().announcements).toHaveLength(1);
    expect(usePortalStore.getState().counters.request).toBe(1);
    await restoreBackup(payload, { mode: "merge", modules: ["portal"] });
    expect(usePortalStore.getState().requests).toHaveLength(1);
  });

  it("encrypts with a password and refuses a wrong/missing one", async () => {
    await seed();
    const blob = await createBackupBlob(payloadNow(), "s3cret!");
    await expect(readBackupFile(blob)).rejects.toBeInstanceOf(BackupPasswordRequiredError);
    await expect(readBackupFile(blob, "wrong")).rejects.toThrow(/كلمة المرور/);
    const payload = await readBackupFile(blob, "s3cret!");
    expect(payload.modules.employees).toHaveLength(1);
    // the national id must not be readable in the encrypted file
    const raw = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    expect(raw).not.toContain("29001010101010");
  });

  it("merge mode never creates duplicates or id collisions", async () => {
    await seed();
    const payload = await readBackupFile(await createBackupBlob(payloadNow()));
    await restoreBackup(payload, { mode: "merge", modules: ALL });
    await restoreBackup(payload, { mode: "merge", modules: ALL });
    expect(s().employees).toHaveLength(1);
    expect(s().punches).toHaveLength(2);
    expect(s().officialHolidays).toHaveLength(1);
    expect(useEffectsStore.getState().effects).toHaveLength(1);
    const ids = s().attendanceRecords.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects malformed files with a clear message instead of corrupting data", async () => {
    await expect(readBackupFile(new Blob([new Uint8Array([1, 2, 3, 4])]))).rejects.toThrow();
    const noMeta = zipSync({ "employees.json": strToU8("[]") });
    await expect(readBackupFile(new Blob([noMeta as BlobPart]))).rejects.toThrow(/meta\.json/);
    const bad = zipSync({
      "meta.json": strToU8(JSON.stringify({ schemaVersion: 2, createdAt: "x", selectedModules: [], recordCounts: {} })),
      "employees.json": strToU8(JSON.stringify([{ nope: true }])),
    });
    await expect(readBackupFile(new Blob([bad as BlobPart]))).rejects.toThrow(/غير صالحة/);
    const future = zipSync({ "meta.json": strToU8(JSON.stringify({ schemaVersion: 99 })) });
    await expect(readBackupFile(new Blob([future as BlobPart]))).rejects.toThrow(/أحدث/);
  });

  it("reads OLD v1 backups: real instants are converted to the right Cairo wall-clock (winter and DST)", async () => {
    const v1 = zipSync({
      "meta.json": strToU8(JSON.stringify({ schemaVersion: 1, createdAt: "2026-01-01T00:00:00Z", appVersion: "1", selectedModules: ["punches"], recordCounts: {} })),
      "punches.json": strToU8(JSON.stringify([
        { id: 1, employeeCode: "1", punchDatetime: "2025-12-10T07:00:00.000Z" }, // 09:00 Cairo (UTC+2)
        { id: 2, employeeCode: "1", punchDatetime: "2026-07-13T06:00:00.000Z" }, // 09:00 Cairo (UTC+3)
      ])),
    });
    const payload = await readBackupFile(new Blob([v1 as BlobPart]));
    await restoreBackup(payload, { mode: "replace", modules: ["punches"] });
    expect(s().punches.map((p) => p.punchDatetime.toISOString().slice(11, 16))).toEqual(["09:00", "09:00"]);
  });
});
