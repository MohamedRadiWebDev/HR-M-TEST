"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageFrame } from "@/components/portal/PageFrame";
import { DataTable } from "@/components/portal/DataTable";
import { FormDialog } from "@/components/portal/FormDialog";
import { assignCustody } from "@/portal/actions";
import { todayIso } from "@/lib/dateInput";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { addDaysIso } from "@shared/wallclock";
import { CUSTODY_LABEL } from "@/views/portal/PortalMisc";

export default function HrAssets() {
  const [open, setOpen] = useState(false);
  const employees = useAttendanceStore((s) => s.employees);
  const custody = usePortalStore((s) => s.custody);
  const documents = usePortalStore((s) => s.documents);
  const required = usePortalStore((s) => s.settings.requiredDocuments);
  const patch = usePortalStore((s) => s.patch);
  const nameOf = (code: string) => employees.find((e) => normalizeEmployeeCode(e.code) === normalizeEmployeeCode(code))?.nameAr ?? code;

  const matrix = employees.map((e) => {
    const have = documents.filter((d) => normalizeEmployeeCode(d.employeeCode) === normalizeEmployeeCode(e.code));
    return { e, missing: required.filter((t) => !have.some((d) => d.type === t)) };
  });
  const soon = addDaysIso(todayIso(), 30);
  const expiring = documents.filter((d) => d.expiry && d.expiry <= soon);

  return (
    <PageFrame title="العهد والمستندات">
      <Tabs defaultValue="custody" dir="rtl">
        <TabsList><TabsTrigger value="custody">العهد</TabsTrigger><TabsTrigger value="documents">المستندات</TabsTrigger></TabsList>
        <TabsContent value="custody" className="space-y-3 pt-4">
          <Button onClick={() => setOpen(true)}>+ تسليم عهدة</Button>
          <DataTable rows={custody} rowKey={(c) => c.id} empty="لا توجد عهد." columns={[
            { header: "الموظف", cell: (c) => nameOf(c.employeeCode) }, { header: "العهدة", cell: (c) => c.name }, { header: "الرقم التسلسلي", cell: (c) => c.serial || "-" },
            { header: "الحالة", cell: (c) => CUSTODY_LABEL[c.status] },
            { header: "", cell: (c) => (c.status === "active" || c.status === "pending") ? (<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => patch("custody", c.id, { status: "returned" })}>تم الاستلام منه</Button><Button size="sm" variant="outline" onClick={() => patch("custody", c.id, { status: "lost" })}>مفقودة</Button></div>) : null },
          ]} />
        </TabsContent>
        <TabsContent value="documents" className="space-y-4 pt-4">
          {expiring.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">مستندات تنتهي خلال 30 يومًا: {expiring.map((d) => `${nameOf(d.employeeCode)} (${d.type} - ${d.expiry})`).join("، ")}</div>}
          <DataTable rows={matrix} rowKey={(r) => r.e.code} columns={[
            { header: "الموظف", cell: (r) => r.e.nameAr }, { header: "الكود", cell: (r) => r.e.code },
            { header: "المسوغات", cell: (r) => (r.missing.length === 0 ? <span className="text-emerald-600">مكتملة</span> : <span className="text-red-600">ناقص: {r.missing.join("، ")}</span>) },
          ]} />
        </TabsContent>
      </Tabs>
      <FormDialog open={open} onOpenChange={setOpen} title="تسليم عهدة" fields={[
        { name: "code", label: "الموظف", type: "select", required: true, options: employees.map((e) => ({ value: e.code, label: `${e.nameAr} (${e.code})` })) },
        { name: "name", label: "العهدة", required: true }, { name: "serial", label: "الرقم التسلسلي" },
      ]} onSubmit={(v) => assignCustody(v.code, v.name, v.serial || undefined)} />
    </PageFrame>
  );
}
