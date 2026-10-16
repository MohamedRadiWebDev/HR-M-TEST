/** Domain types + constants of the employee portal (all stored locally for now). */

export type RequestType =
  | "leave_annual" | "leave_unpaid" | "permission_morning" | "permission_evening"
  | "half_day" | "mission" | "absence_excuse" | "overtime" | "punch_correction";

export type RequestTypeMeta = {
  label: string;
  /** Effect type written to the attendance engine on approval (null = handled specially). */
  effect: string | null;
  multiDay?: boolean;
  needsTimes?: boolean;
  needsHours?: boolean;
};

export const REQUEST_TYPES: Record<RequestType, RequestTypeMeta> = {
  leave_annual: { label: "إجازة من الرصيد", effect: "إجازة من الرصيد", multiDay: true },
  leave_unpaid: { label: "إجازة بالخصم", effect: "إجازة بالخصم", multiDay: true },
  permission_morning: { label: "إذن صباحي", effect: "إذن صباحي", needsTimes: true },
  permission_evening: { label: "إذن مسائي", effect: "إذن مسائي", needsTimes: true },
  half_day: { label: "إجازة نص يوم", effect: "إجازة نص يوم" },
  mission: { label: "مأمورية", effect: "مأمورية", needsTimes: true },
  absence_excuse: { label: "غياب بعذر", effect: "غياب بعذر" },
  overtime: { label: "عمل إضافي", effect: null, needsHours: true },
  punch_correction: { label: "تصحيح بصمة", effect: null, needsTimes: true },
};

export type RequestStatus = "pending" | "approved" | "rejected" | "returned" | "cancelled";
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "قيد المراجعة", approved: "مكتمل", rejected: "مرفوض", returned: "مرجّع إليّ", cancelled: "ملغي",
};

export type ApprovalStep = {
  level: number;
  role: "manager" | "hr";
  approverCode: string | null;
  label: string;
  status: "waiting" | "approved" | "rejected" | "returned";
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
};

export type RequestComment = { at: string; by: string; text: string };

export type PortalRequest = {
  id: string;
  code: string;
  employeeCode: string;
  type: RequestType;
  date: string;
  endDate?: string;
  fromTime?: string;
  toTime?: string;
  hours?: number;
  reason?: string;
  status: RequestStatus;
  source: "employee" | "auto" | "hr";
  chain: ApprovalStep[];
  comments: RequestComment[];
  createdAt: string;
  updatedAt: string;
};

export type PortalNotification = {
  id: string; employeeCode: string; title: string; body?: string; link?: string; createdAt: string; read: boolean;
};

export type SalaryProfile = {
  id: string; employeeCode: string;
  basic: number; housing: number; transport: number; phone: number; nature: number; other: number; pressure: number;
  bank?: string; iban?: string;
};

export type PayslipLine = { label: string; amount: number };
export type Payslip = {
  id: string; employeeCode: string; periodKey: string; periodLabel: string; start: string; end: string;
  gross: number; earnings: PayslipLine[]; deductions: PayslipLine[]; net: number;
  attendanceDays: number; status: "draft" | "published"; createdAt: string;
};

export type LoanInstallment = { n: number; periodKey: string; amount: number; status: "due" | "paid" };
export type Loan = {
  id: string; employeeCode: string; amount: number; installments: number; reason?: string;
  status: "requested" | "approved" | "rejected" | "closed"; schedule: LoanInstallment[]; createdAt: string;
};

export type Bonus = { id: string; employeeCode: string; amount: number; periodKey: string; reason: string; createdAt: string };

export type DeductionStatus = "notified" | "objected" | "upheld" | "cancelled";
export type DeductionItem = {
  id: string; employeeCode: string; amount: number; periodKey: string; reason: string; category: string;
  status: DeductionStatus; objection?: string; resolution?: string; createdAt: string;
};

export type CustodyStatus = "pending" | "active" | "returned" | "lost";
export type CustodyItem = {
  id: string; employeeCode: string; name: string; serial?: string; status: CustodyStatus; assignedAt: string; note?: string;
};

export type EmployeeDocument = {
  id: string; employeeCode: string; type: string; name: string; expiry?: string; dataUrl?: string; uploadedAt: string;
};

export type Announcement = { id: string; title: string; body: string; createdAt: string };

export type SurveyQuestion = { id: string; text: string; kind: "rating" | "text" | "choice"; options?: string[] };
export type Survey = { id: string; title: string; anonymous: boolean; open: boolean; questions: SurveyQuestion[]; createdAt: string };
export type SurveyResponse = {
  id: string; surveyId: string;
  /** Anonymous surveys keep only a one-way key (to block double answers), never the employee code. */
  respondent: string; answers: Record<string, string | number>; createdAt: string;
};

export type PortalSettings = {
  annualLeaveDays: number;
  leaveQuotaOverrides: Record<string, number>;
  overtimeMultiplier: number;
  payrollDaysBase: number;
  requiredDocuments: string[];
};

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  annualLeaveDays: 21,
  leaveQuotaOverrides: {},
  overtimeMultiplier: 1.35,
  payrollDaysBase: 30,
  requiredDocuments: ["عقد عمل", "جواز سفر", "هوية وطنية / رقم قومي", "صورة شخصية رسمية"],
};
