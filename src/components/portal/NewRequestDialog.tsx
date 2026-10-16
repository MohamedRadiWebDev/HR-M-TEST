"use client";

import { REQUEST_TYPES, type PortalRequest, type RequestType } from "@shared/portal";
import { submitRequest, resubmitRequest } from "@/portal/actions";
import { useToast } from "@/hooks/use-toast";
import { FormDialog, type Field } from "./FormDialog";

const TYPE_OPTIONS = (Object.keys(REQUEST_TYPES) as RequestType[]).map((value) => ({ value, label: REQUEST_TYPES[value].label }));

const fields = (allowedTypes?: RequestType[]): Field[] => [
  { name: "type", label: "نوع الطلب", type: "select", options: allowedTypes ? TYPE_OPTIONS.filter((o) => allowedTypes.includes(o.value as RequestType)) : TYPE_OPTIONS, required: true },
  { name: "date", label: "التاريخ", type: "date", required: true },
  { name: "endDate", label: "إلى تاريخ (اختياري)", type: "date", when: (v) => REQUEST_TYPES[v.type as RequestType]?.multiDay === true },
  { name: "fromTime", label: "من الساعة", type: "time", required: true, when: (v) => REQUEST_TYPES[v.type as RequestType]?.needsTimes === true },
  { name: "toTime", label: "إلى الساعة", type: "time", required: true, when: (v) => REQUEST_TYPES[v.type as RequestType]?.needsTimes === true && v.type !== "punch_correction" },
  { name: "hours", label: "عدد الساعات", type: "number", required: true, when: (v) => REQUEST_TYPES[v.type as RequestType]?.needsHours === true },
  { name: "reason", label: "السبب / ملاحظات", type: "textarea" },
];

/** Create a new request, or (when `editing` is given) fix a returned one and send it again. */
export function NewRequestDialog({
  open, onOpenChange, employeeCode, editing, allowedTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeCode: string;
  editing?: PortalRequest | null;
  allowedTypes?: RequestType[];
}) {
  const { toast } = useToast();
  const initial = editing
    ? { type: editing.type, date: editing.date, endDate: editing.endDate ?? "", fromTime: editing.fromTime ?? "", toTime: editing.toTime ?? "", hours: String(editing.hours ?? ""), reason: editing.reason ?? "" }
    : undefined;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `تعديل الطلب ${editing.code} وإعادة إرساله` : "طلب جديد"}
      submitLabel={editing ? "إعادة الإرسال" : "إرسال الطلب"}
      fields={fields(allowedTypes)}
      initial={initial}
      onSubmit={(v) => {
        const patch = {
          type: v.type as RequestType, date: v.date, endDate: v.endDate || undefined, fromTime: v.fromTime || undefined,
          toTime: v.toTime || undefined, hours: v.hours ? Number(v.hours) : undefined, reason: v.reason || undefined,
        };
        if (editing) resubmitRequest(editing.id, patch);
        else submitRequest({ employeeCode, ...patch });
        toast({ title: editing ? "تمت إعادة الإرسال" : "تم إرسال الطلب", description: "سيصلك إشعار عند اتخاذ إجراء." });
      }}
    />
  );
}
