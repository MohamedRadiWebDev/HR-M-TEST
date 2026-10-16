import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/nav";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, Clock, AlertTriangle, CalendarCheck, Trash2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useEmployees } from "@/hooks/use-employees";
import { useDateRange } from "@/hooks/use-date-range";
import { useAttendanceStore, type AttendanceStoreState } from "@/store/attendanceStore";
import { useToast } from "@/hooks/use-toast";
import { PERSISTENCE_SAVED_EVENT, storage } from "@/data/storage";
import { summarizePenalties } from "@/engine/penalties";
import { filterAttendanceRecords } from "@/features/attendance/attendance-page-utils";
import { diffDaysIso } from "@shared/wallclock";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { isoToDmy, parseDmyInput } from "@/lib/dateInput";
import { PayrollPeriodPicker } from "@/components/PayrollPeriodPicker";

function DateField({ value, onCommit }: { value: string; onCommit: (iso: string) => void }) {
  const [text, setText] = useState(isoToDmy(value));
  useEffect(() => setText(isoToDmy(value)), [value]);
  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/yyyy"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const iso = parseDmyInput(e.target.value);
        if (iso && iso !== value) onCommit(iso);
      }}
      onBlur={() => setText(isoToDmy(value))}
      className="border-none bg-transparent h-8 w-36"
    />
  );
}

type Ranked = { name: string; code: string; value: number };

