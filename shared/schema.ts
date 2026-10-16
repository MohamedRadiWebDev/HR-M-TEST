import { z } from "zod";

/**
 * Domain model shared by the whole app.
 *
 * The project is frontend-only, so there is no ORM here: plain Zod schemas are the single
 * source of truth for both runtime validation and TypeScript types.
 */

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------
export const LEAVE_TYPES = ["annual", "sick", "unpaid", "mission", "permission"] as const;
export const ADJUSTMENT_TYPES = [
  "اذن صباحي",
  "اذن مسائي",
  "إجازة نص يوم",
  "مأمورية",
  "إجازة بالخصم",
  "غياب بعذر",
  "إجازة من الرصيد",
  "إجازة بدل",
] as const;
export const RULE_TYPES = [
  "custom_shift",
  "attendance_exempt",
  "penalty_override",
  "ignore_biometric",
  "overtime_overnight",
  "overnight_stay",
] as const;

export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];
export type RuleType = (typeof RULE_TYPES)[number];

// ---------------------------------------------------------------------------------------------
// Row schemas (what is stored)
// ---------------------------------------------------------------------------------------------
const nullableText = z.string().nullable();

export const employeeSchema = z.object({
  id: z.number().int(),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  sector: nullableText,
  department: nullableText,
  section: nullableText,
  jobTitle: nullableText,
  branch: nullableText,
  governorate: nullableText,
  hireDate: nullableText,
  terminationDate: nullableText,
  terminationReason: nullableText,
  serviceDuration: nullableText,
  directManager: nullableText,
  deptManager: nullableText,
  nationalId: nullableText,
  birthDate: nullableText,
  address: nullableText,
  birthPlace: nullableText,
  personalPhone: nullableText,
  emergencyPhone: nullableText,
  shiftStart: nullableText,
});

/**
 * A biometric punch. `punchDatetime` is a **floating wall-clock** value: its UTC fields hold the
 * local time shown by the biometric device (see `client/src/lib/wallclock.ts`). This makes results
 * independent of the browser time zone and of Egypt's daylight-saving changes.
 */
export const punchSchema = z.object({
  id: z.number().int(),
  employeeCode: z.string().min(1),
  punchDatetime: z.date(),
});

export const templateSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  type: z.string().min(1),
  mapping: z.unknown(),
});

export const ruleSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  priority: z.number().int().nullable(),
  scope: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  ruleType: z.enum(RULE_TYPES),
  params: z.unknown(),
});

export const adjustmentSchema = z.object({
  id: z.number().int(),
  employeeCode: z.string().min(1),
  date: z.string().min(1),
  type: z.enum(ADJUSTMENT_TYPES),
  fromTime: z.string(),
  toTime: z.string(),
  source: z.string().min(1),
  sourceFileName: nullableText,
  importedAt: z.date().nullable(),
  note: nullableText,
});

export const penaltySchema = z
  .object({ type: z.string(), value: z.number() })
  .passthrough();
export type PenaltyEntry = z.infer<typeof penaltySchema>;

export const attendanceRecordSchema = z.object({
  id: z.number().int(),
  employeeCode: z.string().min(1),
  date: z.string().min(1),
  checkIn: z.date().nullable(),
  checkOut: z.date().nullable(),
  totalHours: z.number().nullable(),
  overtimeHours: z.number().nullable(),
  status: nullableText,
  penalties: z.array(penaltySchema).nullable(),
  isOvernight: z.boolean().nullable(),
  notes: nullableText,
  missionStart: nullableText,
  missionEnd: nullableText,
  halfDayExcused: z.boolean().nullable(),
  isOfficialHoliday: z.boolean().nullable(),
  workedOnOfficialHoliday: z.boolean().nullable(),
  compDayCredit: z.number().nullable(),
  leaveDeductionDays: z.number().nullable(),
  excusedAbsenceDays: z.number().nullable(),
  terminationPeriodDays: z.number().nullable(),
  compDaysFriday: z.number().nullable(),
  compDaysOfficial: z.number().nullable(),
  compDaysTotal: z.number().nullable(),
  compDaysUsed: z.number().nullable(),
});

export const leaveSchema = z.object({
  id: z.number().int(),
  type: z.string().min(1),
  scope: z.string().min(1),
  scopeValue: nullableText,
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  note: nullableText,
  createdAt: z.date().nullable(),
  /** Set to "effects" for leaves that were generated from the Effects page. */
  source: nullableText.optional(),
});

export const officialHolidaySchema = z.object({
  id: z.number().int(),
  date: z.string().min(1),
  name: z.string().min(1),
});

// ---------------------------------------------------------------------------------------------
// Insert schemas (what forms / imports send)
// ---------------------------------------------------------------------------------------------
const omitId = { id: true } as const;

export const insertEmployeeSchema = employeeSchema.omit(omitId).partial({
  sector: true, department: true, section: true, jobTitle: true, branch: true, governorate: true,
  hireDate: true, terminationDate: true, terminationReason: true, serviceDuration: true,
  directManager: true, deptManager: true, nationalId: true, birthDate: true, address: true,
  birthPlace: true, personalPhone: true, emergencyPhone: true, shiftStart: true,
});
export const insertPunchSchema = punchSchema.omit(omitId);
export const insertTemplateSchema = templateSchema.omit(omitId);
export const insertRuleSchema = ruleSchema.omit(omitId).partial({ priority: true });
export const insertAdjustmentSchema = adjustmentSchema
  .omit(omitId)
  .partial({ sourceFileName: true, importedAt: true, note: true });
export const insertAttendanceSchema = attendanceRecordSchema.omit(omitId).partial();
export const insertLeaveSchema = leaveSchema
  .omit(omitId)
  .partial({ scopeValue: true, note: true, createdAt: true, source: true });
export const insertOfficialHolidaySchema = officialHolidaySchema.omit(omitId);

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------
export type Employee = z.infer<typeof employeeSchema>;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;

export type Template = z.infer<typeof templateSchema>;
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;

export type SpecialRule = z.infer<typeof ruleSchema>;
export type InsertSpecialRule = z.infer<typeof insertRuleSchema>;

export type Adjustment = z.infer<typeof adjustmentSchema>;
export type InsertAdjustment = z.infer<typeof insertAdjustmentSchema>;

export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceSchema>;

export type Leave = z.infer<typeof leaveSchema>;
export type InsertLeave = z.infer<typeof insertLeaveSchema>;

export type BiometricPunch = z.infer<typeof punchSchema>;
export type InsertBiometricPunch = z.infer<typeof insertPunchSchema>;

export type OfficialHoliday = z.infer<typeof officialHolidaySchema>;
export type InsertOfficialHoliday = z.infer<typeof insertOfficialHolidaySchema>;
