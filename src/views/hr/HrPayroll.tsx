"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageFrame } from "@/components/portal/PageFrame";
import { DataTable } from "@/components/portal/DataTable";
import { FormDialog, type Field } from "@/components/portal/FormDialog";
import { useToast } from "@/hooks/use-toast";
import { addDeduction, decideLoan, generatePayslips, resolveDeduction } from "@/portal/actions";
import { grossOf, periodKeyOf } from "@/portal/payroll";
import { newId } from "@/portal/misc";
import { todayIso } from "@/lib/dateInput";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import { payrollPeriodContaining, recentPayrollPeriods } from "@shared/payroll-period";

const money = (n: number) => n.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUM = ["basic", "housing", "transport", "phone", "nature", "other", "pressure"] as const;

export default function HrPayroll() {
  const { toast } = useToast();
  const employees = useAttendanceStore((s) => s.employees);
  const startDay = useAttendanceStore((s) => s.config.payrollMonthStartDay);
  const p = usePortalStore();
  const periods = recentPayrollPeriods(todayIso(), startDay, 12);
  const [periodIdx, setPeriodIdx] = useState(0);
  const period = periods[periodIdx] ?? payrollPeriodContaining(todayIso(), startDay);
  const key = periodKeyOf(period);
  const [dialog, setDialog] = useState<"salary" | "bonus" | "deduction" | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const nameOf = (code: string) => employees.find((e) => normalizeEmployeeCode(e.code) === normalizeEmployeeCode(code))?.nameAr ?? code;
  const employeeField: Field = { name: "employeeCode", label: "الموظف", type: "select", required: true, options: employees.map((e) => ({ value: e.code, label: `${e.nameAr} (${e.code})` })) };
  const slips = p.payslips.filter((x) => x.periodKey === key);

  return (
    <PageFrame title="الرواتب والسلف">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">شهر الرواتب:
          <select className="mr-2 h-9 rounded-md border border-input bg-background px-2" value={periodIdx} onChange={(e) => setPeriodIdx(Number(e.target.value))}>
            {periods.map((x, i) => (<option key={x.label} value={i}>{x.label} ({x.start} → {x.end})</option>))}
          </select>
        </label>
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">حساب مبدئي للمراجعة: الخصم = (أيام الجزاءات + الإجازة بدون أجر) × (الإجمالي ÷ {p.settings.payrollDaysBase})، والإضافي المعتمد × {p.settings.overtimeMultiplier}. لا يشمل الضرائب ولا التأمينات.</p>

      <Tabs defaultValue="payslips" dir="rtl">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="payslips">القسائم</TabsTrigger><TabsTrigger value="salaries">هياكل الرواتب</TabsTrigger>
          <TabsTrigger value="loans">السلف</TabsTrigger><TabsTrigger value="bonuses">المكافآت</TabsTrigger><TabsTrigger value="deductions">الخصومات</TabsTrigger>
        </TabsList>

        <TabsContent value="payslips" className="space-y-3 pt-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => toast({ title: `تم إنشاء ${generatePayslips(period, { publish: false })} مسودة` })}>إنشاء / تحديث المسودات</Button>
            <Button onClick={() => toast({ title: `تم اعتماد ونشر ${generatePayslips(period, { publish: true })} قسيمة`, description: "وصل إشعار لكل موظف." })}>اعتماد ونشر للموظفين</Button>
          </div>
          <DataTable rows={slips} rowKey={(x) => x.id} empty="لا توجد قسائم لهذا الشهر بعد." columns={[
            { header: "الموظف", cell: (x) => nameOf(x.employeeCode) }, { header: "الإجمالي", cell: (x) => money(x.gross) },
            { header: "الخصومات", cell: (x) => money(x.deductions.reduce((s, l) => s + l.amount, 0)) }, { header: "الصافي", cell: (x) => <strong>{money(x.net)}</strong> },
            { header: "الحالة", cell: (x) => (x.status === "published" ? "منشورة" : "مسودة") },
          ]} />
        </TabsContent>

        <TabsContent value="salaries" className="space-y-3 pt-4">
          <Button onClick={() => setDialog("salary")}>+ تعيين / تعديل هيكل راتب</Button>
          <DataTable rows={p.salaryProfiles} rowKey={(x) => x.id} empty="لا توجد هياكل رواتب." columns={[
            { header: "الموظف", cell: (x) => nameOf(x.employeeCode) }, { header: "الأساسي", cell: (x) => money(x.basic) }, { header: "الإجمالي", cell: (x) => money(grossOf(x)) }, { header: "البنك", cell: (x) => x.bank || "-" },
          ]} />
        </TabsContent>

        <TabsContent value="loans" className="pt-4">
          <DataTable rows={p.loans} rowKey={(l) => l.id} empty="لا توجد سلف." columns={[
            { header: "الموظف", cell: (l) => nameOf(l.employeeCode) }, { header: "المبلغ", cell: (l) => money(l.amount) }, { header: "الأقساط", cell: (l) => l.installments },
            { header: "السبب", cell: (l) => l.reason || "-" }, { header: "الحالة", cell: (l) => ({ requested: "قيد المراجعة", approved: "معتمدة", rejected: "مرفوضة", closed: "مسددة" })[l.status] },
            { header: "", cell: (l) => l.status === "requested" ? (<div className="flex gap-2"><Button size="sm" onClick={() => decideLoan(l.id, true)}>اعتماد</Button><Button size="sm" variant="outline" onClick={() => decideLoan(l.id, false)}>رفض</Button></div>) : null },
          ]} />
        </TabsContent>

        <TabsContent value="bonuses" className="space-y-3 pt-4">
          <Button onClick={() => setDialog("bonus")}>+ مكافأة</Button>
          <DataTable rows={p.bonuses} rowKey={(b) => b.id} empty="لا توجد مكافآت." columns={[
            { header: "الموظف", cell: (b) => nameOf(b.employeeCode) }, { header: "الشهر", cell: (b) => b.periodKey }, { header: "المبلغ", cell: (b) => money(b.amount) }, { header: "السبب", cell: (b) => b.reason },
            { header: "", cell: (b) => <button className="text-red-600" onClick={() => p.remove("bonuses", b.id)}>حذف</button> },
          ]} />
        </TabsContent>

        <TabsContent value="deductions" className="space-y-3 pt-4">
          <Button onClick={() => setDialog("deduction")}>+ خصم</Button>
          <DataTable rows={p.deductions} rowKey={(d) => d.id} empty="لا توجد خصومات." columns={[
            { header: "الموظف", cell: (d) => nameOf(d.employeeCode) }, { header: "الشهر", cell: (d) => d.periodKey }, { header: "التصنيف", cell: (d) => d.category }, { header: "المبلغ", cell: (d) => money(d.amount) },
            { header: "الحالة", cell: (d) => (<div>{({ notified: "تم الإخطار", objected: "معترَض عليه", upheld: "مؤكد", cancelled: "ملغي" })[d.status]}{d.objection && <div className="text-xs text-muted-foreground">اعتراض: {d.objection}</div>}</div>) },
            { header: "", cell: (d) => d.status === "objected" ? <Button size="sm" onClick={() => setResolving(d.id)}>البت في الاعتراض</Button> : null },
          ]} />
        </TabsContent>
      </Tabs>

      <FormDialog open={dialog === "salary"} onOpenChange={(o) => !o && setDialog(null)} title="هيكل الراتب" fields={[
        employeeField, ...NUM.map((n): Field => ({ name: n, label: { basic: "الأساسي", housing: "بدل السكن", transport: "بدل النقل", phone: "بدل الهاتف", nature: "بدل طبيعة العمل", other: "بدلات أخرى", pressure: "بدل ضغط العمل" }[n], type: "number", required: n === "basic" })),
        { name: "bank", label: "البنك" }, { name: "iban", label: "الآيبان" },
      ]} onSubmit={(v) => {
        const existing = p.salaryProfiles.find((x) => normalizeEmployeeCode(x.employeeCode) === normalizeEmployeeCode(v.employeeCode));
        const num = (k: string) => Math.max(0, Number(v[k] || 0));
        p.upsert("salaryProfiles", { id: existing?.id ?? newId(), employeeCode: v.employeeCode, basic: num("basic"), housing: num("housing"), transport: num("transport"), phone: num("phone"), nature: num("nature"), other: num("other"), pressure: num("pressure"), bank: v.bank || undefined, iban: v.iban || undefined });
      }} />
      <FormDialog open={dialog === "bonus"} onOpenChange={(o) => !o && setDialog(null)} title="مكافأة" fields={[employeeField, { name: "amount", label: "المبلغ", type: "number", required: true }, { name: "reason", label: "السبب", required: true }]}
        onSubmit={(v) => p.upsert("bonuses", { id: newId(), employeeCode: v.employeeCode, amount: Number(v.amount), reason: v.reason, periodKey: key, createdAt: new Date().toISOString() })} />
      <FormDialog open={dialog === "deduction"} onOpenChange={(o) => !o && setDialog(null)} title="خصم (يُخطَر به الموظف وله حق الاعتراض)" fields={[employeeField, { name: "category", label: "التصنيف", required: true, placeholder: "جودة / التزام / إداري" }, { name: "amount", label: "المبلغ", type: "number", required: true }, { name: "reason", label: "السبب", type: "textarea", required: true }]}
        onSubmit={(v) => addDeduction(v.employeeCode, Number(v.amount), v.reason, v.category, period)} />
      <FormDialog open={Boolean(resolving)} onOpenChange={(o) => !o && setResolving(null)} title="البت في الاعتراض" fields={[
        { name: "outcome", label: "القرار", type: "select", options: [{ value: "cancelled", label: "قبول الاعتراض (إلغاء الخصم)" }, { value: "upheld", label: "رفض الاعتراض (تأكيد الخصم)" }] },
        { name: "resolution", label: "التعليق للموظف", type: "textarea", required: true },
      ]} onSubmit={(v) => resolveDeduction(resolving!, v.outcome as "upheld" | "cancelled", v.resolution)} />
    </PageFrame>
  );
}