export default function Dashboard() {
  const { toast } = useToast();
  const wipeData = useAttendanceStore((state: AttendanceStoreState) => state.wipeData);
  const attendanceRecords = useAttendanceStore((state: AttendanceStoreState) => state.attendanceRecords);
  const range = useDateRange();
  const { data: allEmployees } = useEmployees();
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    setLastSavedAt(storage.lastSavedAt());
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { savedAt?: string } | undefined;
      if (detail?.savedAt) setLastSavedAt(detail.savedAt);
    };
    window.addEventListener(PERSISTENCE_SAVED_EVENT, handler);
    return () => window.removeEventListener(PERSISTENCE_SAVED_EVENT, handler);
  }, []);

  const rangeDays = range.end >= range.start ? diffDaysIso(range.start, range.end) + 1 : 0;

  const totals = useMemo(() => {
    const names = new Map(allEmployees.map((e) => [normalizeEmployeeCode(e.code), e.nameAr]));
    const records = filterAttendanceRecords(attendanceRecords, range.start, range.end);
    const acc = { late: 0, early: 0, missing: 0, absenceDays: 0 };
    const absent = new Map<string, Ranked>();
    const late = new Map<string, Ranked>();

    records.forEach((record) => {
      // Same penalty maths as the Excel export (single source of truth).
      const t = summarizePenalties(record.penalties, Number(record.excusedAbsenceDays || 0));
      acc.late += t.late;
      acc.early += t.early;
      acc.missing += t.missing;
      acc.absenceDays += t.absenceDays; // raw days here; the weighted figure is a payroll/export rule

      const code = normalizeEmployeeCode(record.employeeCode);
      const bump = (map: Map<string, Ranked>, value: number) => {
        if (value <= 0) return;
        const entry = map.get(code) ?? { code, name: names.get(code) || code, value: 0 };
        entry.value += value;
        map.set(code, entry);
      };
      bump(absent, t.absenceDays);
      bump(late, t.late);
    });

    const top = (map: Map<string, Ranked>) => Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 5);
    return { ...acc, topAbsent: top(absent), topLate: top(late) };
  }, [attendanceRecords, allEmployees, range.start, range.end]);

  const topAbsentEmployees = totals.topAbsent;
  const topLateEmployees = totals.topLate;

  const stats = [
    { title: "إجمالي الموظفين", value: allEmployees.length, icon: Users, color: "blue" as const, trend: "", trendUp: true },
    { title: "عدد أيام الفترة", value: rangeDays, icon: CalendarCheck, color: "green" as const, trend: "", trendUp: true },
    { title: "إجمالي التأخيرات", value: totals.late, icon: Clock, color: "orange" as const, trend: "", trendUp: true },
    { title: "أيام الغياب", value: totals.absenceDays, icon: AlertTriangle, color: "red" as const, trend: "", trendUp: false },
  ];

  const chartData = [
    { name: "تأخير", value: totals.late },
    { name: "انصراف مبكر", value: totals.early },
    { name: "سهو بصمة", value: totals.missing },
    { name: "غياب", value: totals.absenceDays },
  ];

  const handleClearData = async () => {
    await wipeData();
    toast({ title: "تم المسح", description: "تم مسح كافة البيانات بنجاح." });
    window.location.reload();
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="لوحة التحكم" />
        
        <main className="flex-1 overflow-y-auto p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-2xl font-bold font-display">لوحة التحكم</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg p-1">
                  <DateField value={range.start} onCommit={(iso) => range.setRange(iso, iso > range.end ? iso : range.end)} />
                  <span className="text-muted-foreground">-</span>
                  <DateField value={range.end} onCommit={(iso) => range.setRange(iso < range.start ? iso : range.start, iso)} />
                  <PayrollPeriodPicker />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {stats.map((stat, i) => (
              <StatCard key={i} {...stat} />
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-card rounded-2xl p-6 border border-border/50 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold font-display">توزيع الحالات حسب الفترة المختارة</h3>
              </div>
              <div className="h-[300px] w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))" }} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '10px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', boxShadow: '0 10px 20px -10px rgb(0 0 0 / 0.35)' }}
                      cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
                    />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} barSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-card rounded-2xl p-6 border border-border/50 shadow-sm">
              <h3 className="text-lg font-bold font-display mb-6">أكثر الموظفين</h3>
              <div className="h-[300px] w-full flex items-center justify-center" dir="ltr">
                <div className="w-full space-y-4" dir="rtl">
                  <div>
                    <div className="text-sm font-semibold mb-2">الأكثر غيابًا</div>
                    <div className="space-y-2">
                      {(topAbsentEmployees.length ? topAbsentEmployees : [{ name: "-", value: 0, code: "" }]).map((d: any) => (
                        <div key={`abs-${d.code || d.name}`} className="flex items-center gap-3">
                          <div className="text-sm text-muted-foreground truncate w-44" title={d.code ? `${d.name} (${d.code})` : d.name}>
                            {d.code ? `${d.name} (${d.code})` : d.name}
                          </div>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, (d.value / Math.max(1, topAbsentEmployees[0]?.value || 1)) * 100)}%`, background: "hsl(var(--destructive))" }}
                            />
                          </div>
                          <div className="text-sm font-bold tabular-nums w-10 text-left">{d.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/50">
                    <div className="text-sm font-semibold mb-2">الأكثر تأخيرًا</div>
                    <div className="space-y-2">
                      {(topLateEmployees.length ? topLateEmployees : [{ name: "-", value: 0, code: "" }]).map((d: any) => (
                        <div key={`late-${d.code || d.name}`} className="flex items-center gap-3">
                          <div className="text-sm text-muted-foreground truncate w-44" title={d.code ? `${d.name} (${d.code})` : d.name}>
                            {d.code ? `${d.name} (${d.code})` : d.name}
                          </div>
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, (d.value / Math.max(1, topLateEmployees[0]?.value || 1)) * 100)}%`, background: "hsl(var(--primary))" }}
                            />
                          </div>
                          <div className="text-sm font-bold tabular-nums w-10 text-left">{d.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-3">
              <Card className="border-border/50 shadow-sm">
                <CardHeader>
                  <CardTitle className="font-display">إدارة البيانات</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="text-sm text-muted-foreground">
                      {lastSavedAt ? `آخر حفظ: ${new Date(lastSavedAt).toLocaleString("ar-EG")}` : "لم يتم حفظ أي بيانات بعد."}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Link href="/backup">
                        <Button variant="outline">النسخ الاحتياطي والاستعادة</Button>
                      </Link>
                      <Button variant="destructive" className="gap-2" onClick={() => setConfirmWipe(true)}>
                        <Trash2 className="w-4 h-4" />
                        مسح كل البيانات
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>

      <AlertDialog open={confirmWipe} onOpenChange={setConfirmWipe}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>مسح كل البيانات؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف الموظفين والبصمات والسجلات والمؤثرات من هذا المتصفح نهائياً. صدّر نسخة احتياطية أولاً إذا لم تكن قد فعلت.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleClearData()}>مسح كل البيانات</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
