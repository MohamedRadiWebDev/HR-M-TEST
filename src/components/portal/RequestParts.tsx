"use client";

import { Check, ChevronLeft, X } from "lucide-react";
import { REQUEST_STATUS_LABEL, REQUEST_TYPES, type PortalRequest, type RequestStatus } from "@shared/portal";
import { cn } from "@/lib/utils";

const COLORS: Record<RequestStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  returned: "bg-orange-100 text-orange-800",
  cancelled: "bg-slate-100 text-slate-600",
};

export const RequestStatusBadge = ({ status }: { status: RequestStatus }) => (
  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", COLORS[status])}>{REQUEST_STATUS_LABEL[status]}</span>
);

/** المدير المباشر › مدير المدير › الموارد البشرية */
export const ApprovalChainView = ({ request }: { request: PortalRequest }) => (
  <div className="flex flex-wrap items-center gap-1 text-xs">
    <span className="text-muted-foreground">سلسلة الاعتماد:</span>
    {request.chain.map((step, i) => (
      <span key={step.level} className="flex items-center gap-1">
        {i > 0 && <ChevronLeft className="w-3 h-3 text-muted-foreground" />}
        <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 border",
          step.status === "approved" && "border-emerald-300 bg-emerald-50 text-emerald-700",
          step.status === "rejected" && "border-red-300 bg-red-50 text-red-700",
          step.status === "returned" && "border-orange-300 bg-orange-50 text-orange-700")}>
          {step.status === "approved" && <Check className="w-3 h-3" />}
          {step.status === "rejected" && <X className="w-3 h-3" />}
          {step.label}
        </span>
      </span>
    ))}
  </div>
);

export const requestSummary = (r: PortalRequest) => {
  const meta = REQUEST_TYPES[r.type];
  const parts = [r.endDate && r.endDate !== r.date ? `${r.date} → ${r.endDate}` : r.date];
  if (r.fromTime) parts.push(r.toTime ? `${r.fromTime}–${r.toTime}` : r.fromTime);
  if (r.hours) parts.push(`${r.hours} ساعة`);
  return `${meta.label} • ${parts.join(" • ")}`;
};
