import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Clock } from "lucide-react";
import type { Adjustment, AttendanceRecord, Employee } from "@shared/schema";
import { wallTime } from "@shared/wallclock";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Effect } from "@/store/effectsStore";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";
import { buildRecordToneClass, dayKey, explainReasons, getWorkedOnHoliday } from "../attendance-page-utils";

export type AttendanceListProps = {
  records: AttendanceRecord[];
  maxHeight: number;
  employeesByCode: Map<string, Employee>;
  effectsByKey: Map<string, Effect[]>;
  adjustmentsByKey: Map<string, Adjustment[]>;
  onOpenEffects: (record: AttendanceRecord) => void;
  onOpenTimeline: (record: AttendanceRecord) => void;
  onQuickAdd: (record: AttendanceRecord) => void;
  onToggleHoliday: (record: AttendanceRecord, worked: boolean) => void;
};

const timeOf = (value: Date | null) => (value ? wallTime(value) : "-");
const penaltyList = (record: AttendanceRecord) => (Array.isArray(record.penalties) ? record.penalties : []);

function DesktopTable(props: AttendanceListProps) {
  const { records, maxHeight, effectsByKey, adjustmentsByKey, employeesByCode } = props;
  const parentRef = useRef<HTMLDivElement>(null);
  // Rows have variable height (badges / notes wrap) → measure them instead of assuming 56px.
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 84,
    overscan: 8,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length ? items[0].start : 0;
  const paddingBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div ref={parentRef} className="flex-1 overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-sm text-right min-w-[1100px]">
        <thead className="bg-muted/40 text-muted-foreground font-medium sticky top-0 z-10 shadow-sm">
          <tr>
            {["التاريخ", "الموظف", "الدخول", "الخروج", "ساعات العمل", "الإضافي", "الحالة", "الإجازة الرسمية", "المؤثرات", "ملاحظات"].map((h) => (
              <th key={h} className="px-6 py-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {paddingTop > 0 && <tr><td colSpan={10} style={{ height: paddingTop, padding: 0 }} /></tr>}
          {items.map((item) => {
            const record = records[item.index];
            const key = dayKey(record.employeeCode, record.date);
            const effects = effectsByKey.get(key) || [];
            const adjustments = adjustmentsByKey.get(key) || [];
            const penalties = penaltyList(record);
            return (
              <tr
                key={record.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={cn("transition-colors cursor-pointer", buildRecordToneClass(record))}
                onClick={() => props.onOpenEffects(record)}
              >
                <td className="px-6 py-4 font-mono text-muted-foreground">{record.date}</td>
                <td className="px-6 py-4">
                  <div className="font-medium">{record.employeeCode}</div>
                  <div className="text-xs text-muted-foreground">{employeesByCode.get(normalizeEmployeeCode(record.employeeCode))?.nameAr}</div>
                </td>
                <td className="px-6 py-4 font-mono" dir="ltr">{timeOf(record.checkIn)}</td>
                <td className="px-6 py-4 font-mono" dir="ltr">{timeOf(record.checkOut)}</td>
                <td className="px-6 py-4 font-bold">{record.totalHours?.toFixed(2)}</td>
                <td className="px-6 py-4 text-emerald-600 font-bold">
                  {record.overtimeHours && record.overtimeHours > 0 ? `+${record.overtimeHours.toFixed(2)}` : "-"}
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={record.status} />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                            <span className="text-xs">👁️</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[320px]" dir="rtl">
                          <div className="space-y-1">
                            {explainReasons(record, effects.length).map((r, i) => (
                              <div key={i}>• {r}</div>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onQuickAdd(record);
                        }}
                      >
                        + مؤثر
                      </Button>
                    </div>
                    {record.isOfficialHoliday && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-blue-100 text-blue-700 border-blue-200">إجازة رسمية</span>
                    )}
                    {record.isOfficialHoliday && (record.compDayCredit ?? 0) > 0 && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">يوم بالبدل</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                  {record.isOfficialHoliday ? (
                    <div className="flex items-center gap-2">
                      <Switch checked={getWorkedOnHoliday(record)} onCheckedChange={(value) => props.onToggleHoliday(record, value)} />
                      <span className="text-xs text-muted-foreground">حضر؟</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {effects.length === 0 && <span className="text-xs text-muted-foreground">-</span>}
                    {effects.map((effect) => (
                      <span key={effect.id} className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">{effect.type}</span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => props.onOpenTimeline(record)}>
                            <Clock className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>عرض الخط الزمني</TooltipContent>
                      </Tooltip>
                      <span className="text-[10px] text-muted-foreground">الخط الزمني</span>
                    </div>
                    {penalties.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {penalties.map((p, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">{p.type}: {p.value}</span>
                        ))}
                      </div>
                    )}
                    {adjustments.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {adjustments.map((adj) => (
                          <span key={adj.id} className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-bold">{adj.type} ({adj.fromTime}-{adj.toTime})</span>
                        ))}
                      </div>
                    )}
                    {record.notes ? <div className="text-[10px] text-slate-600 font-medium">{record.notes}</div> : null}
                    {record.status === "Excused" && <span className="text-[10px] text-emerald-600 font-medium italic">إذن مسجل</span>}
                  </div>
                </td>
              </tr>
            );
          })}
          {paddingBottom > 0 && <tr><td colSpan={10} style={{ height: paddingBottom, padding: 0 }} /></tr>}
        </tbody>
      </table>
    </div>
  );
}

function MobileCards(props: AttendanceListProps) {
  const { records, maxHeight, effectsByKey, employeesByCode } = props;
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 260,
    overscan: 4,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length ? items[0].start : 0;
  const paddingBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <div ref={parentRef} className="flex-1 overflow-auto p-4" style={{ maxHeight }}>
      <div style={{ paddingTop, paddingBottom }}>
        {items.map((item) => {
          const record = records[item.index];
          const effects = effectsByKey.get(dayKey(record.employeeCode, record.date)) || [];
          const employee = employeesByCode.get(normalizeEmployeeCode(record.employeeCode));
          return (
            <div key={record.id} data-index={item.index} ref={virtualizer.measureElement} className="pb-4">
              <div className={cn("border border-border/50 rounded-xl p-4 shadow-sm space-y-2 bg-card", buildRecordToneClass(record))}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{record.date}</span>
                  <StatusBadge status={record.status} />
                </div>
                <div className="font-semibold">
                  {record.employeeCode} {employee ? <span className="text-sm font-normal text-muted-foreground">— {employee.nameAr}</span> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {effects.map((effect) => (
                    <span key={effect.id} className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">{effect.type}</span>
                  ))}
                </div>
                <div className="flex justify-between text-sm"><span>الدخول</span><span dir="ltr">{timeOf(record.checkIn)}</span></div>
                <div className="flex justify-between text-sm"><span>الخروج</span><span dir="ltr">{timeOf(record.checkOut)}</span></div>
                <div className="flex justify-between text-sm"><span>ساعات العمل</span><span>{record.totalHours?.toFixed(2)}</span></div>
                {penaltyList(record).length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {penaltyList(record).map((p, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">{p.type}: {p.value}</span>
                    ))}
                  </div>
                )}
                {record.isOfficialHoliday && (
                  <div className="flex items-center justify-between text-sm">
                    <span>حضر في الإجازة الرسمية؟</span>
                    <Switch checked={getWorkedOnHoliday(record)} onCheckedChange={(value) => props.onToggleHoliday(record, value)} />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2 flex-1" onClick={() => props.onOpenTimeline(record)}>
                    <Clock className="w-4 h-4" /> الخط الزمني
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => props.onQuickAdd(record)}>+ مؤثر</Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Renders ONE of the two layouts (table on desktop, cards on mobile) – never both DOM trees. */
export function AttendanceList(props: AttendanceListProps) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCards {...props} /> : <DesktopTable {...props} />;
}
