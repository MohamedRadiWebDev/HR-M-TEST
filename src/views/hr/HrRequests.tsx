"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageFrame } from "@/components/portal/PageFrame";
import { ApprovalInbox } from "@/components/portal/ApprovalInbox";
import { DataTable } from "@/components/portal/DataTable";
import { FormDialog } from "@/components/portal/FormDialog";
import { NewRequestDialog } from "@/components/portal/NewRequestDialog";
import { RequestStatusBadge, requestSummary } from "@/components/portal/RequestParts";
import { useToast } from "@/hooks/use-toast";
import { runOvertimeDetection } from "@/portal/actions";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { REQUEST_STATUS_LABEL, type PortalRequest, type RequestStatus } from "@shared/portal";

export default function HrRequests() {
  const { toast } = useToast();
  const requests = usePortalStore((s) => s.requests);
  const employees = useAttendanceStore((s) => s.employees);
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  const [pick, setPick] = useState(false);
  const [onBehalf, setOnBehalf] = useState<string | null>(null);
  const nameOf = (code: string) => employees.find((e) => normalizeEmployeeCode(e.code) === normalizeEmployeeCode(code))?.nameAr ?? code;
  const rows = [...requests].filter((r) => filter === "all" || r.status === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <PageFrame title="طلبات الموظفين">
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => { const n = runOvertimeDetection(); toast({ title: n ? `تم إنشاء ${n} طلب إضافي من البصمة` : "لا يوجد إضافي جديد", description: n ? "الإضافي لا يُصرف إلا بعد الاعتماد." : undefined }); }}>
          اكتشاف الإضافي من البصمة
        </Button>
        <Button variant="outline" onClick={() => setPick(true)}>+ طلب نيابة عن موظف</Button>
      </div>
      <Tabs defaultValue="inbox" dir="rtl">
        <TabsList><TabsTrigger value="inbox">بانتظار الموارد البشرية</TabsTrigger><TabsTrigger value="all">كل الطلبات ({requests.length})</TabsTrigger></TabsList>
        <TabsContent value="inbox" className="pt-4"><ApprovalInbox actor={{ isHr: true, name: "الموارد البشرية" }} scope="all" /></TabsContent>
        <TabsContent value="all" className="space-y-3 pt-4">
          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "approved", "rejected", "returned", "cancelled"] as const).map((s) => (
              <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>{s === "all" ? "الكل" : REQUEST_STATUS_LABEL[s]}</Button>
            ))}
          </div>
          <DataTable<PortalRequest>
            rows={rows}
            rowKey={(r) => r.id}
            empty="لا توجد طلبات."
            columns={[
              { header: "الطلب", cell: (r) => r.code }, { header: "الموظف", cell: (r) => nameOf(r.employeeCode) },
              { header: "التفاصيل", cell: (r) => requestSummary(r) }, { header: "المصدر", cell: (r) => (r.source === "auto" ? "تلقائي" : r.source === "hr" ? "HR" : "موظف") },
              { header: "الحالة", cell: (r) => <RequestStatusBadge status={r.status} /> },
            ]}
          />
        </TabsContent>
      </Tabs>
      <FormDialog
        open={pick}
        onOpenChange={setPick}
        title="اختر الموظف"
        fields={[{ name: "code", label: "الموظف", type: "select", required: true, options: employees.map((e) => ({ value: e.code, label: `${e.nameAr} (${e.code})` })) }]}
        submitLabel="متابعة"
        onSubmit={(v) => setOnBehalf(v.code)}
      />
      {onBehalf && <NewRequestDialog open onOpenChange={(o) => !o && setOnBehalf(null)} employeeCode={onBehalf} />}
    </PageFrame>
  );
}
