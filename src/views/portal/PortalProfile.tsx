"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalPage } from "@/components/portal/PageFrame";
import { FormDialog } from "@/components/portal/FormDialog";
import { SensitiveValue } from "@/components/SensitiveValue";
import { useToast } from "@/hooks/use-toast";
import { grossOf } from "@/portal/payroll";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { diffDaysIso } from "@shared/wallclock";
import { todayIso } from "@/lib/dateInput";
import { normalizeEmployeeCode } from "@shared/employee-code";
import type { ReactNode } from "react";

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-center justify-between border-b py-2 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><span className="font-medium">{children || "-"}</span></div>
);

const tenure = (hire?: string | null) => {
  if (!hire) return "-";
  const days = diffDaysIso(hire, todayIso());
  if (days < 0) return "-";
  const months = Math.floor(days / 30.44);
  return months >= 12 ? `${Math.floor(months / 12)} سنة ${months % 12 ? `و ${months % 12} شهر` : ""}` : `${months} أشهر`;
};

function Profile({ code }: { code: string }) {
  const { toast } = useToast();
  const [edit, setEdit] = useState(false);
  const employee = useAttendanceStore((s) => s.employees.find((e) => e.code === code))!;
  const updateEmployee = useAttendanceStore((s) => s.updateEmployee);
  const salary = usePortalStore((s) => s.salaryProfiles.find((p) => normalizeEmployeeCode(p.employeeCode) === normalizeEmployeeCode(code)));

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-bold text-white">{employee.nameAr.slice(0, 1)}</div>
            <div>
              <div className="text-xl font-bold">{employee.nameAr}</div>
              <div className="text-sm text-muted-foreground">{employee.jobTitle || "—"} • {employee.branch || "—"}</div>
            </div>
          </div>
          <div className="flex gap-6 text-center text-sm">
            <div><div className="font-bold">{employee.code}</div><div className="text-muted-foreground">الرقم الوظيفي</div></div>
            <div><div className="font-bold">{employee.hireDate || "—"}</div><div className="text-muted-foreground">تاريخ الالتحاق</div></div>
            <div><div className="font-bold">{tenure(employee.hireDate)}</div><div className="text-muted-foreground">مدة الخدمة</div></div>
            <div><div className="font-bold">{employee.terminationDate ? "منتهي" : "نشط"}</div><div className="text-muted-foreground">الحالة</div></div>
          </div>
          <Button onClick={() => setEdit(true)}>تعديل بيانات التواصل</Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>البيانات الشخصية</CardTitle></CardHeader>
          <CardContent>
            <Row label="الاسم الكامل">{employee.nameAr}</Row>
            <Row label="رقم الهوية"><SensitiveValue value={employee.nationalId} visibleTail={4} /></Row>
            <Row label="تاريخ الميلاد">{employee.birthDate}</Row>
            <Row label="الجوال"><SensitiveValue value={employee.personalPhone} visibleTail={3} /></Row>
            <Row label="هاتف الطوارئ"><SensitiveValue value={employee.emergencyPhone} visibleTail={3} /></Row>
            <Row label="العنوان"><SensitiveValue value={employee.address} /></Row>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>المعلومات الوظيفية</CardTitle></CardHeader>
          <CardContent>
            <Row label="المسمى الوظيفي">{employee.jobTitle}</Row>
            <Row label="الفرع">{employee.branch}</Row>
            <Row label="القطاع">{employee.sector}</Row>
            <Row label="القسم">{employee.section || employee.department}</Row>
            <Row label="المدير المباشر">{employee.directManager}</Row>
            <Row label="بداية الوردية">{employee.shiftStart}</Row>
          </CardContent>
        </Card>
        {salary && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>الراتب</CardTitle></CardHeader>
            <CardContent className="grid gap-x-8 sm:grid-cols-2">
              <Row label="الراتب الأساسي">{salary.basic.toLocaleString("ar-EG")}</Row>
              <Row label="بدل السكن">{salary.housing.toLocaleString("ar-EG")}</Row>
              <Row label="بدل النقل">{salary.transport.toLocaleString("ar-EG")}</Row>
              <Row label="بدل الهاتف">{salary.phone.toLocaleString("ar-EG")}</Row>
              <Row label="بدل طبيعة العمل">{salary.nature.toLocaleString("ar-EG")}</Row>
              <Row label="بدلات أخرى">{salary.other.toLocaleString("ar-EG")}</Row>
              <Row label="بدل ضغط العمل">{salary.pressure.toLocaleString("ar-EG")}</Row>
              <Row label="إجمالي الراتب"><strong>{grossOf(salary).toLocaleString("ar-EG")}</strong></Row>
              <Row label="البنك">{salary.bank}</Row>
              <Row label="الآيبان"><SensitiveValue value={salary.iban} visibleTail={4} /></Row>
            </CardContent>
          </Card>
        )}
      </div>

      <FormDialog
        open={edit}
        onOpenChange={setEdit}
        title="تعديل بيانات التواصل"
        initial={{ personalPhone: employee.personalPhone ?? "", emergencyPhone: employee.emergencyPhone ?? "", address: employee.address ?? "" }}
        fields={[
          { name: "personalPhone", label: "الجوال" },
          { name: "emergencyPhone", label: "هاتف الطوارئ" },
          { name: "address", label: "العنوان", type: "textarea" },
        ]}
        onSubmit={(v) => {
          updateEmployee(employee.id, { personalPhone: v.personalPhone || null, emergencyPhone: v.emergencyPhone || null, address: v.address || null });
          toast({ title: "تم الحفظ" });
        }}
      />
    </>
  );
}

export default function PortalProfile() {
  return <PortalPage title="ملفي الشخصي">{(code) => <Profile code={code} />}</PortalPage>;
}
