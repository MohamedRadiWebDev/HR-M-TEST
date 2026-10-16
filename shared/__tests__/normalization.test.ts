import { describe, expect, it } from "vitest";
import { excelSerialToIso, normalizeDateToIso } from "../date-normalization";
import { parsePunchWallClock } from "../punch-parser";
import { normalizeShiftStart, parseTimeValue } from "../time-normalization";
import { formatWallIso, instantToCairoWall, isoDayOfWeek, addDaysIso, wallTime } from "../wallclock";

describe("normalizeDateToIso", () => {
  it("reads text day-first, never US month-first", () => {
    expect(normalizeDateToIso("05/03/2026")).toBe("2026-03-05"); // 5 March, not 3 May
    expect(normalizeDateToIso("15/03/2026")).toBe("2026-03-15");
    expect(normalizeDateToIso("5-3-2026")).toBe("2026-03-05");
  });
  it("accepts ISO (with time), Arabic digits, Excel serials and JS Date strings", () => {
    expect(normalizeDateToIso("2026-03-05")).toBe("2026-03-05");
    expect(normalizeDateToIso("2026-03-05T10:20:00")).toBe("2026-03-05");
    expect(normalizeDateToIso("٠١/٠٣/٢٠٢٦")).toBe("2026-03-01");
    expect(normalizeDateToIso(46082)).toBe(excelSerialToIso(46082));
    expect(normalizeDateToIso("46082")).toBe(excelSerialToIso(46082));
    expect(normalizeDateToIso("Sun Mar 01 2026 00:00:00 GMT+0200 (Eastern European Standard Time)")).toBe("2026-03-01");
  });
  it("rejects impossible or unknown input", () => {
    expect(normalizeDateToIso("31/02/2026")).toBe("");
    expect(normalizeDateToIso("hello")).toBe("");
    expect(normalizeDateToIso("")).toBe("");
    expect(normalizeDateToIso(null)).toBe("");
  });
});

describe("parsePunchWallClock", () => {
  it("parses the real device format dd/MM/yyyy h:mm a", () => {
    expect(formatWallIso(parsePunchWallClock("23/12/2025 5:40 PM")!)).toBe("2025-12-23T17:40:00");
    expect(formatWallIso(parsePunchWallClock("16/12/2025 12:06 AM")!)).toBe("2025-12-16T00:06:00");
    expect(formatWallIso(parsePunchWallClock("26/12/2025 12:31 PM")!)).toBe("2025-12-26T12:31:00");
  });
  it("understands Arabic AM/PM markers and digits", () => {
    expect(formatWallIso(parsePunchWallClock("٠٥/٠٣/٢٠٢٦ ٥:٤٠ م")!)).toBe("2026-03-05T17:40:00");
    expect(formatWallIso(parsePunchWallClock("05/03/2026 9:05 ص")!)).toBe("2026-03-05T09:05:00");
  });
  it("accepts ISO without zone as wall-clock and Excel serial date-times", () => {
    expect(formatWallIso(parsePunchWallClock("2026-03-05T08:55:00")!)).toBe("2026-03-05T08:55:00");
    expect(formatWallIso(parsePunchWallClock("2026-03-05 08:55")!)).toBe("2026-03-05T08:55:00");
    const serial = 46086 + 8.5 / 24;
    expect(wallTime(parsePunchWallClock(serial)!)).toBe("08:30");
  });
  it("converts old ISO-with-Z instants using the right Cairo offset for THAT date", () => {
    expect(formatWallIso(parsePunchWallClock("2025-12-10T07:00:00.000Z")!)).toBe("2025-12-10T09:00:00"); // UTC+2
    expect(formatWallIso(parsePunchWallClock("2026-07-10T06:00:00.000Z")!)).toBe("2026-07-10T09:00:00"); // UTC+3 (DST)
    expect(formatWallIso(instantToCairoWall(new Date("2026-07-10T06:00:00Z")))).toBe("2026-07-10T09:00:00");
  });
  it("returns null for date-only, junk and impossible values", () => {
    expect(parsePunchWallClock("23/12/2025")).toBeNull();
    expect(parsePunchWallClock("nope")).toBeNull();
    expect(parsePunchWallClock("32/12/2025 5:40 PM")).toBeNull();
  });
});

describe("parseTimeValue / normalizeShiftStart", () => {
  it("parses common forms", () => {
    expect(parseTimeValue("09:00")).toEqual({ ok: true, timeHHmm: "09:00" });
    expect(parseTimeValue(0.375)).toEqual({ ok: true, timeHHmm: "09:00" });
    expect(parseTimeValue("1:15 PM")).toEqual({ ok: true, timeHHmm: "13:15" });
    expect(parseTimeValue("10:30 صباحاً")).toEqual({ ok: true, timeHHmm: "10:30" });
    expect(parseTimeValue("9 م")).toEqual({ ok: true, timeHHmm: "21:00" });
    expect(parseTimeValue("٠٩:٣٠")).toEqual({ ok: true, timeHHmm: "09:30" });
  });
  it("rejects invalid input and falls back for shift starts", () => {
    expect(parseTimeValue("25:00").ok).toBe(false);
    expect(parseTimeValue("abc").ok).toBe(false);
    expect(normalizeShiftStart("7")).toBe("07:00");
    expect(normalizeShiftStart("", "09:00")).toBe("09:00");
    expect(normalizeShiftStart("garbage")).toBe("09:00");
  });
});

describe("wallclock helpers", () => {
  it("are independent of the process time zone", () => {
    expect(isoDayOfWeek("2026-03-06")).toBe(5); // Friday
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysIso("2026-04-23", 2)).toBe("2026-04-25"); // across Cairo DST start
  });
});
