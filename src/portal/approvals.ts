import type { Employee } from "@shared/schema";
import { normalizeEmployeeCode } from "@shared/employee-code";
import type { ApprovalStep, PortalRequest } from "@shared/portal";

const norm = (v?: string | null) => String(v ?? "").trim().toLowerCase();

/** Finds a manager written either as an employee code or as the manager's Arabic name. */
export const findManager = (employee: Employee | undefined, employees: Employee[]): Employee | undefined => {
  const ref = norm(employee?.directManager);
  if (!ref) return undefined;
  return employees.find(
    (e) => e.code !== employee?.code && (norm(normalizeEmployeeCode(e.code)) === norm(normalizeEmployeeCode(ref)) || norm(e.nameAr) === ref)
  );
};

/** Direct manager → manager's manager → HR (the chain shown in the reference screens). */
export const buildApprovalChain = (employee: Employee | undefined, employees: Employee[]): ApprovalStep[] => {
  const steps: ApprovalStep[] = [];
  const seen = new Set<string>([employee?.code ?? ""]);
  let cursor = findManager(employee, employees);
  for (let level = 1; cursor && level <= 2 && !seen.has(cursor.code); level++) {
    seen.add(cursor.code);
    steps.push({ level, role: "manager", approverCode: cursor.code, label: level === 1 ? "المدير المباشر" : "مدير المدير المباشر", status: "waiting" });
    cursor = findManager(cursor, employees);
  }
  steps.push({ level: steps.length + 1, role: "hr", approverCode: null, label: "الموارد البشرية", status: "waiting" });
  return steps;
};

export type Actor = { code?: string; isHr: boolean; name?: string };

export const currentStep = (request: PortalRequest): ApprovalStep | undefined =>
  request.status === "pending" ? request.chain.find((s) => s.status === "waiting") : undefined;

/** HR can act on any waiting step (override); a manager only on a step assigned to them. */
export const canAct = (request: PortalRequest, actor: Actor): boolean => {
  const step = currentStep(request);
  if (!step) return false;
  if (actor.isHr) return true;
  return step.role === "manager" && !!actor.code && normalizeEmployeeCode(step.approverCode ?? "") === normalizeEmployeeCode(actor.code);
};

export type Decision = "approve" | "reject" | "return";

export const decide = (
  request: PortalRequest,
  actor: Actor,
  decision: Decision,
  comment: string | undefined,
  now = new Date().toISOString()
): { request: PortalRequest; outcome: "approved" | "rejected" | "returned" | "advanced" } => {
  const step = currentStep(request);
  if (!step || !canAct(request, actor)) throw new Error("لا يمكنك اتخاذ إجراء على هذا الطلب.");
  const by = actor.name || actor.code || "HR";

  const chain = request.chain.map((s) =>
    s === step
      ? { ...s, status: decision === "approve" ? ("approved" as const) : decision === "reject" ? ("rejected" as const) : ("returned" as const), decidedBy: by, decidedAt: now, comment }
      : s
  );
  const comments = comment ? [...request.comments, { at: now, by, text: comment }] : request.comments;
  const remaining = chain.some((s) => s.status === "waiting");

  const status = decision === "reject" ? "rejected" : decision === "return" ? "returned" : remaining ? "pending" : "approved";
  const outcome = decision === "reject" ? "rejected" : decision === "return" ? "returned" : remaining ? "advanced" : "approved";
  return { request: { ...request, chain, comments, status, updatedAt: now }, outcome };
};

/** After "returned": the employee fixes the request and sends it again from step 1. */
export const resubmit = (request: PortalRequest, patch: Partial<PortalRequest>, now = new Date().toISOString()): PortalRequest => ({
  ...request,
  ...patch,
  status: "pending",
  chain: request.chain.map((s) => ({ ...s, status: "waiting", decidedBy: undefined, decidedAt: undefined, comment: undefined })),
  updatedAt: now,
});
