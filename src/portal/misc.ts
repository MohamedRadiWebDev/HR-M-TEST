import { addDaysIso } from "@shared/wallclock";
import type { Employee } from "@shared/schema";
import type { PortalNotification, Survey, SurveyResponse } from "@shared/portal";

export type Occasion = { employeeCode: string; name: string; kind: "birthday" | "anniversary"; date: string; years?: number };

/** Birthdays and work anniversaries in the next `days` days (shown on the announcements page). */
export const upcomingOccasions = (employees: Employee[], todayIso: string, days = 7): Occasion[] => {
  const out: Occasion[] = [];
  for (let i = 0; i <= days; i++) {
    const day = addDaysIso(todayIso, i);
    const [y, m, d] = day.split("-").map(Number);
    employees.forEach((e) => {
      if (e.terminationDate && e.terminationDate < day) return;
      const mmdd = `-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (e.birthDate?.endsWith(mmdd)) out.push({ employeeCode: e.code, name: e.nameAr, kind: "birthday", date: day });
      if (e.hireDate?.endsWith(mmdd) && Number(e.hireDate.slice(0, 4)) < y) {
        out.push({ employeeCode: e.code, name: e.nameAr, kind: "anniversary", date: day, years: y - Number(e.hireDate.slice(0, 4)) });
      }
    });
  }
  return out;
};

/** Non-cryptographic FNV-1a key: only used to stop double answers without storing who answered. */
export const respondentKey = (surveyId: string, employeeCode: string) => {
  let h = 0x811c9dc5;
  for (const ch of `${surveyId}|${employeeCode}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

export type QuestionResult =
  | { kind: "rating"; average: number; count: number }
  | { kind: "choice"; counts: Record<string, number> }
  | { kind: "text"; answers: string[] };

export const surveyResults = (survey: Survey, responses: SurveyResponse[]): Record<string, QuestionResult> => {
  const mine = responses.filter((r) => r.surveyId === survey.id);
  const out: Record<string, QuestionResult> = {};
  survey.questions.forEach((q) => {
    const values = mine.map((r) => r.answers[q.id]).filter((v) => v !== undefined && v !== "");
    if (q.kind === "rating") {
      const nums = values.map(Number).filter(Number.isFinite);
      out[q.id] = { kind: "rating", count: nums.length, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0 };
    } else if (q.kind === "choice") {
      const counts: Record<string, number> = {};
      values.forEach((v) => (counts[String(v)] = (counts[String(v)] ?? 0) + 1));
      out[q.id] = { kind: "choice", counts };
    } else {
      out[q.id] = { kind: "text", answers: values.map(String) };
    }
  });
  return out;
};

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const makeNotification = (employeeCode: string, title: string, body?: string, link?: string): PortalNotification => ({
  id: newId(), employeeCode, title, body, link, createdAt: new Date().toISOString(), read: false,
});
