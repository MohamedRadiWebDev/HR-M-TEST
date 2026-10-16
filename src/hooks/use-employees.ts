import type { Employee, InsertEmployee } from "@shared/schema";
import { useAttendanceStore, type AttendanceStoreState } from "@/store/attendanceStore";

import { useStoreMutation } from "@/hooks/use-store-mutation";

export function useEmployees() {
  const employees = useAttendanceStore((state: AttendanceStoreState) => state.employees);
  return { data: employees, isLoading: false };
}

export function useEmployee(id: number) {
  const employee = useAttendanceStore((state: AttendanceStoreState) => state.employees.find((item) => item.id === id) ?? null);
  return { data: employee, isLoading: false };
}

export function useCreateEmployee() {
  const createEmployee = useAttendanceStore((state: AttendanceStoreState) => state.createEmployee);
  return useStoreMutation<InsertEmployee, Employee>(createEmployee);
}

export function useUpdateEmployee() {
  const updateEmployee = useAttendanceStore((state: AttendanceStoreState) => state.updateEmployee);
  return useStoreMutation<{ id: number } & Partial<InsertEmployee>, Employee | null>(({ id, ...data }) => {
    return updateEmployee(id, data);
  });
}

export function useImportEmployees() {
  const importEmployees = useAttendanceStore((state: AttendanceStoreState) => state.importEmployees);
  return useStoreMutation(importEmployees);
}
