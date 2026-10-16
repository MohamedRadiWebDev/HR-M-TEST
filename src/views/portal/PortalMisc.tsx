"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortalPage } from "@/components/portal/PageFrame";
import { DataTable } from "@/components/portal/DataTable";
import { FormDialog, type Field } from "@/components/portal/FormDialog";
import { useToast } from "@/hooks/use-toast";
import { newId, respondentKey, upcomingOccasions } from "@/portal/misc";
import { todayIso } from "@/lib/dateInput";
import { useAttendanceStore } from "@/store/attendanceStore";
import { usePortalStore } from "@/store/portalStore";
import { normalizeEmployeeCode } from "@shared/employee-code";
import type { CustodyStatus } from "@shared/portal";
import { cn } from "@/lib/utils";

const same = (a: string, b: string) => normalizeEmployeeCode(a) === normalizeEmployeeCode(b);

// ------------------------------------------------------------------ custody
export const CUSTODY_LABEL: Record<CustodyStatus, string> = { pending: "بانتظار تأكيدك", active: "عهدة نشطة", returned: "تم تسليمها", lost: "مفقودة" };

function Custody({ code }: { code: string }) {
  const patch = usePortalStore((s) => s.patch);
  const rows = usePortalStore((s) => s.custody).filter((c) => same(c.employeeCode, code));
  const count = (s: CustodyStatus) => rows.filter((c) => c.status === s).length;
  return (
    <>
      <p className="text-sm text-muted-foreground">العهد المسلّمة لك. العهدة تُقفل بعد تأكيد استلامك.</p>
      <div className="grid gap-4 sm:grid-cols-4">
        {(["pending", "active", "returned", "lost"] as const).map((s) => (<Card key={s}><CardContent className="p-5 text-center"><div className="text-2xl font-bold">{count(s)}</div><div className="text-sm text-muted-foreground">{CUSTODY_LABEL[s]}</div></CardContent></Card>))}
      </div>
      <DataTable
        rows={rows}
        rowKey={(c) => c.id}
        empty="لا توجد عهد مسجلة عليك."
        columns={[
          { header: "العهدة", cell: (c) => c.name }, { header: "الرقم التسلسلي", cell: (c) => c.serial || "-" },
          { header: "تاريخ التسليم", cell: (c) => c.assignedAt.slice(0, 10) }, { header: "الحالة", cell: (c) => CUSTODY_LABEL[c.status] },
          { header: "", cell: (c) => c.status === "pending" ? <Button size="sm" onClick={() => patch("custody", c.id, { status: "active" })}>تأكيد الاستلام</Button> : null },
        ]}
      />
    </>
  );
}
export const PortalCustody = () => <PortalPage title="عهدي">{(code) => <Custody code={code} />}</PortalPage>;

