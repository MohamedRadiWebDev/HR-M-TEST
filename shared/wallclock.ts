/**
 * "Floating wall-clock" helpers.
 *
 * Biometric devices record the *local time on the wall* (e.g. 09:05). We therefore keep punches as
 * `Date` objects whose **UTC fields** are the wall-clock fields. That makes every calculation
 * independent of the browser time zone and of Egypt's daylight-saving shifts.
 *
 * Rule of thumb: never call getHours()/getDate()/toISOString() on a floating Date – use the helpers
 * in this file.
 */

export const CAIRO_TIME_ZONE = "Africa/Cairo";

const pad2 = (n: number) => String(n).padStart(2, "0");

export const makeWall = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi, s, 0));

export const isValidWall = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

/** YYYY-MM-DD of a floating Date. */
export const wallDateKey = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** HH:mm of a floating Date. */
export const wallTime = (d: Date): string => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;

/** HH:mm:ss of a floating Date. */
export const wallTimeSeconds = (d: Date): string =>
  `${wallTime(d)}:${pad2(d.getUTCSeconds())}`;

/** Seconds since midnight of a floating Date. */
export const wallSecondsOfDay = (d: Date): number =>
  d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();

/** YYYY-MM-DDTHH:mm:ss (no zone suffix – this is wall-clock text). */
export const formatWallIso = (d: Date): string => `${wallDateKey(d)}T${wallTimeSeconds(d)}`;

/** dd/MM/yyyy HH:mm for display. */
export const formatWallDisplay = (d: Date): string => {
  const [y, m, day] = wallDateKey(d).split("-");
  return `${day}/${m}/${y} ${wallTime(d)}`;
};

/** Parses "YYYY-MM-DDTHH:mm[:ss]" / "YYYY-MM-DD HH:mm[:ss]" as wall-clock. Returns null if invalid. */
export const parseWallIso = (text: string): Date | null => {
  const m = String(text ?? "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return buildValidWall(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0));
};

/** Builds a floating Date only when every component is a real calendar/clock value. */
export const buildValidWall = (
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0
): Date | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) {
    return null;
  }
  const date = makeWall(y, mo, d, h, mi, s);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
};

const cairoFormatter = (() => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: CAIRO_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
})();

/**
 * Converts a real instant (e.g. a legacy ISO string with "Z") into Cairo wall-clock time, using the
 * correct offset for *that* instant (handles daylight saving). Falls back to the fixed +02:00 offset
 * if `Intl` has no time-zone data.
 */
export const instantToCairoWall = (instant: Date): Date => {
  if (cairoFormatter) {
    const parts = Object.fromEntries(
      cairoFormatter.formatToParts(instant).map((p) => [p.type, p.value])
    ) as Record<string, string>;
    return makeWall(
      Number(parts.year),
      Number(parts.month),
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    );
  }
  return new Date(instant.getTime() + 2 * 3600 * 1000);
};

/** Days between two YYYY-MM-DD keys (b - a). */
export const diffDaysIso = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export const addDaysIso = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return wallDateKey(d);
};

/** Day of week (0 = Sunday) for a YYYY-MM-DD key, time-zone independent. */
export const isoDayOfWeek = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();
