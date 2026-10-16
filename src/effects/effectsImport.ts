import { normalizeEmployeeCode } from "@shared/employee-code";
import { normalizeEffectDateKey, normalizeEffectType } from "@shared/effect-normalization";
import { resolveShiftForDate, timeStringToSeconds } from "@/engine/attendanceEngine";
import { readFirstSheetRows, type SheetSpec } from "@/lib/excel";
import { wallDateKey, wallSecondsOfDay } from "@shared/wallclock";
import { parseTimeCell } from "@/effects/timeParser";
import type { Employee, BiometricPunch, SpecialRule } from "@shared/schema";
import type { Effect } from "@/store/effectsStore";

export const EFFECT_EXPORT_HEADERS = ["الكود", "الاسم", "التاريخ", "من", "الي", "النوع", "الحالة", "ملاحظة"] as const;
export const EFFECT_TYPE_OPTIONS = [
  "مأمورية",
  "إذن صباحي",
  "إذن مسائي",
  "إذن عام",
  "إجازة نص يوم",
  "إجازة من الرصيد",
  "إجازة بالخصم",
  "إجازة بدل",
  "غياب بعذر",
  "إجازة رسمية",
  "إجازة تحصيل",
] as const;

export type ParsedEffectValidation = {
  rowIndex: number;
  valid: boolean;
  reason?: string;
};

export type ParseEffectsResult = {
  validRows: Omit<Effect, "id" | "createdAt" | "updatedAt">[];
  invalidRows: ParsedEffectValidation[];
};

const normalizeHeader = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/[\u0640\s_]+/g, "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("إ", "ا")
    .replace("أ", "ا")
    .replace("آ", "ا")
    .toLowerCase();

const HEADER_ALIASES: Record<string, string[]> = {
  code: ["الكود", "كود", "code"],
  name: ["الاسم", "اسم", "name"],
  date: ["التاريخ", "date"],
  from: ["من", "from"],
  to: ["الي", "إلى", "الى", "to"],
  type: ["النوع", "type"],
  status: ["الحالة", "status"],
  note: ["ملاحظة", "ملاحظه", "note", "notes"],
};

const resolveHeaderIndexes = (headers: unknown[]) => {
  const normalizedHeaders = headers.map((h) => normalizeHeader(h));
  const findIndex = (aliases: string[]) => {
    const normalizedAliases = aliases.map(normalizeHeader);
    return normalizedHeaders.findIndex((h) => normalizedAliases.includes(h));
  };

  const indexes = {
    code: findIndex(HEADER_ALIASES.code),
    name: findIndex(HEADER_ALIASES.name),
    date: findIndex(HEADER_ALIASES.date),
    from: findIndex(HEADER_ALIASES.from),
    to: findIndex(HEADER_ALIASES.to),
    type: findIndex(HEADER_ALIASES.type),
    status: findIndex(HEADER_ALIASES.status),
    note: findIndex(HEADER_ALIASES.note),
  };

  const requiredMissing = ["code", "name", "date", "from", "to", "type"].filter((k) => (indexes as any)[k] < 0);
  return { indexes, requiredMissing };
};

/** Punches indexed by `employeeCode__YYYY-MM-DD` (sorted) – built once per import. */
const indexPunches = (punches: BiometricPunch[]) => {
  const index = new Map<string, BiometricPunch[]>();
  punches.forEach((p) => {
    const key = `${normalizeEmployeeCode(p.employeeCode)}__${wallDateKey(p.punchDatetime)}`;
    const list = index.get(key);
    if (list) list.push(p);
    else index.set(key, [p]);
  });
  index.forEach((list) => list.sort((a, b) => a.punchDatetime.getTime() - b.punchDatetime.getTime()));
  return index;
};

/** Decides whether a half-day leave covered the morning or the evening, based on the punches. */
const inferHalfDaySide = ({
  dayPunches,
  shiftStart,
  shiftEnd,
}: {
  dayPunches: BiometricPunch[];
  shiftStart: string;
  shiftEnd: string;
}): "morning" | "evening" => {
  if (dayPunches.length === 0) return "morning";
  const shiftStartSec = timeStringToSeconds(shiftStart);
  const shiftEndSec = timeStringToSeconds(shiftEnd);
  const first = wallSecondsOfDay(dayPunches[0].punchDatetime);
  const last = wallSecondsOfDay(dayPunches[dayPunches.length - 1].punchDatetime);

  if (dayPunches.length > 1 && last <= shiftEndSec - 2 * 3600) return "evening"; // left early
  if (first >= shiftStartSec + 2 * 3600) return "morning"; // arrived late
  return "morning";
};