// ------------------------------------------------------------------ documents
function Documents({ code }: { code: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const required = usePortalStore((s) => s.settings.requiredDocuments);
  const docs = usePortalStore((s) => s.documents).filter((d) => same(d.employeeCode, code));
  const upsert = usePortalStore((s) => s.upsert);
  const remove = usePortalStore((s) => s.remove);
  const missing = required.filter((t) => !docs.some((d) => d.type === t));
  const options = [...required, "أخرى"].map((t) => ({ value: t, label: t }));

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>مسوغات التعيين المطلوبة منك</CardTitle>
          <span className={cn("rounded-full px-3 py-1 text-xs", missing.length ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>{missing.length ? `ناقص ${missing.length} من ${required.length}` : "مكتملة"}</span>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {required.map((t) => (<div key={t} className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>{t}</span><span className={docs.some((d) => d.type === t) ? "text-emerald-600" : "text-red-600"}>{docs.some((d) => d.type === t) ? "✓ مرفوع" : "✗ ناقص"}</span></div>))}
        </CardContent>
      </Card>
      <div className="flex justify-end"><Button onClick={() => setOpen(true)}>+ رفع مستند</Button></div>
      <DataTable
        rows={docs}
        rowKey={(d) => d.id}
        empty="لا توجد مستندات مسجلة في ملفك."
        columns={[
          { header: "النوع", cell: (d) => d.type }, { header: "الاسم", cell: (d) => d.name },
          { header: "ينتهي في", cell: (d) => d.expiry || "-" }, { header: "رُفع في", cell: (d) => d.uploadedAt.slice(0, 10) },
          { header: "", cell: (d) => (<div className="flex gap-2">{d.dataUrl && <a className="text-primary underline" href={d.dataUrl} download={d.name}>تحميل</a>}<button className="text-red-600" onClick={() => remove("documents", d.id)}>حذف</button></div>) },
        ]}
      />
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="رفع مستند"
        fields={[
          { name: "type", label: "نوع المستند", type: "select", options, required: true },
          { name: "expiry", label: "تاريخ الانتهاء (إن وجد)", type: "date" },
          { name: "file", label: "الملف (حتى 2 ميجا)", type: "file", required: true },
        ]}
        onSubmit={(v) => {
          upsert("documents", { id: newId(), employeeCode: code, type: v.type, name: v.fileName || v.type, expiry: v.expiry || undefined, dataUrl: v.file, uploadedAt: new Date().toISOString() });
          toast({ title: "تم رفع المستند" });
        }}
      />
    </>
  );
}
export const PortalDocuments = () => <PortalPage title="مستنداتي">{(code) => <Documents code={code} />}</PortalPage>;

// ------------------------------------------------------------------ announcements
function Announcements() {
  const list = [...usePortalStore((s) => s.announcements)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const employees = useAttendanceStore((s) => s.employees);
  const occasions = upcomingOccasions(employees, todayIso(), 7);
  return (
    <>
      <Card>
        <CardHeader><CardTitle>مناسبات زملائك هذا الأسبوع</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {occasions.length === 0 && <div className="text-muted-foreground">لا توجد مناسبات قريبة.</div>}
          {occasions.map((o, i) => (<div key={i} className="flex justify-between"><span>{o.kind === "birthday" ? "🎂 عيد ميلاد" : "🎉"} {o.name}{o.kind === "anniversary" ? ` — ${o.years} سنة في الشركة` : ""}</span><span className="text-muted-foreground">{o.date === todayIso() ? "اليوم" : o.date.slice(5)}</span></div>))}
        </CardContent>
      </Card>
      {list.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">مفيش إعلانات دلوقتي.</div>}
      {list.map((a) => (<Card key={a.id}><CardContent className="space-y-1 p-5"><div className="font-bold">{a.title}</div><div className="whitespace-pre-wrap text-sm">{a.body}</div><div className="text-xs text-muted-foreground">{a.createdAt.slice(0, 10)}</div></CardContent></Card>))}
    </>
  );
}
export const PortalAnnouncements = () => <PortalPage title="الإعلانات">{() => <Announcements />}</PortalPage>;

// ------------------------------------------------------------------ surveys
function Surveys({ code }: { code: string }) {
  const { toast } = useToast();
  const surveys = usePortalStore((s) => s.surveys).filter((s) => s.open);
  const responses = usePortalStore((s) => s.surveyResponses);
  const upsert = usePortalStore((s) => s.upsert);
  const [active, setActive] = useState<string | null>(null);
  const survey = surveys.find((s) => s.id === active);

  const answered = (id: string, anonymous: boolean) =>
    responses.some((r) => r.surveyId === id && (anonymous ? r.respondent === respondentKey(id, code) : r.respondent === code));

  const fields: Field[] = (survey?.questions ?? []).map((q) =>
    q.kind === "rating"
      ? { name: q.id, label: q.text, type: "select", options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })), required: true }
      : q.kind === "choice"
        ? { name: q.id, label: q.text, type: "select", options: (q.options ?? []).map((o) => ({ value: o, label: o })), required: true }
        : { name: q.id, label: q.text, type: "textarea" }
  );

  return (
    <>
      {surveys.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">مفيش استبيانات مستنية ردك.</div>}
      {surveys.map((s) => (
        <Card key={s.id}>
          <CardContent className="flex items-center justify-between p-5">
            <div><div className="font-bold">{s.title}</div><div className="text-xs text-muted-foreground">{s.anonymous ? "مجهول الهوية" : "باسمك"} • {s.questions.length} سؤال</div></div>
            {answered(s.id, s.anonymous) ? <span className="text-sm text-emerald-600">✓ تمت الإجابة</span> : <Button onClick={() => setActive(s.id)}>إجابة</Button>}
          </CardContent>
        </Card>
      ))}
      <FormDialog
        open={Boolean(survey)}
        onOpenChange={(o) => !o && setActive(null)}
        title={survey?.title ?? ""}
        fields={fields}
        submitLabel="إرسال"
        onSubmit={(v) => {
          const answers = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, survey!.questions.find((q) => q.id === k)?.kind === "rating" ? Number(val) : val]));
          upsert("surveyResponses", { id: newId(), surveyId: survey!.id, respondent: survey!.anonymous ? respondentKey(survey!.id, code) : code, answers, createdAt: new Date().toISOString() });
          toast({ title: "شكرًا، تم تسجيل إجابتك" });
        }}
      />
    </>
  );
}
export const PortalSurveys = () => <PortalPage title="الاستبيانات">{(code) => <Surveys code={code} />}</PortalPage>;
