import { toAsciiDigits } from "./date-normalization";
import { buildValidWall, instantToCairoWall, makeWall } from "./wallclock";

/** Normalises Arabic/English AM-PM markers to AM / PM. */
const normalizeMeridiem = (text: string): string =>
  text
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    // JS \b does not understand Arabic letters → use explicit look-aheads.
    .replace(/(صباح[اً]?|ص)(?=\s|$)/g, "AM")
    .replace(/(مساء[اً]?|م)(?=\s|$)/g, "PM")
    .replace(/\b([ap])\.m\.?/gi, "$1m");

const applyMeridiem = (hour: number, meridiem?: string): number => {
  if (!meridiem) return hour;
  const pm = meridiem.toUpperCase() === "PM";
  if (pm && hour < 12) return hour + 12;
  if (!pm && hour === 12) return 0;
  return hour;
};

/**
 * Converts a punch cell to a floating wall-clock Date (see `wallclock.ts`), or null if it is not a
 * complete date+time.
 *
 * - `Date`   → its local clock digits are kept as wall-clock.
 * - number   → Excel serial date-time.
 * - string   → dd/MM/yyyy [h:mm[:ss] [AM|PM|ص|م]] (day-first), ISO `yyyy-MM-dd[T ]HH:mm[:ss]`.
 *              ISO text with a `Z`/offset is a real instant (old backups) and is converted to Cairo
 *              wall-clock for that instant (handles DST correctly).
 */
export const parsePunchWallClock = (raw: unknown): Date | null => {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    // A plain Date carries the user's *local* clock reading – keep those digits as wall-clock.
    return makeWall(raw.getFullYear(), raw.getMonth() + 1, raw.getDate(), raw.getHours(), raw.getMinutes(), raw.getSeconds());
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 20000 || raw > 80000) return null;
    const ms = Date.UTC(1899, 11, 30) + Math.round(raw * 86400000);
    const d = new Date(ms);
    // drop sub-second noise
    d.setUTCMilliseconds(0);
    return d;
  }

  const text = normalizeMeridiem(toAsciiDigits(String(raw ?? "")).trim().replace(/\s+/g, " "));
  if (!text) return null;

  // ISO with explicit zone → real instant
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const instant = new Date(text);
    return Number.isNaN(instant.getTime()) ? null : instantToCairoWall(instant);
  }

  let m = text.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?$/i
  );
  if (m) {
    const h = applyMeridiem(Number(m[4]), m[7]);
    return buildValidWall(Number(m[1]), Number(m[2]), Number(m[3]), h, Number(m[5]), Number(m[6] ?? 0));
  }

  m = text.match(
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i
  );
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [day, month] = b > 12 && a <= 12 ? [b, a] : [a, b]; // day-first unless impossible
    const h = applyMeridiem(Number(m[4]), m[7]);
    return buildValidWall(Number(m[3]), month, day, h, Number(m[5]), Number(m[6] ?? 0));
  }

  if (/^\d{5}(\.\d+)?$/.test(text)) return parsePunchWallClock(Number(text));
  return null;
};

export { makeWall };
