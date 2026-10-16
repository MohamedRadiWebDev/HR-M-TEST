import { create } from "zustand";
import { DEFAULT_PAYROLL_START_DAY, payrollPeriodContaining } from "@shared/payroll-period";
import { todayIso } from "@/lib/dateInput";

const START_KEY = "attendanceStartDate";
const END_KEY = "attendanceEndDate";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const read = (key: string) => {
  try {
    const value = localStorage.getItem(key);
    return value && ISO.test(value) ? value : null;
  } catch {
    return null;
  }
};

type DateRangeState = {
  start: string;
  end: string;
  setRange: (start: string, end: string) => void;
};

/** One shared date range for Attendance / Dashboard / Import (persisted as two tiny preferences). */
export const useDateRange = create<DateRangeState>((set) => {
  const period = payrollPeriodContaining(todayIso(), DEFAULT_PAYROLL_START_DAY);
  return {
    start: read(START_KEY) ?? period.start,
    end: read(END_KEY) ?? period.end,
    setRange: (start, end) => {
      try {
        localStorage.setItem(START_KEY, start);
        localStorage.setItem(END_KEY, end);
      } catch {
        // preference only
      }
      set({ start, end });
    },
  };
});
