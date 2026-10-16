"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PortalPage } from "@/components/portal/PageFrame";
import { DataTable } from "@/components/portal/DataTable";
import { FormDialog } from "@/components/portal/FormDialog";
import { useToast } from "@/hooks/use-toast";
import { objectToDeduction, requestLoan } from "@/portal/actions";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import type { DeductionStatus, Payslip } from "@shared/portal";

const money = (n: number) => n.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mineOf = <T extends { employeeCode: string }>(rows: T[], code: string) => rows.filter((r) => normalizeEmployeeCode(r.employeeCode) === normalizeEmployeeCode(code));

// ------------------------------------------------------------------ payslips
function PayslipCard({ p }: { p: Payslip }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="font-bold">راتب {p.periodLabel}</div><div className="text-xs text-muted-foreground">من {p.start} إلى {p.end}</div></div>
          <div className="text-left"><div className="text-xs text-muted-foreground">صافي الراتب</div><div className="text-xl font-bold text-emerald-700">{money(p.net)}</div></div>
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setOpen(!open)}>{open ? "إخفاء" : "التفاصيل"}</Button><Button size="sm" variant="outline" onClick={() => window.print()}>طباعة</Button></div>
        </div>
        {open && (
          <div className="grid gap-6 sm:grid-cols-2">
            <div><div className="mb-1 font-semibold">الاستحقاقات</div>{p.earnings.map((l, i) => (<div key={i} className="flex justify-between border-b py-1 text-sm"><span>{l.label}</span><span>{money(l.amount)}</span></div>))}<div className="flex justify-between py-1 text-sm font-bold"><span>الإجمالي</span><span>{money(p.earnings.reduce((s, l) => s + l.amount, 0))}</span></div></div>
            <div><div className="mb-1 font-semibold">الخصومات</div>{p.deductions.length === 0 && <div className="text-sm text-muted-foreground">لا توجد خصومات.</div>}{p.deductions.map((l, i) => (<div key={i} className="flex justify-between border-b py-1 text-sm"><span>{l.label}</span><span>{money(l.amount)}</span></div>))}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Payslips({ code }: { code: string }) {
  const rows = mineOf(usePortalStore((s) => s.payslips), code).filter((p) => p.status === "published").sort((a, b) => b.periodKey.localeCompare(a.periodKey));
  return rows.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">لا توجد قسائم راتب منشورة بعد.</div> : <>{rows.map((p) => <PayslipCard key={p.id} p={p} />)}</>;
}
export const PortalPayslips = () => <PortalPage title="قسائم راتبي">{(code) => <Payslips code={code} />}</PortalPage>;

// ------------------------------------------------------------------ loans
const LOAN_LABEL = { requested: "قيد المراجعة", approved: "معتمدة", rejected: "مرفوضة", closed: "مسددة" } as const;

function Loans({ code }: { code: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const loans = mineOf(usePortalStore((s) => s.loans), code);
  const remaining = loans.filter((l) => l.status === "approved").reduce((s, l) => s + l.schedule.filter((i) => i.status === "due").reduce((a, i) => a + i.amount, 0), 0);
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">دفتر سلفك: المبلغ والمسدد والمتبقي وحالة كل قسط.</p>
        <Button onClick={() => setOpen(true)}>+ طلب سلفة</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5 text-center"><div className="text-2xl font-bold">{money(remaining)}</div><div className="text-sm text-muted-foreground">المتبقي عليك</div></CardContent></Card>
        <Card><CardContent className="p-5 text-center"><div className="text-2xl font-bold">{loans.length}</div><div className="text-sm text-muted-foreground">عدد السلف</div></CardContent></Card>
        <Card><CardContent className="p-5 text-center"><div className="text-2xl font-bold">{loans.filter((l) => l.status === "approved").length}</div><div className="text-sm text-muted-foreground">سلف مفتوحة</div></CardContent></Card>
      </div>
      <DataTable
        rows={loans}
        rowKey={(l) => l.id}
        empty="لا توجد سلف مسجلة لك."
        columns={[
          { header: "المبلغ", cell: (l) => money(l.amount) },
          { header: "الأقساط", cell: (l) => l.installments },
          { header: "المسدد", cell: (l) => money(l.schedule.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0)) },
          { header: "المتبقي", cell: (l) => money(l.schedule.filter((i) => i.status === "due").reduce((s, i) => s + i.amount, 0)) },
          { header: "الأقساط (الشهر: الحالة)", cell: (l) => l.schedule.map((i) => `${i.periodKey}: ${i.status === "paid" ? "مدفوع" : "مستحق"}`).join(" • ") || "-" },
          { header: "الحالة", cell: (l) => LOAN_LABEL[l.status] },
        ]}
      />
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="طلب سلفة"
        fields={[
          { name: "amount", label: "المبلغ", type: "number", required: true },
          { name: "installments", label: "عدد الأقساط (شهور)", type: "number", required: true },
          { name: "reason", label: "السبب", type: "textarea" },
        ]}
        onSubmit={(v) => { requestLoan(code, Number(v.amount), Number(v.installments), v.reason || undefined); toast({ title: "تم إرسال طلب السلفة للموارد البشرية" }); }}
      />
    </>
  );
}
export const PortalLoans = () => <PortalPage title="سلفي">{(code) => <Loans code={code} />}</PortalPage>;

// ------------------------------------------------------------------ bonuses
function Bonuses({ code }: { code: string }) {
  const rows = mineOf(usePortalStore((s) => s.bonuses), code);
  return <DataTable rows={rows} rowKey={(b) => b.id} empty="لا توجد مكافآت مقترحة لك." columns={[
    { header: "الشهر", cell: (b) => b.periodKey }, { header: "المبلغ", cell: (b) => money(b.amount) }, { header: "السبب", cell: (b) => b.reason },
  ]} />;
}
export const PortalBonuses = () => <PortalPage title="مكافآتي">{(code) => <Bonuses code={code} />}</PortalPage>;

// ------------------------------------------------------------------ deductions
const DED_LABEL: Record<DeductionStatus, string> = { notified: "تم إخطارك", objected: "اعتراض قيد النظر", upheld: "تم تأكيد الخصم", cancelled: "ملغي" };

function Deductions({ code }: { code: string }) {
  const { toast } = useToast();
  const [target, setTarget] = useState<string | null>(null);
  const rows = mineOf(usePortalStore((s) => s.deductions), code);
  return (
    <>
      <p className="text-sm text-muted-foreground">الخصومات المصنفة عليك. لك حق الاعتراض على أي خصم قبل نزول المسير.</p>
      <DataTable
        rows={rows}
        rowKey={(d) => d.id}
        empty="لا توجد خصومات مصنفة عليك."
        columns={[
          { header: "الشهر", cell: (d) => d.periodKey },
          { header: "التصنيف", cell: (d) => d.category },
          { header: "السبب", cell: (d) => d.reason },
          { header: "المبلغ", cell: (d) => money(d.amount) },
          { header: "الحالة", cell: (d) => <div>{DED_LABEL[d.status]}{d.resolution && <div className="text-xs text-muted-foreground">{d.resolution}</div>}</div> },
          { header: "", cell: (d) => d.status === "notified" ? <Button size="sm" variant="outline" onClick={() => setTarget(d.id)}>اعتراض</Button> : null },
        ]}
      />
      <FormDialog
        open={Boolean(target)}
        onOpenChange={(o) => !o && setTarget(null)}
        title="الاعتراض على الخصم"
        fields={[{ name: "objection", label: "سبب الاعتراض", type: "textarea", required: true }]}
        onSubmit={(v) => { objectToDeduction(target!, v.objection); toast({ title: "تم تسجيل اعتراضك وإرساله للموارد البشرية" }); }}
      />
    </>
  );
}
export const PortalDeductions = () => <PortalPage title="خصوماتي">{(code) => <Deductions code={code} />}</PortalPage>;
