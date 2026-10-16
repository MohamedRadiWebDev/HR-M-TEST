import { describe, expect, it, vi } from "vitest";
import { runEngine, runEngineSync, type EngineJob } from "@/engine/runEngine";
import { parseWallIso } from "@shared/wallclock";
import type { Employee } from "@shared/schema";

const employee = { id: 1, code: "1", nameAr: "x", shiftStart: "09:00" } as Employee;
const job = (): EngineJob => ({
  employees: [employee],
  punches: [
    { id: 1, employeeCode: "1", punchDatetime: parseWallIso("2026-03-02T09:00:00")! },
    { id: 2, employeeCode: "1", punchDatetime: parseWallIso("2026-03-02T17:00:00")! },
  ],
  startDate: "2026-03-02",
  endDate: "2026-03-02",
  overrides: [],
});

describe("engine runner", () => {
  it("falls back to the main thread when Web Workers are unavailable", async () => {
    const records = await runEngine(job());
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("Present");
  });

  it("the worker entry point answers a job message with records (and errors as messages)", async () => {
    const posted: unknown[] = [];
    (globalThis as any).self = { postMessage: (m: unknown) => posted.push(m) };
    await import("@/engine/engine.worker");
    const handler = (globalThis as any).self.onmessage as (e: { data: unknown }) => void;

    handler({ data: { id: 7, job: job() } });
    expect(posted[0]).toMatchObject({ id: 7 });
    expect((posted[0] as { records: unknown[] }).records).toHaveLength(1);

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    handler({ data: { id: 8, job: null } });
    expect(posted[1]).toMatchObject({ id: 8 });
    expect(typeof (posted[1] as { error: string }).error).toBe("string");
    spy.mockRestore();
    expect(runEngineSync(job())).toHaveLength(1);
  });
});
