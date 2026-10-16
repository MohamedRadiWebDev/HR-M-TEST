"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageFrame } from "@/components/portal/PageFrame";
import { FormDialog } from "@/components/portal/FormDialog";
import { publishAnnouncement } from "@/portal/actions";
import { newId, surveyResults } from "@/portal/misc";
import { usePortalStore } from "@/store/portalStore";
import type { SurveyQuestion } from "@shared/portal";

/** One question per line:  rating: قيّم الإدارة   |   choice: اختر | أ, ب, ج   |   text: رأيك */
export const parseQuestions = (text: string): SurveyQuestion[] =>
  text.split("\n").map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const m = line.match(/^(rating|choice|text)\s*:\s*(.+)$/i);
    const kind = (m?.[1].toLowerCase() ?? "text") as SurveyQuestion["kind"];
    const body = m ? m[2] : line;
    if (kind === "choice") {
      const [q, opts = ""] = body.split("|");
      return { id: `q${i + 1}`, kind, text: q.trim(), options: opts.split(",").map((o) => o.trim()).filter(Boolean) };
    }
    return { id: `q${i + 1}`, kind, text: body.trim() };
  });

export default function HrCommunication() {
  const [dialog, setDialog] = useState<"announcement" | "survey" | null>(null);
  const announcements = usePortalStore((s) => s.announcements);
  const surveys = usePortalStore((s) => s.surveys);
  const responses = usePortalStore((s) => s.surveyResponses);
  const upsert = usePortalStore((s) => s.upsert);
  const patch = usePortalStore((s) => s.patch);
  const remove = usePortalStore((s) => s.remove);

  return (
    <PageFrame title="الإعلانات والاستبيانات">
      <Tabs defaultValue="announcements" dir="rtl">
        <TabsList><TabsTrigger value="announcements">الإعلانات</TabsTrigger><TabsTrigger value="surveys">الاستبيانات</TabsTrigger></TabsList>

        <TabsContent value="announcements" className="space-y-3 pt-4">
          <Button onClick={() => setDialog("announcement")}>+ إعلان جديد</Button>
          {announcements.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">لا توجد إعلانات.</div>}
          {[...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => (
            <Card key={a.id}><CardContent className="flex items-start justify-between gap-4 p-4"><div><div className="font-bold">{a.title}</div><div className="whitespace-pre-wrap text-sm">{a.body}</div></div><button className="text-red-600 text-sm" onClick={() => remove("announcements", a.id)}>حذف</button></CardContent></Card>
          ))}
        </TabsContent>

        <TabsContent value="surveys" className="space-y-3 pt-4">
          <Button onClick={() => setDialog("survey")}>+ استبيان جديد</Button>
          {surveys.length === 0 && <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">لا توجد استبيانات.</div>}
          {surveys.map((s) => {
            const results = surveyResults(s, responses);
            const count = responses.filter((r) => r.surveyId === s.id).length;
            return (
              <Card key={s.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><div className="font-bold">{s.title}</div><div className="text-xs text-muted-foreground">{s.anonymous ? "مجهول الهوية" : "بالاسم"} • {count} إجابة • {s.open ? "مفتوح" : "مغلق"}</div></div>
                    <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => patch("surveys", s.id, { open: !s.open })}>{s.open ? "إغلاق" : "فتح"}</Button><Button size="sm" variant="outline" onClick={() => remove("surveys", s.id)}>حذف</Button></div>
                  </div>
                  {s.questions.map((q) => {
                    const r = results[q.id];
                    return (
                      <div key={q.id} className="text-sm">
                        <div className="font-medium">{q.text}</div>
                        {r.kind === "rating" && <div className="text-muted-foreground">المتوسط: <strong>{r.average}</strong> / 5 ({r.count} إجابة)</div>}
                        {r.kind === "choice" && <div className="text-muted-foreground">{Object.entries(r.counts).map(([k, v]) => `${k}: ${v}`).join(" • ") || "—"}</div>}
                        {r.kind === "text" && <ul className="list-disc pr-5 text-muted-foreground">{r.answers.length ? r.answers.map((a, i) => <li key={i}>{a}</li>) : <li>—</li>}</ul>}
                      </div>
                    );
                  })}
                  {s.anonymous && <p className="text-xs text-muted-foreground">النتائج مجمّعة ولا تظهر هوية المجيب.</p>}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      <FormDialog open={dialog === "announcement"} onOpenChange={(o) => !o && setDialog(null)} title="إعلان جديد" fields={[{ name: "title", label: "العنوان", required: true }, { name: "body", label: "النص", type: "textarea", required: true }]}
        onSubmit={(v) => publishAnnouncement(v.title, v.body)} />
      <FormDialog open={dialog === "survey"} onOpenChange={(o) => !o && setDialog(null)} title="استبيان جديد" fields={[
        { name: "title", label: "العنوان", required: true },
        { name: "anonymous", label: "الخصوصية", type: "select", options: [{ value: "yes", label: "مجهول الهوية" }, { value: "no", label: "بالاسم" }] },
        { name: "questions", label: "الأسئلة (سؤال في كل سطر)", type: "textarea", required: true, placeholder: "rating: قيّم بيئة العمل\nchoice: أفضل وقت للاجتماع | صباحًا, ظهرًا\ntext: اقتراحاتك" },
      ]} onSubmit={(v) => {
        const questions = parseQuestions(v.questions);
        if (questions.length === 0) throw new Error("اكتب سؤالًا واحدًا على الأقل.");
        upsert("surveys", { id: newId(), title: v.title, anonymous: v.anonymous !== "no", open: true, questions, createdAt: new Date().toISOString() });
      }} />
    </PageFrame>
  );
}
