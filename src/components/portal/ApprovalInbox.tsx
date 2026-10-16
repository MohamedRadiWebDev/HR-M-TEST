"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { REQUEST_TYPES, type PortalRequest } from "@shared/portal";
import { decideRequest } from "@/portal/actions";
import { canAct, currentStep, type Actor, type Decision } from "@/portal/approvals";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { FormDialog } from "./FormDialog";
import { ApprovalChainView, RequestStatusBadge, requestSummary } from "./RequestParts";

/**
 * Requests waiting for `actor` (a manager, or HR) with approve / return / reject.
 * `scope="mine"` shows only what is on the actor's own step; HR passes `scope="all"`.
 */
export function ApprovalInbox({ actor, scope }: { actor: Actor; scope: "mine" | "all" }) {
  const { toast } = useToast();
  const requests = usePortalStore((s) => s.requests);
  const employees = useAttendanceStore((s) => s.employees);
  const [pending, setPending] = useState<{ request: PortalRequest; decision: Decision } | null>(null);

  const nameOf = (code: string) => employees.find((e) => normalizeEmployeeCode(e.code) === normalizeEmployeeCode(code))?.nameAr ?? code;
  const actionable = requests.filter((r) => canAct(r, actor) && (scope === "all" || currentStep(r)?.approverCode === actor.code));
  const history = requests
    .filter((r) => r.status !== "pending" && r.chain.some((s) => s.decidedBy && (scope === "all" || s.approverCode === actor.code)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 15);

  const run = async (request: PortalRequest, decision: Decision, comment: string) => {
    try {
      const { outcome } = await decideRequest(request.id, actor, decision, comment);
      toast({ title: outcome === "approved" ? "تم الاعتماد النهائي وتطبيقه على الحضور" : "تم تسجيل قرارك" });
    } catch (error) {
      toast({ title: "تعذر تنفيذ الإجراء", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const Card = ({ r, withActions }: { r: PortalRequest; withActions: boolean }) => (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{nameOf(r.employeeCode)} <span className="text-xs text-muted-foreground">({r.code})</span></div>
        <RequestStatusBadge status={r.status} />
      </div>
      <div className="text-sm">{requestSummary(r)}</div>
      {r.reason && <div className="text-xs text-muted-foreground">السبب: {r.reason}</div>}
      <ApprovalChainView request={r} />
      {r.comments.map((c, i) => (<div key={i} className="text-xs text-muted-foreground">💬 {c.by}: {c.text}</div>))}
      {withActions && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => run(r, "approve", "")}>اعتماد</Button>
          <Button size="sm" variant="outline" onClick={() => setPending({ request: r, decision: "return" })}>إرجاع للاستكمال</Button>
          <Button size="sm" variant="destructive" onClick={() => setPending({ request: r, decision: "reject" })}>رفض</Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-bold">بانتظار قرارك ({actionable.length})</h3>
        {actionable.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">لا توجد طلبات بانتظارك.</div> : actionable.map((r) => <Card key={r.id} r={r} withActions />)}
      </section>
      {history.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-bold">آخر القرارات</h3>
          {history.map((r) => <Card key={r.id} r={r} withActions={false} />)}
        </section>
      )}
      <FormDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.decision === "reject" ? "سبب الرفض" : "ما المطلوب استكماله؟"}
        fields={[{ name: "comment", label: "التعليق", type: "textarea", required: true, placeholder: pending?.decision === "reject" ? "اكتب سبب الرفض" : "اكتب المطلوب من الموظف" }]}
        onSubmit={(v) => run(pending!.request, pending!.decision, v.comment)}
      />
    </div>
  );
}

export { REQUEST_TYPES };
