import { normalizeEmployeeCode } from "@shared/employee-code";
import { normalizeDateToIso } from "@shared/date-normalization";
import { normalizeEffectDateKey } from "@shared/effect-normalization";
import { normalizeShiftStart } from "@shared/time-normalization";
import { addDaysIso, wallSecondsOfDay } from "@shared/wallclock";
import type {
  Adjustment,
  AdjustmentType,
  AttendanceRecord,
  BiometricPunch,
  Employee,
  Leave,
  OfficialHoliday,
  SpecialRule,
} from "@shared/schema";
import { ENGINE_CONFIG, PENALTY_TYPE, latePenaltyForMinutes } from "./config";
import { computeAdjustmentEffects } from "./adjustments";
import { applyEffectsToDailyRecord, type ImportedEffect } from "./effects";
import { appendNotes, composeDailyNotes, computeAutomaticNotes } from "./notes";
import { computePenaltyEntries } from "./penalties";
import { buildPunchConsumptionKey, filterConsumedPunches } from "./punches";
import { resolveShiftForDate } from "./shifts";
import { scopeAppliesToEmployee } from "./scope";
import { secondsToHms, timeStringToSeconds } from "./time";

// Public API (kept stable for the UI, tests and workers)
export { ADJUSTMENT_TYPES } from "@shared/schema";
export type { AdjustmentType } from "@shared/schema";
export type { AdjustmentInput } from "./adjustments";
export { computeAdjustmentEffects } from "./adjustments";
export { applyEffectsToDailyRecord, canonicalAdjustmentType, type ImportedEffect } from "./effects";
export { appendNotes, composeDailyNotes, computeAutomaticNotes } from "./notes";
export { computePenaltyEntries } from "./penalties";
export { computeOvertimeHours } from "./overtime";
export { buildPunchConsumptionKey, filterConsumedPunches } from "./punches";
export { resolveShiftForDate } from "./shifts";
export { ruleAppliesToEmployee, scopeAppliesToEmployee } from "./scope";
export { normalizeTimeToHms, secondsToHms, timeStringToSeconds } from "./time";

export type ProcessAttendanceParams = {
  employees: Employee[];
  punches: BiometricPunch[];
  rules?: SpecialRule[];
  leaves?: Leave[];
  officialHolidays?: OfficialHoliday[];
  adjustments?: Adjustment[];
  effects?: ImportedEffect[];
  startDate: string;
  endDate: string;
  timezoneOffsetMinutes?: number;
  workedOnOfficialHolidayOverrides?: Map<string, boolean>;
  employeeCodes?: string[];
  defaultPermissionMinutes?: number;
  defaultHalfDayMinutes?: number;
};