export const parseEffectsSheet = async ({
  file,
  employees,
  punches,
  rules,
}: {
  file: File;
  employees: Employee[];
  punches: BiometricPunch[];
  rules: SpecialRule[];
}): Promise<ParseEffectsResult> => {
  const rows = await readFirstSheetRows(file);
  const punchIndex = indexPunches(punches || []);
  const headerRow = rows[0] || [];

  const { indexes, requiredMissing } = resolveHeaderIndexes(headerRow);
  if (requiredMissing.length > 0) {
    throw new Error("رأس الملف غير مطابق. الأعمدة المطلوبة: الكود | الاسم | التاريخ | من | الي | النوع");
  }

  const employeeMap = new Map((employees || []).map((e) => [normalizeEmployeeCode(e.code), e]));
  const validRows: Omit<Effect, "id" | "createdAt" | "updatedAt">[] = [];
  const invalidRows: ParsedEffectValidation[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowIndex = index + 2;
    const employeeCode = normalizeEmployeeCode(row[indexes.code]);
    const employeeName = String(row[indexes.name] || "").trim();
    const date = normalizeEffectDateKey(row[indexes.date]);

    const fromParsed = indexes.from >= 0 ? parseTimeCell(row[indexes.from]) : { ok: false as const, reason: "empty" };
    const toParsed = indexes.to >= 0 ? parseTimeCell(row[indexes.to]) : { ok: false as const, reason: "empty" };
    let fromTime = fromParsed.ok ? fromParsed.timeHHmm : "";
    let toTime = toParsed.ok ? toParsed.timeHHmm : "";

    const type = normalizeEffectType(row[indexes.type]);
    const status = indexes.status >= 0 ? String(row[indexes.status] || "").trim() : "";
    const note = indexes.note >= 0 ? String(row[indexes.note] || "").trim() : "";

    if (!employeeCode) return invalidRows.push({ rowIndex, valid: false, reason: "الكود مطلوب" });
    const emp = employeeMap.get(employeeCode);
    if (!emp) return invalidRows.push({ rowIndex, valid: false, reason: "كود الموظف غير موجود" });
    if (!date) return invalidRows.push({ rowIndex, valid: false, reason: "تاريخ غير صالح" });
    if (!type) return invalidRows.push({ rowIndex, valid: false, reason: "النوع مطلوب" });

    const shift = resolveShiftForDate({ employee: emp, dateStr: date, rules });
    const shiftStartSec = timeStringToSeconds(shift.shiftStart);
    const shiftEndSec = timeStringToSeconds(shift.shiftEnd);

    if (type === "مأمورية") {
      if (!fromTime || !toTime) return invalidRows.push({ rowIndex, valid: false, reason: "المأمورية تتطلب من وإلى" });
      if (fromTime === toTime) return invalidRows.push({ rowIndex, valid: false, reason: "وقت البداية يساوي وقت النهاية" });
      if (timeStringToSeconds(`${toTime}:00`) < timeStringToSeconds(`${fromTime}:00`)) {
        return invalidRows.push({ rowIndex, valid: false, reason: "وقت النهاية قبل البداية" });
      }
    }

    if ((type === "اذن صباحي" || type === "اذن مسائي") && (!fromTime || !toTime)) {
      fromTime = "";
      toTime = "";
    }

    if ((type === "اجازة نصف يوم" || type === "اجازة نص يوم") && (!fromTime || !toTime)) {
      const side = inferHalfDaySide({ dayPunches: punchIndex.get(`${employeeCode}__${date}`) || [], shiftStart: shift.shiftStart, shiftEnd: shift.shiftEnd });
      if (side === "morning") {
        fromTime = `${String(Math.floor(shiftStartSec / 3600)).padStart(2, "0")}:${String(Math.floor((shiftStartSec % 3600) / 60)).padStart(2, "0")}`;
        toTime = `${String(Math.floor((shiftStartSec + 4 * 3600) / 3600)).padStart(2, "0")}:${String(Math.floor(((shiftStartSec + 4 * 3600) % 3600) / 60)).padStart(2, "0")}`;
      } else {
        fromTime = `${String(Math.floor((shiftEndSec - 4 * 3600) / 3600)).padStart(2, "0")}:${String(Math.floor(((shiftEndSec - 4 * 3600) % 3600) / 60)).padStart(2, "0")}`;
        toTime = `${String(Math.floor(shiftEndSec / 3600)).padStart(2, "0")}:${String(Math.floor((shiftEndSec % 3600) / 60)).padStart(2, "0")}`;
      }
    }

    validRows.push({
      employeeCode,
      employeeName,
      date,
      fromTime,
      toTime,
      type,
      status,
      note,
      source: "excel",
    });
  });

  return { validRows, invalidRows };
};

export const buildEffectsTemplateSheets = (): SheetSpec[] => [
  {
    name: "المؤثرات",
    rows: [
      [...EFFECT_EXPORT_HEADERS],
      ["648", "أحمد علي", "2025-01-05", "", "", "إذن صباحي", "معتمد", "سماح أول ساعتين"],
      ["648", "أحمد علي", "2025-01-06", "", "", "إذن مسائي", "معتمد", "سماح آخر ساعتين"],
      ["701", "منى سالم", "2025-01-07", "", "", "إجازة نص يوم", "موافق", "نصف يوم"],
      ["701", "منى سالم", "2025-01-08", 0.375, 13 / 24, "مأمورية", "موافق", "مأمورية (نص)"],
      ["703", "دينا شريف", "2025-01-08", "", "", "إجازة بدل", "معتمد", "استخدام يوم بدل"],
      ["702", "عمرو محمد", "2025-01-09", "", "", "غياب بعذر", "معتمد", "مستند طبي"],
    ],
    timeColumns: [4, 5],
    validations: [{ column: 6, values: EFFECT_TYPE_OPTIONS }],
  },
];
