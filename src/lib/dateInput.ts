import { normalizeDateToIso } from "@shared/date-normalization";

/**
 * Strict dd/MM/yyyy → YYYY-MM-DD. Returns null until the text is a COMPLETE, real date (4-digit
 * year, valid day/month). Partial typing like "01/03/2" therefore never changes the filter.
 */
export const parseDmyInput = (value: string): string | null => {
  const text = value.trim();
  if (!/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(text)) return null;
  return normalizeDateToIso(text) || null;
};

/** YYYY-MM-DD → dd/MM/yyyy (empty string for anything else). */
export const isoToDmy = (iso?: string | null): string => {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export const monthRangeIso = (reference = new Date()) => {
  const y = reference.getFullYear();
  const m = reference.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(last)}` };
};
