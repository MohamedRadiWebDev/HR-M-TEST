"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PortalPage } from "@/components/portal/PageFrame";
import { DataTable } from "@/components/portal/DataTable";
import { NewRequestDialog } from "@/components/portal/NewRequestDialog";
import { RequestStatusBadge } from "@/components/portal/RequestParts";
import { leaveBalance } from "@/portal/balances";
import { countLeaveDays } from "@/portal/requestEffects";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { REQUEST_TYPES, type PortalRequest } from "@shared/portal";

const LEAVE_TYPES = ["leave_annual", "leave_unpaid", "half_day", "absence_excuse"] as const;

function Leaves({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const requests = usePortalStore((s) => s.requests);
  const settings = usePortalStore((s) => s.settings);
  const holidays = new Set(useAttendanceStore((s) => s.officialHolidays).map((h) => h.date));
  const year = new Date().getFullYear();
  const balance = leaveBalance({ employeeCode: code, year, requests, settings, holidays });
  const mine = requests.filter((r) => normalizeEmployeeCode(r.employeeCode) === normalizeEmployeeCode(code) && (LEAVE_TYPES as readonly string[]).includes(r.type));

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">رصيد الإجازة السنوية لعام {year} (يُحسب من الطلبات المعتمدة).</p>
        <Button onClick={() => setOpen(true)}>+ طلب إجازة</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {[["الاستحقاق", balance.quota], ["المستهلك", balance.used], ["قيد المراجعة", balance.pending], ["المتبقي", balance.remaining]].map(([label, value]) => (
          <Card key={label as string}><CardContent className="p-5 text-center"><div className="text-3xl font-bold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></CardContent></Card>
        ))}
      </div>
      <DataTable<PortalRequest>
        rows={mine}
        rowKey={(r) => r.id}
        empty="لم تقدّم طلبات إجازة بعد."
        columns={[
          { header: "الطلب", cell: (r) => r.code },
          { header: "النوع", cell: (r) => REQUEST_TYPES[r.type].label },
          { header: "من", cell: (r) => r.date },
          { header: "إلى", cell: (r) => r.endDate ?? r.date },
          { header: "الأيام", cell: (r) => countLeaveDays(r, holidays) },
          { header: "الحالة", cell: (r) => <RequestStatusBadge status={r.status} /> },
        ]}
      />
      <NewRequestDialog open={open} onOpenChange={setOpen} employeeCode={code} allowedTypes={[...LEAVE_TYPES]} />
    </>
  );
}

export default function PortalLeaves() {
  return <PortalPage title="إجازاتي وأرصدتي">{(code) => <Leaves code={code} />}</PortalPage>;
}
