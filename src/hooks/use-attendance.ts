import { useMemo } from "react";
import { useAttendanceStore, type AttendanceStoreState } from "@/store/attendanceStore";
import type { AttendanceRecord } from "@shared/schema";
import { filterAttendanceRecords } from "@/features/attendance/attendance-page-utils";
import { monthRangeIso } from "@/lib/dateInput";
import { useStoreMutation } from "@/hooks/use-store-mutation";

type AttendanceQuery = {
  data: AttendanceRecord[];
  total: number;
  page: number;
  limit: number;
};

export function useAttendanceRecords(
  startDate?: string,
  endDate?: string,
  employeeCode?: string,
  page: number = 1,
  limit: number = 0,
  useDefaultRange: boolean = true
) {
  const attendanceRecords = useAttendanceStore((state: AttendanceStoreState) => state.attendanceRecords);

  const data = useMemo<AttendanceQuery>(() => {
    const month = monthRangeIso();
    const effectiveStart = useDefaultRange ? startDate || month.start : startDate;
    const effectiveEnd = useDefaultRange ? endDate || month.end : endDate;
    const filtered = filterAttendanceRecords(attendanceRecords, effectiveStart, effectiveEnd, employeeCode);
    const sorted = filtered.sort((a, b) => (a.date === b.date ? (b.id ?? 0) - (a.id ?? 0) : b.date.localeCompare(a.date)));

    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const offset = safeLimit > 0 ? (safePage - 1) * safeLimit : 0;
    return {
      data: safeLimit > 0 ? sorted.slice(offset, offset + safeLimit) : sorted,
      total: sorted.length,
      page: safePage,
      limit: safeLimit,
    };
  }, [attendanceRecords, startDate, endDate, employeeCode, page, limit, useDefaultRange]);

  return { data, isLoading: false };
}

export function useProcessAttendance() {
  const processAttendance = useAttendanceStore((state: AttendanceStoreState) => state.processAttendance);
  return useStoreMutation(processAttendance);
}

export function useImportPunches() {
  const importPunches = useAttendanceStore((state: AttendanceStoreState) => state.importPunches);
  return useStoreMutation(importPunches);
}

export function useUpdateAttendanceRecord() {
  const updateAttendanceRecord = useAttendanceStore((state: AttendanceStoreState) => state.updateAttendanceRecord);
  return useStoreMutation<{ id: number; updates: Partial<AttendanceRecord> }, void>(({ id, updates }) => {
    updateAttendanceRecord(id, updates);
  });
}
