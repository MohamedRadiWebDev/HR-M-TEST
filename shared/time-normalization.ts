import { toAsciiDigits } from "./date-normalization";

export type ParsedTime = { ok: true; timeHHmm: string } | { ok: false; reason: string };

const toHHmm = (hours: number, minutes: number) =>
  `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

const fromExcelFraction = (fraction: number) => {
  const normalized = ((fraction % 1) + 1) % 1;
  const totalMinutes = Math.round(normalized * 24 * 60) % (24 * 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
};

const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g; // tanween / harakat / tatweel

/**
 * Parses an Excel/text time into HH:mm.
 * Supports: Excel fractions, Date objects (local fields), "9", "9.30", "09:00", "1:15 PM",
 * "10:30 صباحاً", "9 م", "٠٩:٣٠".
 */
export const parseTimeValue = (value: unknown): ParsedTime => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { ok: false, reason: "القيمة فارغة" };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = value > 1 ? value % 1 : value;
    const { hours, minutes } = fromExcelFraction(fraction);
    return { ok: true, timeHHmm: toHHmm(hours, minutes) };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { ok: true, timeHHmm: toHHmm(value.getHours(), value.getMinutes()) };
  }

  let text = toAsciiDigits(String(value)).replace(ARABIC_MARKS, "").trim();
  if (!text) return { ok: false, reason: "القيمة فارغة" };

  const hasPM = /(\bpm\b|p\.m|مساء|(?<=[\d\s])م$)/i.test(text) || /\d\s*م\b/.test(text);
  const hasAM = /(\bam\b|a\.m|صباح|(?<=[\d\s])ص$)/i.test(text) || /\d\s*ص\b/.test(text);
  text = text
    .replace(/(p\.m|a\.m|pm|am|مساء[اً]?|صباح[اً]?|ص|م)/gi, "")
    .replace(/\./g, ":")
    .replace(/\s+/g, "")
    .trim();

  const parts = text.split(":").filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => /^\d+$/.test(p))) {
    return { ok: false, reason: "تنسيق وقت غير صالح" };
  }

  let h = Number(parts[0]);
  const minute = parts.length >= 2 ? Number(parts[1]) : 0;
  if (parts.length === 1 && h > 23) return { ok: false, reason: "ساعة غير صالحة" };

  if (hasPM && h < 12) h += 12;
  if (hasAM && h === 12) h = 0;

  if (h < 0 || h > 23 || minute < 0 || minute > 59) return { ok: false, reason: "وقت غير صالح" };
  return { ok: true, timeHHmm: toHHmm(h, minute) };
};

/** Normalises a shift-start cell to HH:mm, falling back to `fallback` for empty/invalid input. */
export const normalizeShiftStart = (value: unknown, fallback = "09:00"): string => {
  const parsed = parseTimeValue(value);
  return parsed.ok ? parsed.timeHHmm : fallback;
};
