"use client";

import { Eye } from "lucide-react";
import { useLocation } from "@/lib/nav";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useViewAs } from "@/store/viewAsStore";

/** Local-mode role switch: "HR" or "as employee X". Real accounts replace this later. */
export function ViewAsSwitcher() {
  const { mode, employeeCode, viewAsHr, viewAsEmployee } = useViewAs();
  const employees = useAttendanceStore((s) => s.employees);
  const [, navigate] = useLocation();
  const value = mode === "hr" ? "hr" : `emp:${employeeCode}`;

  return (
    <label className="flex items-center gap-2 text-sm" title="وضع محلي للتجربة: بدون حسابات حقيقية">
      <Eye className="w-4 h-4 text-muted-foreground" />
      <select
        className="h-9 max-w-[220px] rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => {
          if (e.target.value === "hr") {
            viewAsHr();
            navigate("/");
          } else {
            viewAsEmployee(e.target.value.slice(4));
            navigate("/portal");
          }
        }}
      >
        <option value="hr">عرض كـ: الموارد البشرية</option>
        {employees.map((e) => (
          <option key={e.id} value={`emp:${e.code}`}>
            عرض كـ: {e.nameAr} ({e.code})
          </option>
        ))}
      </select>
    </label>
  );
}
