import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Download, Search } from "lucide-react";
import { useProcessAttendance } from "@/hooks/use-attendance";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildAttendanceExportRows } from "@/exporters/attendanceExport";
import { downloadAttendanceWorkbook } from "@/exporters/attendanceWorkbook";
import { useAttendanceStore } from "@/store/attendanceStore";
import { useEffectsHistoryStore } from "@/store/effectsHistoryStore";
import { syncEffectsChange } from "@/effects/syncEffects";
import { QuickAddEffectDialog } from "@/components/QuickAddEffectDialog";
import { TimelineSheet } from "@/features/attendance/components/TimelineSheet";
import { AttendanceList } from "@/features/attendance/components/AttendanceList";
import { getPunchesForAttendanceWindow, dayKey } from "@/features/attendance/attendance-page-utils";
import { useAttendanceView, type AttendanceTab } from "@/features/attendance/useAttendanceView";
import { isoToDmy, parseDmyInput } from "@/lib/dateInput";
import { PayrollPeriodPicker } from "@/components/PayrollPeriodPicker";
import { normalizeDateToIso } from "@shared/date-normalization";
import { normalizeEmployeeCode } from "@shared/employee-code";
import type { AttendanceRecord } from "@shared/schema";
import { cn } from "@/lib/utils";

const LIST_HEIGHT = 560;

/** dd/MM/yyyy text box that only commits a COMPLETE, valid date (never partial typing). */
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

