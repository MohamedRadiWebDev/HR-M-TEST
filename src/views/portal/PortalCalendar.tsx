"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PortalPage } from "@/components/portal/PageFrame";
import { leaveDates } from "@/portal/requestEffects";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { REQUEST_TYPES } from "@shared/portal";
import { isoDayOfWeek } from "@shared/wallclock";
import { cn } from "@/lib/utils";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const WEEK = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
type Kind = "holiday" | "leave" | "pending";
const STYLE: Record<Kind, string> = { holiday: "bg-red-100 text-red-700", leave: "bg-blue-100 text-blue-700", pending: "bg-amber-100 text-amber-700" };

function Calendar({ code }: { code: string }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [show, setShow] = useState<Record<Kind, boolean>>({ holiday: true, leave: true, pending: true });
  const holidays = useAttendanceStore((s) => s.officialHolidays);
  const requests = usePortalStore((s) => s.requests);

  const events = useMemo(() => {
    const map = new Map<string, { kind: Kind; label: string }[]>();
    const add = (date: string, kind: Kind, label: string) => map.set(date, [...(map.get(date) ?? []), { kind, label }]);
    holidays.forEach((h) => add(h.date, "holiday", h.name));
    const holidaySet = new Set(holidays.map((h) => h.date));
    requests
      .filter((r) => normalizeEmployeeCode(r.employeeCode) === normalizeEmployeeCode(code) && (r.status === "approved" || r.status === "pending"))
      .forEach((r) => {
        const days = REQUEST_TYPES[r.type].multiDay ? leaveDates(r, holidaySet) : [r.date];
        days.forEach((d) => add(d, r.status === "approved" ? "leave" : "pending", REQUEST_TYPES[r.type].label));
      });
    return map;
  }, [holidays, requests, code]);

  const pad = (n: number) => String(n).padStart(2, "0");
  const first = `${cursor.y}-${pad(cursor.m + 1)}-01`;
  const lead = isoDayOfWeek(first);
  const total = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => `${cursor.y}-${pad(cursor.m + 1)}-${pad(i + 1)}`)];
  const move = (delta: number) => { const d = new Date(cursor.y, cursor.m + delta, 1); setCursor({ y: d.getFullYear(), m: d.getMonth() }); };

  const monthEvents = Array.from(events.entries()).filter(([d]) => d.startsWith(`${cursor.y}-${pad(cursor.m + 1)}`));
  const count = (k: Kind) => monthEvents.filter(([, list]) => list.some((e) => e.kind === k)).length;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{count("holiday")}</div><div className="text-sm text-muted-foreground">عطلات رسمية هذا الشهر</div></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{count("leave")}</div><div className="text-sm text-muted-foreground">أيام إجازة معتمدة</div></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><div className="text-2xl font-bold">{count("pending")}</div><div className="text-sm text-muted-foreground">أيام قيد المراجعة</div></CardContent></Card>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="السابق" onClick={() => move(-1)}><ChevronRight className="h-4 w-4" /></Button>
          <div className="min-w-[140px] text-center font-bold">{MONTHS[cursor.m]} {cursor.y}</div>
          <Button variant="outline" size="icon" aria-label="التالي" onClick={() => move(1)}><ChevronLeft className="h-4 w-4" /></Button>
        </div>
        <div className="flex gap-4 text-sm">
          {([["holiday", "عطلة رسمية"], ["leave", "إجازاتي"], ["pending", "قيد المراجعة"]] as [Kind, string][]).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{label}</label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-sm">
        {WEEK.map((d) => (<div key={d} className="p-2 text-center text-xs text-muted-foreground">{d}</div>))}
        {cells.map((date, i) => (
          <div key={i} className={cn("min-h-[84px] rounded-lg border bg-card p-1.5", !date && "border-transparent bg-transparent")}>
            {date && (
              <>
                <div className={cn("text-xs", isoDayOfWeek(date) === 5 && "text-red-500")}>{Number(date.slice(8))}</div>
                {(events.get(date) ?? []).filter((e) => show[e.kind]).map((e, j) => (<div key={j} className={cn("mt-1 truncate rounded px-1 text-[10px] font-medium", STYLE[e.kind])}>{e.label}</div>))}
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default function PortalCalendar() {
  return <PortalPage title="التقويم">{(code) => <Calendar code={code} />}</PortalPage>;
}
