"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { PortalPage } from "@/components/portal/PageFrame";
import { NewRequestDialog } from "@/components/portal/NewRequestDialog";
import { ApprovalChainView, RequestStatusBadge, requestSummary } from "@/components/portal/RequestParts";
import { cancelRequest } from "@/portal/actions";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { REQUEST_STATUS_LABEL, type PortalRequest, type RequestStatus } from "@shared/portal";
import { cn } from "@/lib/utils";

function Requests({ code }: { code: string }) {
  const { toast } = useToast();
  const requests = usePortalStore((s) => s.requests);
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PortalRequest | null>(null);

  const mine = requests.filter((r) => normalizeEmployeeCode(r.employeeCode) === normalizeEmployeeCode(code)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shown = mine.filter((r) => (filter === "all" || r.status === filter) && (!search || requestSummary(r).includes(search) || r.code.toLowerCase().includes(search.toLowerCase())));
  const count = (s: RequestStatus | "all") => (s === "all" ? mine.length : mine.filter((r) => r.status === s).length);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={() => { setEditing(null); setOpen(true); }}>+ طلب جديد</Button>
        <div className="flex flex-wrap gap-2">
          {(["all", "pending", "approved", "rejected", "returned", "cancelled"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={cn("rounded-full border px-3 py-1 text-sm", filter === s ? "bg-primary text-primary-foreground" : "bg-card")}>
              {s === "all" ? "الكل" : REQUEST_STATUS_LABEL[s]} ({count(s)})
            </button>
          ))}
        </div>
      </div>
      <Input placeholder="بحث برقم الطلب أو النوع…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      {shown.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">لا توجد طلبات.</div>}
      {shown.map((r) => (
        <div key={r.id} className="space-y-2 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{requestSummary(r)}</div>
            <RequestStatusBadge status={r.status} />
          </div>
          <div className="text-xs text-muted-foreground">{r.code} • {r.createdAt.slice(0, 10)}{r.source === "auto" ? " • مكتشف تلقائيًا من البصمة" : ""}</div>
          {r.reason && <div className="text-sm">{r.reason}</div>}
          <ApprovalChainView request={r} />
          {r.comments.map((c, i) => (<div key={i} className="text-xs text-muted-foreground">💬 {c.by}: {c.text}</div>))}
          <div className="flex gap-2">
            {r.status === "returned" && <Button size="sm" onClick={() => { setEditing(r); setOpen(true); }}>تعديل وإعادة الإرسال</Button>}
            {(r.status === "pending" || r.status === "returned") && (
              <Button size="sm" variant="outline" onClick={() => { try { cancelRequest(r.id, code); } catch (e) { toast({ title: "تعذر الإلغاء", description: String(e instanceof Error ? e.message : e), variant: "destructive" }); } }}>إلغاء الطلب</Button>
            )}
          </div>
        </div>
      ))}
      <NewRequestDialog open={open} onOpenChange={setOpen} employeeCode={code} editing={editing} />
    </>
  );
}

export default function PortalRequests() {
  return <PortalPage title="طلباتي">{(code) => <Requests code={code} />}</PortalPage>;
}
