"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PortalPage } from "@/components/portal/PageFrame";
import { PayrollPeriodPicker } from "@/components/PayrollPeriodPicker";
import { StatusBadge } from "@/features/attendance/components/StatusBadge";
import { classifyRecord } from "@/features/attendance/attendance-page-utils";
import { resolveShiftForDate } from "@/engine/attendanceEngine";
import { STATUS_AR } from "@/exporters/attendanceExport";
import { isoToDmy } from "@/lib/dateInput";
import { useDateRange } from "@/hooks/use-date-range";
import { useAttendanceStore } from "@/store/attendanceStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { isoDayOfWeek, wallTime } from "@shared/wallclock";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function Attendance({ code }: { code: string }) {
  const { start, end } = useDateRange();
  const records = useAttendanceStore((s) => s.attendanceRecords);
  const employee = useAttendanceStore((s) => s.employees.find((e) => e.code === code))!;
  const rules = useAttendanceStore((s) => s.rules);

  const mine = useMemo(
    () => records.filter((r) => normalizeEmployeeCode(r.employeeCode) === normalizeEmployeeCode(code) && r.date >= start && r.date <= end).sort((a, b) => a.date.localeCompare(b.date)),
    [records, code, start, end]
  );

  const kpis = useMemo(() => {
    const k = { present: 0, late: 0, absent: 0, early: 0, missing: 0, leave: 0, holiday: 0, mission: 0, lateMinutes: 0, hours: 0, overtime: 0 };
    mine.forEach((r) => {
      const f = classifyRecord(r);
      if (r.checkIn || r.checkOut) k.present += 1;
      if (f.late) k.late += 1;
      if (f.absent) k.absent += 1;
      if (f.earlyLeave) k.early += 1;
      if (f.missingStamp) k.missing += 1;
      if (["Leave", "Leave Deduction", "Excused Absence", "Comp Day"].includes(r.status ?? "")) k.leave += 1;
      if (r.status === "Official Holiday") k.holiday += 1;
      if (r.missionStart) k.mission += 1;
      k.hours += r.totalHours ?? 0;
      k.overtime += r.overtimeHours ?? 0;
      (r.penalties ?? []).forEach((p) => { if (p.type === "تأخير") k.lateMinutes += Number((p as { minutes?: number }).minutes ?? 0); });
    });
    return k;
  }, [mine]);

  const cards: [string, string | number][] = [
    ["أيام الحضور", kpis.present], ["أيام التأخير", kpis.late], ["غياب", kpis.absent], ["انصراف مبكر", kpis.early],
    ["سهو بصمة", kpis.missing], ["إجازات", kpis.leave], ["عطلات رسمية", kpis.holiday], ["مأمورية", kpis.mission],
    ["دقائق التأخير", kpis.lateMinutes], ["ساعات العمل", kpis.hours.toFixed(1)], ["إضافي", kpis.overtime.toFixed(1)],
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">من {isoToDmy(start)} إلى {isoToDmy(end)} — محسوبة من بصمة الحضور.</p>
        <PayrollPeriodPicker />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {cards.map(([label, value]) => (<Card key={label}><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></CardContent></Card>))}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[900px] text-sm text-right">
          <thead className="bg-muted/40 text-muted-foreground"><tr>{["اليوم", "التاريخ", "الوردية", "الحضور", "الانصراف", "الساعات", "الحالة", "الجزاءات"].map((h) => (<th key={h} className="px-4 py-3">{h}</th>))}</tr></thead>
          <tbody className="divide-y">
            {mine.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">لا توجد سجلات في هذه الفترة.</td></tr>}
            {mine.map((r) => {
              const shift = resolveShiftForDate({ employee, dateStr: r.date, rules });
              return (
                <tr key={r.id}>
                  <td className="px-4 py-3">{DAYS[isoDayOfWeek(r.date)]}</td>
                  <td className="px-4 py-3 font-mono">{r.date}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{shift.shiftStart}–{shift.shiftEnd}</td>
                  <td className="px-4 py-3 font-mono" dir="ltr">{r.checkIn ? wallTime(r.checkIn) : "-"}</td>
                  <td className="px-4 py-3 font-mono" dir="ltr">{r.checkOut ? wallTime(r.checkOut) : "-"}</td>
                  <td className="px-4 py-3">{r.totalHours?.toFixed(2) ?? "-"}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /> <span className="text-xs text-muted-foreground">{STATUS_AR[r.status ?? ""] ?? ""}</span></td>
                  <td className="px-4 py-3 text-xs">{(r.penalties ?? []).map((p) => `${p.type}: ${p.value}`).join("، ") || "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PortalAttendance() {
  return <PortalPage title="حضوري">{(code) => <Attendance code={code} />}</PortalPage>;
}