export default function Attendance() {
  const { toast } = useToast();
  const view = useAttendanceView();
  const processAttendance = useProcessAttendance();
  const setWorkedOnOfficialHoliday = useAttendanceStore((s) => s.setWorkedOnOfficialHoliday);

  const [timelineRecord, setTimelineRecord] = useState<AttendanceRecord | null>(null);
  const [effectsRecord, setEffectsRecord] = useState<AttendanceRecord | null>(null);
  const [showEffectsDebug, setShowEffectsDebug] = useState(false);
  const [quickAddTarget, setQuickAddTarget] = useState<{ code: string; name?: string; date: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const canUndo = useEffectsHistoryStore((s) => s.past.length > 0);
  const canRedo = useEffectsHistoryStore((s) => s.future.length > 0);

  const { start, end } = view;

  const runProcess = (employeeCodes?: string[], label = "اكتملت المعالجة") => {
    if (!start || !end) return toast({ title: "خطأ", description: "يرجى تحديد الفترة أولاً", variant: "destructive" });
    processAttendance.mutate(
      { startDate: start, endDate: end, employeeCodes },
      {
        onSuccess: (data) =>
          toast({ title: data.skipped ? "لم تتم المعالجة" : label, description: data.message, variant: data.skipped ? "destructive" : undefined }),
        onError: (error) => toast({ title: "فشلت المعالجة", description: error instanceof Error ? error.message : String(error), variant: "destructive" }),
      }
    );
  };

  const handleSmartProcess = () => {
    // Uses the FULL filtered set – not just the rows visible on the current page.
    const codes = Array.from(new Set(view.allFiltered.map((r) => r.employeeCode).filter(Boolean)));
    if (codes.length === 0) return toast({ title: "تنبيه", description: "لا يوجد موظفون ضمن الفلاتر الحالية", variant: "destructive" });
    runProcess(codes, "اكتملت المعالجة الذكية");
  };

  const history = async (direction: "undo" | "redo") => {
    const result = useEffectsHistoryStore.getState()[direction]();
    if (!result) return;
    try {
      await syncEffectsChange(result.before, result.after);
    } catch (error) {
      toast({ title: "تعذر تحديث الحضور", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  const handleExport = async () => {
    const records = view.allFiltered;
    if (records.length === 0) return toast({ title: "لا توجد بيانات", description: "لا توجد سجلات للتصدير في هذه الفترة.", variant: "destructive" });

    const warnings: string[] = [];
    const codes = view.employees.map((e) => normalizeEmployeeCode(e.code));
    const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length) warnings.push(`يوجد أكواد مكررة في الماستر (${Array.from(new Set(dup)).slice(0, 5).join(", ")}).`);
    const missingHire = view.employees.filter((e) => !e.hireDate).length;
    if (missingHire) warnings.push(`يوجد موظفون بدون تاريخ تعيين (${missingHire}).`);
    if (warnings.length) toast({ title: "تنبيه قبل التصدير", description: warnings.join(" ") });

    const invalid = records.find(
      (r) =>
        !String(r.employeeCode ?? "").trim() ||
        !view.employeesByCode.get(normalizeEmployeeCode(r.employeeCode))?.nameAr?.trim() ||
        normalizeDateToIso(r.date) !== r.date
    );
    if (invalid) {
      return toast({
        title: "تعذر تصدير التقرير",
        description: `سجل غير صالح (كود/اسم/تاريخ): ${invalid.employeeCode} ${invalid.date}. راجع بيانات الموظفين ثم أعد المحاولة.`,
        variant: "destructive",
      });
    }

    setExporting(true);
    try {
      const data = buildAttendanceExportRows({ records, employees: view.employees, reportStartDate: start, reportEndDate: end });
      await downloadAttendanceWorkbook(
        data,
        { start, end, employeeCount: new Set(records.map((r) => normalizeEmployeeCode(r.employeeCode))).size, recordCount: records.length },
        `Attendance_${start}_${end}.xlsx`
      );
      toast({ title: "تم التصدير", description: "تم تحميل ملف الإكسل بنجاح" });
    } catch (error) {
      toast({ title: "تعذر تصدير التقرير", description: error instanceof Error ? error.message : "حدث خطأ أثناء إنشاء الملف.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const pending = processAttendance.isPending;
  const timelinePunches = timelineRecord
    ? getPunchesForAttendanceWindow(view.punches, timelineRecord.employeeCode, timelineRecord.date, Boolean(timelineRecord.isOvernight))
    : [];
  const effectsForSelected = effectsRecord ? view.effectsByKey.get(dayKey(effectsRecord.employeeCode, effectsRecord.date)) || [] : [];

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="الحضور والانصراف" />

        <main className="flex-1 overflow-y-auto p-8">
          <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="p-6 border-b border-border/50 flex flex-col xl:flex-row items-center justify-between gap-4 sticky top-0 z-20 bg-background/90 backdrop-blur">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg p-1">
                  <DateField value={view.start} onCommit={(iso) => view.setRange(iso, iso > view.end ? iso : view.end)} />
                  <span className="text-muted-foreground">-</span>
                  <DateField value={view.end} onCommit={(iso) => view.setRange(iso < view.start ? iso : view.start, iso)} />
                  <PayrollPeriodPicker />
                </div>
                <div className="relative min-w-[200px]">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="أكواد: 101, 102, 105"
                    className="pr-10 h-10"
                    value={view.employeeFilter}
                    onChange={(e) => view.setEmployeeFilter(e.target.value)}
                  />
                </div>
                <Select value={view.sectorFilter} onValueChange={view.setSectorFilter}>
                  <SelectTrigger className="w-[180px] h-10"><SelectValue placeholder="القطاع" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل القطاعات</SelectItem>
                    {view.sectors.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                  </SelectContent>
                </Select>
                <Select value={String(view.pageSize)} onValueChange={(v) => view.setPageSize(Number(v))}>
                  <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="عدد الصفوف" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50 صف</SelectItem>
                    <SelectItem value="100">100 صف</SelectItem>
                    <SelectItem value="200">200 صف</SelectItem>
                    <SelectItem value="0">كل البيانات</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col items-end gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={() => void history("undo")} disabled={!canUndo}>تراجع</Button>
                  <Button variant="outline" onClick={() => void history("redo")} disabled={!canRedo}>إعادة</Button>
                  <Button variant="outline" onClick={() => runProcess()} disabled={pending} className="gap-2">
                    <RefreshCw className={cn("w-4 h-4", pending && "animate-spin")} />
                    معالجة الحضور
                  </Button>
                  <Button variant="outline" onClick={handleSmartProcess} disabled={pending} className="gap-2">
                    <RefreshCw className={cn("w-4 h-4", pending && "animate-spin")} />
                    إعادة معالجة ذكية
                  </Button>
                  <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={handleExport} disabled={exporting}>
                    <Download className="w-4 h-4" />
                    {exporting ? "جاري التصدير..." : "تصدير التقرير"}
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">يعيد حساب الحضور من البصمة للفترة المختارة ({view.allFiltered.length} سجل)</span>
              </div>
            </div>

            <div className="px-6 py-3 border-b border-border/50 bg-muted/40">
              <Tabs value={view.activeTab} onValueChange={(v) => view.setActiveTab(v as AttendanceTab)} dir="rtl">
                <TabsList className="grid grid-cols-3 w-full sm:w-[420px]">
                  <TabsTrigger value="detail">تفصيلي</TabsTrigger>
                  <TabsTrigger value="summary">ملخص</TabsTrigger>
                  <TabsTrigger value="exceptions">استثناءات فقط</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="rounded-xl border border-dashed border-slate-300 bg-muted/40 p-3 text-xs text-slate-700">
              <div className="flex items-center justify-between">
                <span className="font-semibold">تشخيص المؤثرات</span>
                <Button variant="ghost" size="sm" onClick={() => setShowEffectsDebug((v) => !v)}>{showEffectsDebug ? "إخفاء" : "إظهار"}</Button>
              </div>
              {showEffectsDebug && (
                <div className="space-y-1 mt-2">
                  <div>المؤثرات المحمّلة: <strong>{view.effects.length}</strong></div>
                  <div>المؤثرات داخل الفترة: <strong>{view.effectsInPeriod}</strong></div>
                </div>
              )}
            </div>

            {view.activeTab === "summary" ? (
              <div className="flex-1 overflow-auto" style={{ maxHeight: LIST_HEIGHT }}>
                {!view.summaryTable ? (
                  <div className="p-6 text-center text-muted-foreground">يرجى تحديد الفترة أولاً لعرض الملخص.</div>
                ) : (
                  <table className="w-full text-sm text-right min-w-[1100px]">
                    <thead className="bg-muted/40 text-muted-foreground font-medium sticky top-0 z-10 shadow-sm">
                      <tr>{view.summaryTable.summaryHeaders.map((h) => (<th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>))}</tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {view.summaryTable.summaryRows.slice(1).map((row, idx) => (
                        <tr key={idx} className="hover:bg-background">
                          {row.map((cell, cidx) => (<td key={cidx} className="px-4 py-3 whitespace-nowrap">{String(cell ?? "")}</td>))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ) : view.pageRecords.length === 0 ? (
              <div className="px-6 py-10 text-center text-muted-foreground">
                لا توجد سجلات في هذه الفترة. استورد البصمة ثم اضغط «معالجة الحضور».
              </div>
            ) : (
              <>
                <AttendanceList
                  records={view.pageRecords}
                  maxHeight={LIST_HEIGHT}
                  employeesByCode={view.employeesByCode}
                  effectsByKey={view.effectsByKey}
                  adjustmentsByKey={view.adjustmentsByKey}
                  onOpenEffects={setEffectsRecord}
                  onOpenTimeline={setTimelineRecord}
                  onQuickAdd={(r) =>
                    setQuickAddTarget({ code: r.employeeCode, name: view.employeesByCode.get(normalizeEmployeeCode(r.employeeCode))?.nameAr, date: r.date })
                  }
                  onToggleHoliday={(r, worked) => setWorkedOnOfficialHoliday(r.id, worked)}
                />
                {view.pageSize > 0 && view.totalPages > 1 && (
                  <div className="p-4 border-t border-border/50 flex items-center justify-center gap-2 bg-card">
                    <Button variant="outline" size="sm" disabled={view.page === 1} onClick={() => view.setPage(Math.max(1, view.page - 1))}>السابق</Button>
                    <div className="text-sm font-medium">صفحة {view.page} من {view.totalPages}</div>
                    <Button variant="outline" size="sm" disabled={view.page === view.totalPages} onClick={() => view.setPage(Math.min(view.totalPages, view.page + 1))}>التالي</Button>
                  </div>
                )}
              </>
            )}
          </div>

          <QuickAddEffectDialog
            open={Boolean(quickAddTarget)}
            onOpenChange={(open) => { if (!open) setQuickAddTarget(null); }}
            employeeCode={quickAddTarget?.code || ""}
            employeeName={quickAddTarget?.name}
            defaultDate={quickAddTarget?.date || start}
          />

          <Sheet open={Boolean(effectsRecord)} onOpenChange={(open) => !open && setEffectsRecord(null)}>
            <SheetContent side="left" className="w-full sm:max-w-lg" dir="rtl">
              <SheetHeader><SheetTitle>تفاصيل المؤثرات</SheetTitle></SheetHeader>
              {effectsRecord && (
                <div className="mt-4 space-y-3 text-sm">
                  <div className="font-semibold">{effectsRecord.employeeCode} - {effectsRecord.date}</div>
                  {effectsForSelected.length === 0 ? (
                    <p className="text-muted-foreground">لا توجد مؤثرات محفوظة لهذا اليوم.</p>
                  ) : (
                    <div className="space-y-2">
                      {effectsForSelected.map((effect) => {
                        const needsTimes = ["اذن صباحي", "اذن مسائي", "إذن صباحي", "إذن مسائي", "إجازة نصف يوم", "إجازة نص يوم"].includes(effect.type);
                        const missing = needsTimes && (!effect.fromTime || !effect.toTime);
                        return (
                          <div key={effect.id} className="rounded-lg border p-2">
                            <div className="font-medium">{effect.type}</div>
                            <div className="text-xs text-muted-foreground">{effect.fromTime || "-"} → {effect.toTime || "-"}</div>
                            {missing && <div className="text-xs text-amber-600">بدون ساعات (يُستخدم الافتراضي من الإعدادات)</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </SheetContent>
          </Sheet>

          <TimelineSheet
            record={timelineRecord}
            employee={timelineRecord ? view.employeesByCode.get(normalizeEmployeeCode(timelineRecord.employeeCode)) : null}
            punches={timelinePunches}
            adjustments={timelineRecord ? view.adjustmentsByKey.get(dayKey(timelineRecord.employeeCode, timelineRecord.date)) || [] : []}
            rules={view.rules}
            onOpenChange={(open) => { if (!open) setTimelineRecord(null); }}
          />
        </main>
      </div>
    </div>
  );
}
