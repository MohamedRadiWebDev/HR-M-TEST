/**
 * Excel helpers built on ExcelJS (the SheetJS "xlsx" package was removed: its npm release has
 * unfixed prototype-pollution / ReDoS advisories and a second Excel library doubled the bundle).
 *
 * Reading: every cell becomes a plain primitive (string | number | boolean). Date cells become
 * wall-clock TEXT (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss`, or `HH:mm:ss` for time-only cells) so no
 * time-zone conversion can ever shift them.
 */

export type CellPrimitive = string | number | boolean;
export type SheetRows = { name: string; rows: CellPrimitive[][] };

export type SheetSpec = {
  name: string;
  rows: unknown[][];
  rtl?: boolean;
  /** Column widths in characters. */
  widths?: number[];
  /** 1-based column indexes whose numeric cells hold Excel time fractions. */
  timeColumns?: number[];
  /** List validations applied to rows 2..lastRow of a 1-based column. */
  validations?: { column: number; values: readonly string[]; lastRow?: number }[];
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const loadExcelJS = async () => {
  const mod: any = await import("exceljs");
  return (mod.default ?? mod) as typeof import("exceljs");
};

const dateCellToText = (d: Date): string => {
  const y = d.getUTCFullYear();
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  if (y <= 1900) return time; // time-only cells are stored as 1899-12-30 + fraction
  const day = `${y}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return time === "00:00:00" ? day : `${day}T${time}`;
};

export const normalizeCellValue = (value: unknown): CellPrimitive => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : dateCellToText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text?: string }[]).map((part) => part.text ?? "").join("").trim();
    }
    if ("result" in obj) return normalizeCellValue(obj.result); // formula
    if ("text" in obj) return normalizeCellValue(obj.text); // hyperlink
    if ("error" in obj) return "";
  }
  return String(value).trim();
};

export const readWorkbookRows = async (input: File | Blob | ArrayBuffer): Promise<SheetRows[]> => {
  const ExcelJS = await loadExcelJS();
  const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error("تعذر قراءة الملف. تأكد أنه ملف Excel بصيغة .xlsx (الصيغة القديمة .xls غير مدعومة).");
  }

  return workbook.worksheets.map((sheet) => {
    const rows: CellPrimitive[][] = [];
    const width = sheet.actualColumnCount || sheet.columnCount || 0;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: CellPrimitive[] = [];
      for (let col = 1; col <= width; col++) cells.push(normalizeCellValue(row.getCell(col).value));
      rows.push(cells);
    });
    return { name: sheet.name, rows };
  });
};

/** First worksheet as array of rows (header row included). */
export const readFirstSheetRows = async (input: File | Blob | ArrayBuffer): Promise<CellPrimitive[][]> => {
  const sheets = await readWorkbookRows(input);
  return sheets[0]?.rows ?? [];
};

/** Rows → objects keyed by the (trimmed) header row; fully empty rows are dropped. */
export const rowsToObjects = (rows: CellPrimitive[][]): Record<string, CellPrimitive>[] => {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h ?? "").trim());
  const out: Record<string, CellPrimitive>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((cell) => cell === "")) continue;
    const obj: Record<string, CellPrimitive> = {};
    headers.forEach((header, idx) => {
      if (header) obj[header] = row[idx] ?? "";
    });
    out.push(obj);
  }
  return out;
};

export const readFirstSheetObjects = async (input: File | Blob | ArrayBuffer) =>
  rowsToObjects(await readFirstSheetRows(input));

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------
export const buildWorkbook = async (sheets: SheetSpec[]) => {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  for (const spec of sheets) {
    const ws = workbook.addWorksheet(spec.name.slice(0, 31), {
      views: [{ rightToLeft: spec.rtl ?? true, state: "frozen", ySplit: 1 }],
    });
    spec.rows.forEach((row) => ws.addRow(row.map((cell) => (cell === undefined ? "" : cell)) as any[]));

    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "center" };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

    const colCount = Math.max(...spec.rows.map((r) => r.length), 1);
    for (let c = 1; c <= colCount; c++) {
      const longest = spec.rows.reduce((max, r) => Math.max(max, String(r[c - 1] ?? "").length), 8);
      ws.getColumn(c).width = spec.widths?.[c - 1] ?? Math.min(Math.max(longest + 2, 10), 45);
    }

    spec.timeColumns?.forEach((col) => {
      ws.getColumn(col).numFmt = "hh:mm";
    });

    const lastRow = Math.max(spec.rows.length, 2);
    spec.validations?.forEach(({ column, values, lastRow: last }) => {
      for (let r = 2; r <= (last ?? Math.max(lastRow, 200)); r++) {
        ws.getCell(r, column).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${values.join(",")}"`],
        };
      }
    });
  }
  return workbook;
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor); // required by Firefox
  anchor.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1500);
};

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const downloadWorkbook = async (workbook: { xlsx: { writeBuffer: () => Promise<ArrayBuffer | Uint8Array | Buffer> } }, filename: string) => {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer as BlobPart], { type: XLSX_MIME }), filename);
};

export const downloadSheets = async (filename: string, sheets: SheetSpec[]) => {
  await downloadWorkbook(await buildWorkbook(sheets), filename);
};

/** Array of plain objects → sheet rows (header = keys of the first row, or `headers` when given). */
export const jsonToSheet = (name: string, rows: Record<string, unknown>[], headers?: readonly string[]): SheetSpec => {
  const keys = headers ? [...headers] : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return { name, rows: [keys, ...rows.map((row) => keys.map((key) => row[key] ?? ""))] };
};
