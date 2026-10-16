"use client";

import { useState } from "react";
import { Link } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalPage } from "@/components/portal/PageFrame";
import { NewRequestDialog } from "@/components/portal/NewRequestDialog";
import { RequestStatusBadge, requestSummary } from "@/components/portal/RequestParts";
import { resolveShiftForDate } from "@/engine/attendanceEngine";
import { leaveBalance } from "@/portal/balances";
import { todayIso } from "@/lib/dateInput";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { wallDateKey, wallTime } from "@shared/wallclock";

function Dashboard({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const employee = useAttendanceStore((s) => s.employees.find((e) => e.code === code))!;
  const rules = useAttendanceStore((s) => s.rules);
  const punches = useAttendanceStore((s) => s.punches);
  const holidays = useAttendanceStore((s) => s.officialHolidays);
  const requests = usePortalStore((s) => s.requests);
  const custody = usePortalStore((s) => s.custody);
  const settings = usePortalStore((s) => s.settings);

  const today = todayIso();
  const shift = resolveShiftForDate({ employee, dateStr: today, rules });
  const todayPunches = punches
    .filter((p) => normalizeEmployeeCode(p.employeeCode) === normalizeEmployeeCode(code) && wallDateKey(p.punchDatetime) === today)
    .sort((a, b) => a.punchDatetime.getTime() - b.punchDatetime.getTime());
  const mine = requests.filter((r) => normalizeEmployeeCode(r.employeeCode) === normalizeEmployeeCode(code)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const balance = leaveBalance({ employeeCode: code, year: new Date().getFullYear(), requests, settings, holidays: new Set(holidays.map((h) => h.date)) });
  const activeCustody = custody.filter((c) => normalizeEmployeeCode(c.employeeCode) === normalizeEmployeeCode(code) && c.status === "active").length;
  const hour = new Date().getHours();

  return (
    <>
      <div className="rounded-2xl bg-blue-600 p-6 text-white">
        <div className="text-2xl font-bold">{hour < 12 ? "صباح الخير" : "مساء الخير"}، {employee.nameAr} 👋</div>
        <div className="mt-1 text-sm opacity-90">ورديتك اليوم: {shift.shiftStart} – {shift.shiftEnd}</div>
        <div className="mt-4 inline-block rounded-xl bg-white/15 px-4 py-2 text-sm">
          بصمة الحضور اليوم: <strong>{todayPunches[0] ? wallTime(todayPunches[0].punchDatetime) : "لم تُسجَّل بعد"}</strong>
          {todayPunches.length > 1 && <> • آخر بصمة: <strong>{wallTime(todayPunches[todayPunches.length - 1].punchDatetime)}</strong></>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>أرصدة إجازاتي</CardTitle><Link href="/portal/leaves" className="text-sm text-primary">التفاصيل</Link></CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-2xl font-bold">{balance.remaining}</div><div className="text-xs text-muted-foreground">المتبقي</div></div>
              <div><div className="text-2xl font-bold">{balance.used}</div><div className="text-xs text-muted-foreground">المستهلك</div></div>
              <div><div className="text-2xl font-bold">{balance.pending}</div><div className="text-xs text-muted-foreground">قيد المراجعة</div></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between"><CardTitle>عهدي</CardTitle><Link href="/portal/custody" className="text-sm text-primary">عرض الكل</Link></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{activeCustody ? `${activeCustody} عهدة نشطة` : "لا توجد عهد في عهدتك حاليًا"}</CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>طلباتي</CardTitle>
            <Button size="sm" onClick={() => setOpen(true)}>+ طلب جديد</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {mine.length === 0 && <div className="text-sm text-muted-foreground">لم تقدّم طلبات بعد.</div>}
            {mine.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg bg-muted/40 p-3 text-sm">
                <div><div className="font-medium">{requestSummary(r)}</div><div className="text-xs text-muted-foreground">{r.code}</div></div>
                <RequestStatusBadge status={r.status} />
              </div>
            ))}
            {mine.length > 5 && <Link href="/portal/requests" className="text-sm text-primary">عرض كل الطلبات</Link>}
          </CardContent>
        </Card>
      </div>
      <NewRequestDialog open={open} onOpenChange={setOpen} employeeCode={code} />
    </>
  );
}

export default function PortalDashboard() {
  return <PortalPage title="لوحتي">{(code) => <Dashboard code={code} />}</PortalPage>;
}
