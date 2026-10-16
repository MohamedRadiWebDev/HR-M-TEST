import { useEffect, useMemo, useState } from "react";
import { useSearch } from "@/lib/nav";
import { normalizeEmployeeCode } from "@shared/employee-code";
import type { Adjustment, AttendanceRecord } from "@shared/schema";
import { buildAttendanceExportRows } from "@/exporters/attendanceExport";
import { useDateRange } from "@/hooks/use-date-range";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsStore, type Effect } from "@/store/effectsStore";
import { classifyRecord, dayKey } from "./attendance-page-utils";

export type AttendanceTab = "detail" | "exceptions" | "summary";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const readPageSize = () => {
  try {
    const n = Number(localStorage.getItem("attendancePageSize") ?? 50);
    return Number.isFinite(n) && n >= 0 ? n : 50;
  } catch {
    return 50;
  }
};

/** All derived data of the attendance screen in one place (filters → tab → pagination → summary). */
export function useAttendanceView() {
  const { start, end, setRange } = useDateRange();
  const search = useSearch();
  const [employeeFilter, setEmployeeFilter] = useState("");

  // Deep link: /attendance?startDate=2026-03-01&endDate=2026-03-31
  useEffect(() => {
    const params = new URLSearchParams(search);
    const employee = params.get("employee");
    if (employee) setEmployeeFilter(employee);
    const s = params.get("startDate");
    const e = params.get("endDate");
    if (s && e && ISO.test(s) && ISO.test(e) && (s !== start || e !== end)) setRange(s, e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const [sectorFilter, setSectorFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<AttendanceTab>("detail");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(readPageSize);

  const employees = useAttendanceStore((s) => s.employees);
  const punches = useAttendanceStore((s) => s.punches);
  const rules = useAttendanceStore((s) => s.rules);
  const adjustmentsAll = useAttendanceStore((s) => s.adjustments);
  const attendanceRecords = useAttendanceStore((s) => s.attendanceRecords);
  const effects = useEffectsStore((s) => s.effects);

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    try {
      localStorage.setItem("attendancePageSize", String(size));
    } catch {
      // preference only
    }
  };

  const employeesByCode = useMemo(() => new Map(employees.map((e) => [normalizeEmployeeCode(e.code), e])), [employees]);
  const sectors = useMemo(() => Array.from(new Set(employees.map((e) => e.sector).filter(Boolean) as string[])), [employees]);

  /** Date + employee + sector filters over ALL records (independent of pagination). */
  const allFiltered = useMemo(() => {
    const codes = employeeFilter
      ? new Set(employeeFilter.split(/[,،\s]+/).map((c) => normalizeEmployeeCode(c)).filter(Boolean))
      : null;
    return attendanceRecords
      .filter((r) => {
        if (start && r.date < start) return false;
        if (end && r.date > end) return false;
        const code = normalizeEmployeeCode(r.employeeCode);
        if (codes && codes.size > 0 && !codes.has(code)) return false;
        if (sectorFilter !== "all" && employeesByCode.get(code)?.sector !== sectorFilter) return false;
        return true;
      })
      .sort((a, b) => (a.date === b.date ? (b.id ?? 0) - (a.id ?? 0) : b.date.localeCompare(a.date)));
  }, [attendanceRecords, start, end, employeeFilter, sectorFilter, employeesByCode]);

  const tabRecords = useMemo(
    () =>
      activeTab === "exceptions"
        ? allFiltered.filter((r) => {
            const f = classifyRecord(r);
            return f.hasPenalty || f.absent || f.late || f.earlyLeave || f.missingStamp;
          })
        : allFiltered,
    [allFiltered, activeTab]
  );

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(tabRecords.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages);
  const pageRecords = useMemo(
    () => (pageSize > 0 ? tabRecords.slice((safePage - 1) * pageSize, safePage * pageSize) : tabRecords),
    [tabRecords, pageSize, safePage]
  );

  useEffect(() => setPage(1), [start, end, employeeFilter, sectorFilter, activeTab, pageSize]);

  const summaryTable = useMemo(
    () =>
      activeTab === "summary" && start && end
        ? buildAttendanceExportRows({ records: allFiltered, employees, reportStartDate: start, reportEndDate: end })
        : null,
    [activeTab, allFiltered, employees, start, end]
  );

  const adjustmentsByKey = useMemo(() => {
    const map = new Map<string, Adjustment[]>();
    adjustmentsAll.forEach((adj) => {
      if ((start && adj.date < start) || (end && adj.date > end)) return;
      const key = dayKey(adj.employeeCode, adj.date);
      const list = map.get(key);
      if (list) list.push(adj);
      else map.set(key, [adj]);
    });
    return map;
  }, [adjustmentsAll, start, end]);

  const effectsByKey = useMemo(() => {
    const map = new Map<string, Effect[]>();
    effects.forEach((effect) => {
      const key = dayKey(effect.employeeCode, effect.date);
      const list = map.get(key);
      if (list) list.push(effect);
      else map.set(key, [effect]);
    });
    return map;
  }, [effects]);

  const effectsInPeriod = useMemo(
    () => (start && end ? effects.filter((e) => e.date >= start && e.date <= end).length : 0),
    [effects, start, end]
  );

  return {
    start, end, setRange,
    employeeFilter, setEmployeeFilter,
    sectorFilter, setSectorFilter, sectors,
    activeTab, setActiveTab,
    page: safePage, setPage, pageSize, setPageSize, totalPages,
    employees, employeesByCode, punches, rules, effects,
    allFiltered, tabRecords, pageRecords: pageRecords as AttendanceRecord[], summaryTable,
    adjustmentsByKey, effectsByKey, effectsInPeriod,
  };
}
