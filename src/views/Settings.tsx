"use client";

import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ENGINE_CONFIG } from "@/engine/config";
import { isoToDmy, todayIso } from "@/lib/dateInput";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { clampStartDay, payrollPeriodContaining } from "@shared/payroll-period";

export default function Settings() {
  const config = useAttendanceStore((s) => s.config);
  const setConfig = useAttendanceStore((s) => s.setConfig);
  const period = payrollPeriodContaining(todayIso(), config.payrollMonthStartDay);
  const tiers = [...ENGINE_CONFIG.lateTiers].reverse();
  const portalSettings = usePortalStore((s) => s.settings);
  const setPortalSettings = usePortalStore((s) => s.setSettings);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="الإعدادات" />
        <main className="flex-1 overflow-y-auto p-8 space-y-6" dir="rtl">
          <Card>
            <CardHeader><CardTitle>فترة الرواتب</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payroll-start">يوم بداية شهر الرواتب</Label>
                  <Input
                    id="payroll-start"
                    type="number"
                    min={1}
                    max={28}
                    className="w-32"
                    value={config.payrollMonthStartDay}
                    onChange={(e) => setConfig({ ...config, payrollMonthStartDay: clampStartDay(e.target.value) })}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  شهر الرواتب الحالي ({period.label}): من <strong>{isoToDmy(period.start)}</strong> إلى <strong>{isoToDmy(period.end)}</strong>
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                24 يعني من 24 الشهر السابق حتى 23 الشهر الحالي. اكتب 1 للشهر الميلادي العادي. يستخدمها اختيار الفترة في صفحتي الحضور ولوحة التحكم.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>إعدادات بوابة الموظف</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2"><Label>رصيد الإجازة السنوية (يوم)</Label><Input type="number" min={0} value={portalSettings.annualLeaveDays} onChange={(e) => setPortalSettings({ annualLeaveDays: Math.max(0, Number(e.target.value) || 0) })} /></div>
              <div className="space-y-2"><Label>مضاعِف الإضافي</Label><Input type="number" step="0.05" min={1} value={portalSettings.overtimeMultiplier} onChange={(e) => setPortalSettings({ overtimeMultiplier: Math.max(1, Number(e.target.value) || 1) })} /></div>
              <div className="space-y-2"><Label>أيام الشهر لحساب اليومية</Label><Input type="number" min={26} max={31} value={portalSettings.payrollDaysBase} onChange={(e) => setPortalSettings({ payrollDaysBase: Math.min(31, Math.max(26, Number(e.target.value) || 30)) })} /></div>
              <div className="space-y-2 sm:col-span-3"><Label>المستندات المطلوبة (افصل بفاصلة)</Label><Input value={portalSettings.requiredDocuments.join("، ")} onChange={(e) => setPortalSettings({ requiredDocuments: e.target.value.split(/[,،]/).map((t) => t.trim()).filter(Boolean) })} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>سياسة التأخير (للعرض)</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>سماحية التأخير: <strong>{ENGINE_CONFIG.graceMinutes} دقيقة</strong> — بدون خصم.</div>
              <table className="text-right border rounded-md">
                <thead className="bg-muted/40">
                  <tr><th className="px-4 py-2">مدة التأخير</th><th className="px-4 py-2">الخصم</th></tr>
                </thead>
                <tbody>
                  {tiers.map((tier, index) => {
                    const from = tier.overMinutes === 0 ? ENGINE_CONFIG.graceMinutes : tier.overMinutes;
                    return (
                      <tr key={tier.overMinutes} className="border-t">
                        <td className="px-4 py-2">أكثر من {from} دقيقة{index === 0 ? ` (حتى ${tiers[1].overMinutes})` : index === 1 ? ` (حتى ${tiers[2].overMinutes})` : ""}</td>
                        <td className="px-4 py-2">{tier.penalty === 1 ? "يوم كامل" : tier.penalty === 0.5 ? "نصف يوم" : "ربع يوم"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground">تُعدَّل من الملف <code>src/engine/config.ts</code> (قاعدة عمل واحدة تستخدمها كل الشاشات والتقارير).</p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
