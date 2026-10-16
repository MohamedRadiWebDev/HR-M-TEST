import { wallSecondsOfDay, wallTime } from "@shared/wallclock";
import type { Adjustment, AttendanceRecord, Employee, SpecialRule } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { resolveShiftForDate, timeStringToSeconds } from "@/engine/attendanceEngine";

type TimelineSheetProps = {
  record: AttendanceRecord | null;
  employee: Employee | null | undefined;
  punches: { punchDatetime: Date }[];
  adjustments: Adjustment[];
  rules: SpecialRule[];
  onOpenChange: (open: boolean) => void;
};

export function TimelineSheet({ record, employee, punches, adjustments, rules, onOpenChange }: TimelineSheetProps) {
  const isOpen = Boolean(record);
  if (!record) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="right" />
      </Sheet>
    );
  }

  const shiftInfo = employee
    ? resolveShiftForDate({ employee, dateStr: record.date, rules })
    : { shiftStart: "09:00", shiftEnd: "17:00" };
  const windowStartHour = record.isOvernight ? 6 : 0;
  const windowStartSeconds = windowStartHour * 3600;

  const normalizeSeconds = (seconds: number) => {
    let offset = seconds - windowStartSeconds;
    if (offset < 0) offset += 24 * 3600;
    return Math.min(Math.max(offset, 0), 24 * 3600);
  };

  const punchMarkers = punches.map((punch) => {
    const date = punch.punchDatetime;
    const seconds = wallSecondsOfDay(date);
    return {
      id: date.getTime(),
      label: wallTime(date),
      offset: normalizeSeconds(seconds),
    };
  });

  const checkIn = record.checkIn ?? null;
  const checkOut = record.checkOut ?? null;
  const checkInOffset = checkIn
    ? normalizeSeconds(wallSecondsOfDay(checkIn))
    : null;
  const checkOutOffset = checkOut
    ? normalizeSeconds(wallSecondsOfDay(checkOut))
    : null;

  const shiftStartOffset = normalizeSeconds(timeStringToSeconds(shiftInfo.shiftStart));
  const shiftEndOffset = normalizeSeconds(timeStringToSeconds(shiftInfo.shiftEnd));
  const overtimeStartOffset = normalizeSeconds(timeStringToSeconds(shiftInfo.shiftEnd) + 3600);

  const adjustmentRanges = adjustments.map((adj) => ({
    ...adj,
    start: normalizeSeconds(timeStringToSeconds(adj.fromTime)),
    end: normalizeSeconds(timeStringToSeconds(adj.toTime)),
  }));

  const penalties = Array.isArray(record.penalties) ? record.penalties : [];
  const penaltyTotal = penalties.reduce((sum: number, penalty: { type?: string; value?: number }) => sum + (Number(penalty?.value) || 0), 0);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>الخط الزمني للحضور</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ملخص اليوم</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{record.employeeCode}</Badge>
                <Badge variant="outline">{record.date}</Badge>
                <Badge variant="outline">{employee?.nameAr || "-"}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>بداية الوردية: <span className="text-foreground">{shiftInfo.shiftStart}</span></div>
                <div>نهاية الوردية: <span className="text-foreground">{shiftInfo.shiftEnd}</span></div>
                <div>الدخول: <span className="text-foreground">{checkIn ? wallTime(checkIn) : "-"}</span></div>
                <div>الخروج: <span className="text-foreground">{checkOut ? wallTime(checkOut) : "-"}</span></div>
                <div>ساعات العمل: <span className="text-foreground">{record.totalHours?.toFixed(2) ?? "-"}</span></div>
                <div>الإضافي: <span className="text-foreground">{record.overtimeHours?.toFixed(2) ?? "-"}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">خط الزمن</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative h-20 rounded-lg border border-border/50 bg-muted/40">
                <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
                {[0, 6, 12, 18, 24].map((hour) => {
                  const offset = ((hour * 3600) / (24 * 3600)) * 100;
                  return (
                    <div key={hour} className="absolute top-0 h-full" style={{ left: `${offset}%` }}>
                      <div className="h-full w-px bg-slate-200" />
                      <span className="absolute -top-5 -translate-x-1/2 text-[10px] text-muted-foreground">
                        {(hour + windowStartHour) % 24}:00
                      </span>
                    </div>
                  );
                })}
                <div
                  className="absolute top-[18px] h-10 rounded-md bg-blue-100 border border-blue-200"
                  style={{
                    left: `${(shiftStartOffset / (24 * 3600)) * 100}%`,
                    width: `${(Math.max(shiftEndOffset - shiftStartOffset, 0) / (24 * 3600)) * 100}%`,
                  }}
                />
                <div className="absolute top-[12px] h-12 border-l-2 border-blue-600" style={{ left: `${(shiftStartOffset / (24 * 3600)) * 100}%` }} />
                <div className="absolute top-[12px] h-12 border-l-2 border-blue-600" style={{ left: `${(shiftEndOffset / (24 * 3600)) * 100}%` }} />
                <div className="absolute top-[12px] h-12 border-l-2 border-emerald-600" style={{ left: `${(overtimeStartOffset / (24 * 3600)) * 100}%` }} />

                {adjustmentRanges.map((range, index) => (
                  <div
                    key={`${range.type}-${index}`}
                    className="absolute top-[6px] h-6 rounded-md bg-amber-100 border border-amber-200"
                    style={{
                      left: `${(range.start / (24 * 3600)) * 100}%`,
                      width: `${(Math.max(range.end - range.start, 0) / (24 * 3600)) * 100}%`,
                    }}
                    title={`${range.type} ${range.fromTime}-${range.toTime}`}
                  />
                ))}

                {punchMarkers.map((marker) => (
                  <div
                    key={marker.id}
                    className="absolute top-[50px] h-3 w-3 rounded-full bg-slate-700"
                    style={{ left: `${(marker.offset / (24 * 3600)) * 100}%` }}
                    title={marker.label}
                  />
                ))}

                {checkInOffset !== null && (
                  <div
                    className="absolute top-[44px] h-5 w-2 rounded-full bg-emerald-600"
                    style={{ left: `${(checkInOffset / (24 * 3600)) * 100}%` }}
                    title="دخول"
                  />
                )}
                {checkOutOffset !== null && (
                  <div
                    className="absolute top-[44px] h-5 w-2 rounded-full bg-rose-600"
                    style={{ left: `${(checkOutOffset / (24 * 3600)) * 100}%` }}
                    title="خروج"
                  />
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">الوردية</Badge>
                <Badge variant="outline">الإضافي</Badge>
                <Badge variant="outline">التسويات</Badge>
                <Badge variant="outline">البصمات</Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">التفاصيل</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="font-semibold">البصمات:</span>{" "}
                {punchMarkers.length > 0 ? punchMarkers.map((marker) => marker.label).join("، ") : "-"}
              </div>
              <div>
                <span className="font-semibold">التسويات:</span>{" "}
                {adjustments.length > 0 ? adjustments.map((adj) => `${adj.type} (${adj.fromTime}-${adj.toTime})`).join(" | ") : "-"}
              </div>
              <div>
                <span className="font-semibold">المخالفات:</span>{" "}
                {penalties.length > 0 ? penalties.map((penalty: { type?: string; value?: number }) => `${penalty.type}: ${penalty.value}`).join(" | ") : "-"}
              </div>
              <div>
                <span className="font-semibold">إجمالي الخصم:</span> {penaltyTotal || 0}
              </div>
              <div>
                <span className="font-semibold">الملاحظات:</span> {record.notes || "-"}
              </div>
            </CardContent>
          </Card>
        </div>
      </SheetContent>
    </Sheet>
  );
}