export const processAttendanceRecords = ({
  employees,
  punches,
  rules = [],
  leaves = [],
  officialHolidays = [],
  adjustments = [],
  effects = [],
  startDate,
  endDate,
  timezoneOffsetMinutes,
  workedOnOfficialHolidayOverrides,
  employeeCodes,
  defaultPermissionMinutes,
  defaultHalfDayMinutes,
}: ProcessAttendanceParams): AttendanceRecord[] => {
  const offsetMinutes = Number.isFinite(Number(timezoneOffsetMinutes))
    ? Number(timezoneOffsetMinutes)
    : 0; // punches are floating wall-clock values (see shared/wallclock.ts) → no conversion needed

  const wallTimeLabel = (date: Date) =>
    `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;

  const toLocal = (date: Date) => new Date(date.getTime() - offsetMinutes * 60 * 1000);

  const formatLocalDay = (date: Date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const normalizeDateKey = (value?: string | null) => normalizeDateToIso(value ?? "") || null;

  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);

  const searchStart = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const searchEnd = new Date(Date.UTC(endYear, endMonth - 1, endDay));

  const adjustmentsByEmployeeDate = new Map<string, Adjustment[]>();
  adjustments.forEach((adjustment) => {
    const key = `${normalizeEmployeeCode(adjustment.employeeCode)}__${normalizeEffectDateKey(adjustment.date)}`;
    const existing = adjustmentsByEmployeeDate.get(key) || [];
    existing.push(adjustment);
    adjustmentsByEmployeeDate.set(key, existing);
  });
  const effectsByEmpDate = new Map<string, ImportedEffect[]>();
  effects.forEach((effect) => {
    const key = `${normalizeEmployeeCode(effect.employeeCode)}__${normalizeEffectDateKey(effect.date)}`;
    const existing = effectsByEmpDate.get(key) || [];
    existing.push(effect);
    effectsByEmpDate.set(key, existing);
  });


  const records: AttendanceRecord[] = [];
  let recordId = 1;

  const normalizedTargets = new Set((employeeCodes || []).map((code) => normalizeEmployeeCode(code)).filter(Boolean));
  const employeesToProcess = normalizedTargets.size > 0
    ? employees.filter((employee) => normalizedTargets.has(normalizeEmployeeCode(employee.code)))
    : employees;

  // Group punches by employee ONCE (was O(employees × punches)) and index holidays by date.
  const punchesByCode = new Map<string, BiometricPunch[]>();
  for (const punch of punches) {
    const code = normalizeEmployeeCode(punch.employeeCode);
    if (!code) continue;
    const list = punchesByCode.get(code);
    if (list) list.push(punch);
    else punchesByCode.set(code, [punch]);
  }
  const holidaysByDate = new Map<string, OfficialHoliday>();
  officialHolidays.forEach((holiday) => {
    const key = normalizeDateToIso(holiday.date) || holiday.date;
    if (!holidaysByDate.has(key)) holidaysByDate.set(key, holiday);
  });

  for (const employee of employeesToProcess) {
    const normalizedEmployeeCode = normalizeEmployeeCode(employee.code);
    const punchesByDate = new Map<string, BiometricPunch[]>();
    (punchesByCode.get(normalizedEmployeeCode) || []).forEach((punch) => {
      const dateKey = formatLocalDay(toLocal(punch.punchDatetime));
      const list = punchesByDate.get(dateKey) || [];
      list.push(punch);
      punchesByDate.set(dateKey, list);
    });

    punchesByDate.forEach((list) => {
      list.sort((a, b) => a.punchDatetime.getTime() - b.punchDatetime.getTime());
    });

    const extraNotesByKey = new Map<string, string[]>();
    const addExtraNote = (key: string, note: string) => {
      const existing = extraNotesByKey.get(key) || [];
      existing.push(note);
      extraNotesByKey.set(key, existing);
    };
    const consumedPunchesByDate = new Map<string, Set<string>>();
    const markPunchConsumed = (dateKey: string, punch: BiometricPunch) => {
      const key = buildPunchConsumptionKey(punch.employeeCode, punch.punchDatetime);
      const existing = consumedPunchesByDate.get(dateKey) || new Set<string>();
      existing.add(key);
      consumedPunchesByDate.set(dateKey, existing);
    };

    const shiftStartHour = Number.parseInt(
      normalizeShiftStart(employee.shiftStart, ENGINE_CONFIG.defaultShiftStart).split(":")[0],
      10
    );
    const arrivalWindow = { start: shiftStartHour - 3, end: shiftStartHour + 3 };
    const isOvernightPunch = (date: Date) => {
      const hour = date.getUTCHours();
      return hour >= 0 && hour <= ENGINE_CONFIG.overnightMaxHour;
    };
    const isNormalArrivalPunch = (date: Date) => {
      const hour = date.getUTCHours();
      return hour >= arrivalWindow.start && hour <= arrivalWindow.end;
    };
    const isEarlyShiftEdge = (date: Date) => {
      const hour = date.getUTCHours();
      const minute = date.getUTCMinutes();
      return shiftStartHour <= 7 && (hour === 4 && minute >= 30 || hour === 5 && minute === 0);
    };
    const toUtcFromSeconds = (baseDate: Date, seconds: number) => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const shiftTimeUTC = new Date(Date.UTC(
        baseDate.getUTCFullYear(),
        baseDate.getUTCMonth(),
        baseDate.getUTCDate(),
        hours,
        minutes,
        secs
      ));
      shiftTimeUTC.setTime(shiftTimeUTC.getTime() + offsetMinutes * 60 * 1000);
      return shiftTimeUTC;
    };
    const splitScopeValues = (raw: string | null | undefined) => {
      if (!raw) return [] as string[];
      return raw
        .split(/[,،;]/g)
        .map((v) => v.trim())
        .filter(Boolean);
    };

    const matchesScope = (scope: string, value: string | null | undefined) => {
      if (scope === "all") return true;
      const values = splitScopeValues(value);
      const matchAny = (target: string | null | undefined) => {
        if (!target) return false;
        if (values.length === 0) return false;
        return values.includes(String(target));
      };

      if (scope === "sector") return matchAny(employee.sector);
      if (scope === "department") return matchAny(employee.department);
      if (scope === "section") return matchAny(employee.section);
      if (scope === "branch") return matchAny(employee.branch);
      if (scope === "emp") return matchAny(employee.code);
      return false;
    };
    // Scope filtering does not depend on the date → do it once per employee, not per day.
    const applicableLeaves = leaves
      .filter(
        (leave) =>
          !(leave.type === "collections" && employee.sector !== "التحصيل") &&
          matchesScope(leave.scope, leave.scopeValue || null)
      )
      .map((leave) => ({
        leave,
        start: normalizeDateToIso(leave.startDate) || leave.startDate,
        end: normalizeDateToIso(leave.endDate) || leave.endDate,
      }));

    // Post-midnight punches (00:00–05:59) may be the previous day's check-out.
    // State is re-read from the map on every iteration so moving one punch never uses a stale list.
    for (let d = new Date(searchStart); d <= searchEnd; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = formatLocalDay(d);
      const prevDateStr = addDaysIso(dateStr, -1);
      const overnightPunches = (punchesByDate.get(dateStr) || []).filter((punch) =>
        isOvernightPunch(toLocal(punch.punchDatetime))
      );

      for (const punch of overnightPunches) {
        const currentDay = punchesByDate.get(dateStr) || [];
        const currentPrev = punchesByDate.get(prevDateStr) || [];
        if (!currentDay.includes(punch)) continue;

        const localPunch = toLocal(punch.punchDatetime);
        const hasPrevCheckIn = currentPrev.length > 0;
        const hasPrevCheckOut = currentPrev.length > 1;
        if (!hasPrevCheckIn) continue;

        const hasNormalArrival = currentDay.some(
          (candidate) => candidate !== punch && isNormalArrivalPunch(toLocal(candidate.punchDatetime))
        );

        if (!hasPrevCheckOut && isEarlyShiftEdge(localPunch) && !hasNormalArrival) continue;

        if (!hasPrevCheckOut || hasNormalArrival) {
          punchesByDate.set(
            dateStr,
            currentDay.filter((item) => item !== punch)
          );
          punchesByDate.set(
            prevDateStr,
            [...currentPrev, punch].sort((a, b) => a.punchDatetime.getTime() - b.punchDatetime.getTime())
          );
          markPunchConsumed(dateStr, punch);
          addExtraNote(prevDateStr, `خروج بعد منتصف الليل ${wallTimeLabel(localPunch)} (${dateStr})`);
        }
      }
    }

    for (let d = new Date(searchStart); d <= searchEnd; d.setUTCDate(d.getUTCDate() + 1)) {
      const dateStr = formatLocalDay(d);
      const hireDateKey = normalizeDateKey(employee.hireDate || null);
      const isJoiningPeriod = Boolean(hireDateKey && dateStr < hireDateKey);
      const terminationDateKey = normalizeDateKey(employee.terminationDate || null);
      const isTerminationPeriod = Boolean(terminationDateKey && dateStr > terminationDateKey);
      const holidayMatch = holidaysByDate.get(dateStr);
      const isOfficialHoliday = Boolean(holidayMatch);

      const { activeRules, dayOfWeek, shiftStart: currentShiftStart, shiftEnd: currentShiftEnd } = resolveShiftForDate({
        employee,
        dateStr,
        rules,
      });
      const isFriday = dayOfWeek === 5;
      const leaveRule = activeRules.find((rule) => rule.ruleType === "attendance_exempt");
      const leaveTypeRaw = typeof (leaveRule?.params as { leaveType?: unknown } | null)?.leaveType === "string"
        ? String((leaveRule?.params as { leaveType?: unknown }).leaveType).toLowerCase()
        : "";
      const leaveCategoryFromRule = leaveRule
        ? (leaveTypeRaw === "official" ? "Official Leave" : "HR Leave")
        : null;
      const matchedLeaves = applicableLeaves
        .filter((entry) => dateStr >= entry.start && dateStr <= entry.end)
        .map((entry) => entry.leave);
      const hasOfficialLeave = matchedLeaves.some((leave) => leave.type === "official");
      const leaveCategoryFromLeave = matchedLeaves.length > 0
        ? (hasOfficialLeave ? "Official Leave" : "HR Leave")
        : null;
      const leaveNotes = matchedLeaves.map((leave) => leave.note).filter(Boolean) as string[];
      const leaveCategory = leaveCategoryFromRule || leaveCategoryFromLeave;
      const isLeaveDay = Boolean(leaveRule || matchedLeaves.length > 0);
      const hasOvernightStay = activeRules.some((rule) => rule.ruleType === "overnight_stay");

      const consumedPunches = consumedPunchesByDate.get(dateStr);
      const dayPunches = filterConsumedPunches(punchesByDate.get(dateStr) || [], consumedPunches)
        .slice()
        .sort((a, b) => a.punchDatetime.getTime() - b.punchDatetime.getTime());

      // A lone punch in the second half of the shift is a forgotten check-IN (the person left, but the
      // morning punch is missing) – not a 6-hour-late arrival.
      const firstPunch = dayPunches.length > 0 ? dayPunches[0].punchDatetime : null;
      const lastPunch = dayPunches.length > 1 ? dayPunches[dayPunches.length - 1].punchDatetime : null;
      const shiftMidpointSeconds = (timeStringToSeconds(currentShiftStart) + timeStringToSeconds(currentShiftEnd)) / 2;
      const lonePunchIsCheckOut =
        dayPunches.length === 1 && firstPunch !== null && wallSecondsOfDay(toLocal(firstPunch)) >= shiftMidpointSeconds;
      const checkIn = lonePunchIsCheckOut ? null : firstPunch;
      const checkOut = lonePunchIsCheckOut ? firstPunch : lastPunch;

      const baseDayAdjustments = adjustmentsByEmployeeDate.get(`${normalizedEmployeeCode}__${dateStr}`) || [];
      const dayEffects = effectsByEmpDate.get(`${normalizedEmployeeCode}__${dateStr}`) || [];
      const { mergedAdjustments: dayAdjustments, notes: effectNotes } = applyEffectsToDailyRecord({
        employeeCode: employee.code,
        dateStr,
        dayAdjustments: baseDayAdjustments,
        dayEffects,
        shiftStart: currentShiftStart,
        shiftEnd: currentShiftEnd,
        defaultPermissionMinutes,
        defaultHalfDayMinutes,
        punchHint: {
          firstSeconds: firstPunch ? wallSecondsOfDay(toLocal(firstPunch)) : null,
          lastSeconds: lastPunch ? wallSecondsOfDay(toLocal(lastPunch)) : null,
        },
      });
      effectNotes.forEach((note) => addExtraNote(dateStr, note));
      const leaveDeductionAdjustments = dayAdjustments.filter((adj) => adj.type === "إجازة بالخصم");
      const excusedAbsenceAdjustments = dayAdjustments.filter((adj) => adj.type === "غياب بعذر");
      const hasLeaveDeduction = leaveDeductionAdjustments.length > 0;
      const hasLeaveFromBalance = dayAdjustments.some((adj) => adj.type === "إجازة من الرصيد");
      const hasCompDayUsed = dayAdjustments.some((adj) => adj.type === "إجازة بدل");
      const hasExcusedAbsence = excusedAbsenceAdjustments.length > 0;

      if (isJoiningPeriod) {
        records.push({
          id: recordId++,
          employeeCode: employee.code,
          date: dateStr,
          checkIn: null,
          checkOut: null,
          totalHours: 0,
          status: "Joining Period",
          overtimeHours: 0,
          penalties: [],
          isOvernight: false,
          notes: null,
          missionStart: null,
          missionEnd: null,
          halfDayExcused: false,
          isOfficialHoliday: false,
          workedOnOfficialHoliday: null,
          compDayCredit: 0,
          leaveDeductionDays: 0,
          excusedAbsenceDays: 0,
          terminationPeriodDays: 0,
          compDaysFriday: 0,
          compDaysOfficial: 0,
          compDaysTotal: 0,
          compDaysUsed: 0,
        } as AttendanceRecord);
        continue;
      }

      const checkInLocal = checkIn ? toLocal(checkIn) : null;
      const checkOutLocal = checkOut ? toLocal(checkOut) : null;

      let totalHours = 0;
      if (checkInLocal && checkOutLocal) {
        totalHours = (checkOutLocal.getTime() - checkInLocal.getTime()) / (1000 * 60 * 60);
      }

      if (isTerminationPeriod) {
        const extraNotes = extraNotesByKey.get(dateStr) || [];
        records.push({
          id: recordId++,
          employeeCode: employee.code,
          date: dateStr,
          checkIn,
          checkOut,
          totalHours,
          status: "Termination Period",
          overtimeHours: 0,
          penalties: [],
          isOvernight: false,
          notes: composeDailyNotes({
            baseNotes: "فترة ترك",
            extraNotes,
            leaveNotes,
            hasOvernightStay: false,
          }),
          missionStart: null,
          missionEnd: null,
          halfDayExcused: false,
          isOfficialHoliday: false,
          workedOnOfficialHoliday: null,
          compDayCredit: 0,
          leaveDeductionDays: 1,
          excusedAbsenceDays: 0,
          terminationPeriodDays: 1,
          compDaysFriday: 0,
          compDaysOfficial: 0,
          compDaysTotal: 0,
          compDaysUsed: 0,
        } as AttendanceRecord);
        continue;
      }

      if (isOfficialHoliday) {
        const overrideKey = `${normalizedEmployeeCode}__${dateStr}`;
        const override = workedOnOfficialHolidayOverrides?.get(overrideKey);
        const hasMission = dayAdjustments.some((adj) => adj.type === "مأمورية");
        const autoWorked = Boolean(checkIn || checkOut) || totalHours > 0 || hasMission;
        const worked = override ?? autoWorked;
        const extraNotes = extraNotesByKey.get(dateStr) || [];
        const compDaysOfficial = worked ? 1 : 0;
        records.push({
          id: recordId++,
          employeeCode: employee.code,
          date: dateStr,
          checkIn,
          checkOut,
          totalHours,
          status: "Official Holiday",
          overtimeHours: 0,
          penalties: [],
          isOvernight: false,
          notes: composeDailyNotes({
            baseNotes: holidayMatch?.name || "إجازة رسمية",
            extraNotes,
            leaveNotes,
            hasOvernightStay: false,
          }),
          missionStart: null,
          missionEnd: null,
          halfDayExcused: false,
          isOfficialHoliday: true,
          workedOnOfficialHoliday: override ?? null,
          compDayCredit: worked ? 1 : 0,
          leaveDeductionDays: hasLeaveDeduction ? 1 : 0,
          excusedAbsenceDays: hasExcusedAbsence ? 1 : 0,
          terminationPeriodDays: 0,
          compDaysFriday: 0,
          compDaysOfficial,
          compDaysTotal: compDaysOfficial,
          compDaysUsed: hasCompDayUsed ? 1 : 0,
        } as AttendanceRecord);
        continue;
      }

      if (isFriday || isLeaveDay) {
        const attendedFriday =
          isFriday &&
          dayPunches.some((punch) => {
            const seconds = wallSecondsOfDay(toLocal(punch.punchDatetime));
            return (
              seconds >= ENGINE_CONFIG.fridayAttendanceWindow.startHour * 3600 &&
              seconds <= ENGINE_CONFIG.fridayAttendanceWindow.endHour * 3600
            );
          });
        const hasMission = dayAdjustments.some((adj) => adj.type === "مأمورية");
        const extraNotes = extraNotesByKey.get(dateStr) || [];
        const compDaysFriday = isFriday && (attendedFriday || hasMission) ? 1 : 0;
        records.push({
          id: recordId++,
          employeeCode: employee.code,
          date: dateStr,
          checkIn,
          checkOut,
          totalHours: isFriday ? 0 : totalHours,
          status: isFriday ? (attendedFriday ? "Friday Attended" : "Friday") : "Comp Day",
          overtimeHours: 0,
          penalties: [],
          isOvernight: false,
          notes: composeDailyNotes({
            baseNotes: isLeaveDay ? leaveCategory : null,
            extraNotes,
            leaveNotes,
            hasOvernightStay,
          }),
          missionStart: null,
          missionEnd: null,
          halfDayExcused: false,
          isOfficialHoliday: false,
          workedOnOfficialHoliday: null,
          compDayCredit: 0,
          leaveDeductionDays: hasLeaveDeduction ? 1 : 0,
          excusedAbsenceDays: hasExcusedAbsence ? 1 : 0,
          terminationPeriodDays: 0,
          compDaysFriday,
          compDaysOfficial: 0,
          compDaysTotal: compDaysFriday,
          compDaysUsed: hasCompDayUsed ? 1 : 0,
        } as AttendanceRecord);
        continue;
      }

      if (dayPunches.length > 0 || dayAdjustments.length > 0) {
        const checkInSeconds = checkInLocal
          ? checkInLocal.getUTCHours() * 3600 + checkInLocal.getUTCMinutes() * 60 + checkInLocal.getUTCSeconds()
          : null;
        const checkOutSecondsRaw = checkOutLocal
          ? checkOutLocal.getUTCHours() * 3600 + checkOutLocal.getUTCMinutes() * 60 + checkOutLocal.getUTCSeconds()
          : null;
        const checkOutSeconds = hasOvernightStay ? null : checkOutSecondsRaw;

        const adjustmentEffects = computeAdjustmentEffects({
          shiftStart: currentShiftStart,
          shiftEnd: currentShiftEnd,
          adjustments: dayAdjustments.map((adj) => ({
            type: adj.type as AdjustmentType,
            fromTime: adj.fromTime,
            toTime: adj.toTime,
          })),
          checkInSeconds,
          checkOutSeconds,
        });

        const effectiveShiftStartUTC = toUtcFromSeconds(d, adjustmentEffects.effectiveShiftStartSeconds);
        const effectiveShiftEndUTC = toUtcFromSeconds(d, adjustmentEffects.effectiveShiftEndSeconds);
        const missionStart = adjustmentEffects.missionStartSeconds !== null
          ? secondsToHms(adjustmentEffects.missionStartSeconds)
          : null;
        const missionEnd = adjustmentEffects.missionEndSeconds !== null
          ? secondsToHms(adjustmentEffects.missionEndSeconds)
          : null;

        const firstStampSeconds = adjustmentEffects.firstStampSeconds;
        const lastStampSeconds = adjustmentEffects.lastStampSeconds;
        const checkInDateTime = checkInLocal;
        const checkOutDateTime = hasOvernightStay ? null : checkOutLocal;
        if (checkInDateTime && checkOutDateTime) {
          const diffMs = checkOutDateTime.getTime() - checkInDateTime.getTime();
          totalHours = diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
        } else if (firstStampSeconds !== null && lastStampSeconds !== null) {
          const firstStampUTC = toUtcFromSeconds(d, firstStampSeconds);
          const lastStampUTC = toUtcFromSeconds(d, lastStampSeconds);
          totalHours = (lastStampUTC.getTime() - firstStampUTC.getTime()) / (1000 * 60 * 60);
        }

        const penalties: { type: string; value: number; minutes?: number }[] = [];
        let status = "Present";
        const graceMinutes = ENGINE_CONFIG.graceMinutes;
        const suppressPenalties = adjustmentEffects.suppressPenalties;
        const hasMission = adjustmentEffects.missionStartSeconds !== null && adjustmentEffects.missionEndSeconds !== null;
        const halfDayExcused = adjustmentEffects.halfDayExcused;
        const excusedByHalfDayNoPunch = halfDayExcused && !checkIn && !checkOut;
        const excusedByMission = hasMission;
        const excusedDay = excusedByHalfDayNoPunch || excusedByMission;
        const isExcusedForPenalties = excusedDay || suppressPenalties || hasOvernightStay || hasLeaveDeduction || hasLeaveFromBalance || hasCompDayUsed || hasExcusedAbsence;
        let latePenaltyValue = 0;
        let lateMinutes = 0;

        if (!isExcusedForPenalties && checkIn) {
          const diffMs = checkIn.getTime() - effectiveShiftStartUTC.getTime();
          lateMinutes = Math.max(0, Math.ceil(diffMs / (1000 * 60)));

          if (diffMs > graceMinutes * 60 * 1000) {
            status = "Late";
            latePenaltyValue = latePenaltyForMinutes(lateMinutes);
          } else {
            status = "Present";
          }
        } else if (!isExcusedForPenalties && !checkIn && !checkOut) {
          status = "Absent";
          penalties.push({ type: PENALTY_TYPE.absence, value: ENGINE_CONFIG.absencePenalty });
        }
        if (hasOvernightStay) {
          status = "Present";
        }
        if (hasLeaveDeduction) {
          status = "Leave Deduction";
        }
        if (hasLeaveFromBalance || hasCompDayUsed) {
          status = "Leave";
        }
        if (hasExcusedAbsence && !checkIn && !checkOut) {
          status = "Excused Absence";
        }

        const effectiveCheckOutForPenalties = hasOvernightStay ? null : checkOut;
        const missingCheckout = Boolean(checkIn && !effectiveCheckOutForPenalties) && !isExcusedForPenalties;
        const missingCheckin = Boolean(!checkIn && effectiveCheckOutForPenalties) && !isExcusedForPenalties;
        const earlyLeaveThreshold = effectiveShiftEndUTC.getTime() - graceMinutes * 60 * 1000;
        const earlyLeaveTriggered = Boolean(
          effectiveCheckOutForPenalties &&
          !missingCheckout &&
          !missingCheckin &&
          !isExcusedForPenalties &&
          effectiveCheckOutForPenalties.getTime() < earlyLeaveThreshold
        );

        penalties.push(
          ...computePenaltyEntries({
            isExcused: isExcusedForPenalties,
            latePenaltyValue,
            lateMinutes,
            missingCheckout,
            missingCheckin,
            earlyLeaveTriggered,
          })
        );

        if (excusedDay) {
          status = hasMission && adjustmentEffects.missionEndSeconds !== null &&
            adjustmentEffects.missionEndSeconds >= timeStringToSeconds(currentShiftEnd)
            ? "Present"
            : "Excused";
        }
        const autoNotes = computeAutomaticNotes({
          existingNotes: null,
          checkInExists: Boolean(checkIn),
          checkOutExists: Boolean(checkOut),
          missingStampExcused: excusedDay || hasOvernightStay,
          earlyLeaveExcused: excusedDay || hasOvernightStay,
          checkOutBeforeEarlyLeave: Boolean(effectiveCheckOutForPenalties && effectiveCheckOutForPenalties.getTime() < earlyLeaveThreshold),
        });

        const nextDay = new Date(d);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayShiftStartUTC = toUtcFromSeconds(nextDay, adjustmentEffects.effectiveShiftStartSeconds);
        const effectiveCheckOutDateTime = hasOvernightStay
          ? nextDayShiftStartUTC
          : checkOutDateTime;
        if (checkInDateTime && effectiveCheckOutDateTime) {
          const diffMs = effectiveCheckOutDateTime.getTime() - checkInDateTime.getTime();
          totalHours = diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
        }
        const overtimeStart = new Date(effectiveShiftEndUTC.getTime() + ENGINE_CONFIG.overtimeStartAfterShiftHours * 3600 * 1000);
        const overtimeCutoff = nextDayShiftStartUTC;
        let overtimeHours = 0;
        if (effectiveCheckOutDateTime) {
          const cappedCheckout = effectiveCheckOutDateTime.getTime() > overtimeCutoff.getTime()
            ? overtimeCutoff
            : effectiveCheckOutDateTime;
          if (cappedCheckout.getTime() > overtimeStart.getTime()) {
            const overtimeMs = cappedCheckout.getTime() - overtimeStart.getTime();
            overtimeHours = Math.floor(overtimeMs / (1000 * 60 * 60));
          }
        }

        const extraNotes = extraNotesByKey.get(dateStr) || [];
        const recordCheckOut = hasOvernightStay ? null : checkOut;
        const compDaysFriday = 0;
        const compDaysOfficial = 0;
        records.push({
          id: recordId++,
          employeeCode: employee.code,
          date: dateStr,
          checkIn,
          checkOut: recordCheckOut,
          totalHours,
          status,
          overtimeHours,
          penalties,
          isOvernight: false,
          notes: composeDailyNotes({
            baseNotes: autoNotes || null,
            extraNotes,
            leaveNotes,
            hasOvernightStay,
          }),
          missionStart,
          missionEnd,
          halfDayExcused,
          isOfficialHoliday: false,
          workedOnOfficialHoliday: null,
          compDayCredit: 0,
          leaveDeductionDays: hasLeaveDeduction ? 1 : 0,
          excusedAbsenceDays: hasExcusedAbsence ? 1 : 0,
          terminationPeriodDays: 0,
          compDaysFriday,
          compDaysOfficial,
          compDaysTotal: compDaysFriday + compDaysOfficial,
          compDaysUsed: hasCompDayUsed ? 1 : 0,
        } as AttendanceRecord);
      } else {
        const extraNotes = extraNotesByKey.get(dateStr) || [];
        const status = hasExcusedAbsence ? "Excused Absence" : hasLeaveDeduction ? "Leave Deduction" : hasLeaveFromBalance || hasCompDayUsed ? "Leave" : "Absent";
        const penalties = hasExcusedAbsence || hasLeaveDeduction || hasLeaveFromBalance || hasCompDayUsed ? [] : [{ type: PENALTY_TYPE.absence, value: ENGINE_CONFIG.absencePenalty }];
        records.push({
          id: recordId++,
          employeeCode: employee.code,
          date: dateStr,
          checkIn: null,
          checkOut: null,
          totalHours: 0,
          status,
          penalties,
          overtimeHours: 0,
          isOvernight: false,
          notes: composeDailyNotes({
            baseNotes: null,
            extraNotes,
            leaveNotes,
            hasOvernightStay,
          }),
          missionStart: null,
          missionEnd: null,
          halfDayExcused: false,
          isOfficialHoliday: false,
          workedOnOfficialHoliday: null,
          compDayCredit: 0,
          leaveDeductionDays: hasLeaveDeduction ? 1 : 0,
          excusedAbsenceDays: hasExcusedAbsence ? 1 : 0,
          terminationPeriodDays: 0,
          compDaysFriday: 0,
          compDaysOfficial: 0,
          compDaysTotal: 0,
          compDaysUsed: hasCompDayUsed ? 1 : 0,
        } as AttendanceRecord);
      }
    }
  }

  return records;
};

export const matchesRuleScope = (scope: string, employee: Employee) => scopeAppliesToEmployee(scope, employee);
