"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDateRange } from "@/hooks/use-date-range";
import { todayIso } from "@/lib/dateInput";
import { useAttendanceStore } from "@/store/attendanceStore";
import { payrollPeriodContaining, recentPayrollPeriods, shiftPayrollPeriod } from "@shared/payroll-period";

const CUSTOM = "custom";

/** Picks a whole payroll month (e.g. 24 Sep → 23 Oct) with previous/next arrows. */
export function PayrollPeriodPicker() {
  const { start, end, setRange } = useDateRange();
  const startDay = useAttendanceStore((s) => s.config.payrollMonthStartDay);

  const periods = recentPayrollPeriods(todayIso(), startDay, 18);
  const selected = periods.find((p) => p.start === start && p.end === end);

  const go = (delta: number) => {
    const base = selected ?? payrollPeriodContaining(end, startDay);
    const next = shiftPayrollPeriod(base, delta, startDay);
    setRange(next.start, next.end);
  };

  return (
    <div className="flex items-center gap-1" dir="rtl">
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="الشهر السابق" onClick={() => go(-1)}>
        <ChevronRight className="w-4 h-4" />
      </Button>
      <Select
        value={selected ? `${selected.year}-${selected.month}` : CUSTOM}
        onValueChange={(value) => {
          const period = periods.find((p) => `${p.year}-${p.month}` === value);
          if (period) setRange(period.start, period.end);
        }}
      >
        <SelectTrigger className="h-8 w-[150px] border-none bg-transparent">
          <SelectValue placeholder="شهر الرواتب" />
        </SelectTrigger>
        <SelectContent>
          {!selected && <SelectItem value={CUSTOM} disabled>فترة مخصصة</SelectItem>}
          {periods.map((p) => (
            <SelectItem key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
              رواتب {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="الشهر التالي" onClick={() => go(1)}>
        <ChevronLeft className="w-4 h-4" />
      </Button>
    </div>
  );
}
