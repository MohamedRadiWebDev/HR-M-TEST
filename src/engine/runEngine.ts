import type { AttendanceRecord } from "@shared/schema";
import { processAttendanceRecords, type ProcessAttendanceParams } from "./attendanceEngine";

/** Serializable version of the engine params (a Map cannot be posted to a worker as-is). */
export type EngineJob = Omit<ProcessAttendanceParams, "workedOnOfficialHolidayOverrides"> & {
  overrides?: [string, boolean][];
};

export const runEngineSync = (job: EngineJob): AttendanceRecord[] => {
  const { overrides, ...rest } = job;
  return processAttendanceRecords({
    ...rest,
    workedOnOfficialHolidayOverrides: overrides ? new Map(overrides) : undefined,
  });
};

type Pending = { resolve: (rows: AttendanceRecord[]) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let workerBroken = false;
let nextJobId = 1;
const pending = new Map<number, Pending>();

const getWorker = (): Worker | null => {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; records?: AttendanceRecord[]; error?: string }>) => {
      const { id, records, error } = event.data;
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(records ?? []);
    };
    worker.onerror = () => {
      // The worker itself failed to load/run: fall back to the main thread for this and future jobs.
      workerBroken = true;
      worker?.terminate();
      worker = null;
      const jobs = Array.from(pending.values());
      pending.clear();
      jobs.forEach((job) => job.reject(new Error("WORKER_FAILED")));
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
};

/**
 * Runs the attendance engine off the UI thread (Web Worker) so large imports do not freeze the page.
 * Falls back to the main thread when workers are unavailable (tests, very old browsers).
 */
export const runEngine = async (job: EngineJob): Promise<AttendanceRecord[]> => {
  const activeWorker = getWorker();
  if (!activeWorker) return runEngineSync(job);

  try {
    return await new Promise<AttendanceRecord[]>((resolve, reject) => {
      const id = nextJobId++;
      pending.set(id, { resolve, reject });
      activeWorker.postMessage({ id, job });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "WORKER_FAILED") return runEngineSync(job);
    throw error;
  }
};
