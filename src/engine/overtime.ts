import { ENGINE_CONFIG } from "./config";
import { timeStringToSeconds } from "./time";

export const computeOvertimeHours = ({
  shiftEnd,
  checkOutSeconds,
}: {
  shiftEnd: string;
  checkOutSeconds: number | null;
}) => {
  if (checkOutSeconds === null) return 0;
  const shiftEndSeconds = timeStringToSeconds(shiftEnd);
  const overtimeStartSeconds = shiftEndSeconds + ENGINE_CONFIG.overtimeStartAfterShiftHours * 3600;
  if (checkOutSeconds <= overtimeStartSeconds) return 0;
  const eligibleMinutes = Math.floor((checkOutSeconds - overtimeStartSeconds) / 60);
  return Math.floor(eligibleMinutes / 60);
};

