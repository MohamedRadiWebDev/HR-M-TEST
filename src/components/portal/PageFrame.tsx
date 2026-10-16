"use client";

import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { Card, CardContent } from "@/components/ui/card";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useViewAs } from "@/store/viewAsStore";

export function PageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6" dir="rtl">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Employee-portal page: needs a "viewed as" employee (local-mode substitute for logging in). */
export function PortalPage({ title, children }: { title: string; children: (employeeCode: string) => ReactNode }) {
  const mode = useViewAs((s) => s.mode);
  const code = useViewAs((s) => s.employeeCode);
  const employees = useAttendanceStore((s) => s.employees);
  const viewAsEmployee = useViewAs((s) => s.viewAsEmployee);
  const employee = employees.find((e) => e.code === code);

  return (
    <PageFrame title={title}>
      {mode !== "employee" || !employee ? (
        <Card>
          <CardContent className="p-8 space-y-4">
            <p className="font-semibold">هذه صفحات الموظف. اختر موظفًا لتعرض البوابة كأنك هو:</p>
            {employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا يوجد موظفون بعد. استورد الموظفين من «استيراد بيانات».</p>
            ) : (
              <select className="h-10 rounded-md border border-input bg-background px-3" defaultValue="" onChange={(e) => e.target.value && viewAsEmployee(e.target.value)}>
                <option value="" disabled>اختر موظفًا…</option>
                {employees.map((e) => (<option key={e.id} value={e.code}>{e.nameAr} ({e.code})</option>))}
              </select>
            )}
          </CardContent>
        </Card>
      ) : (
        children(employee.code)
      )}
    </PageFrame>
  );
}
