import { ENGINE_CONFIG } from "@/engine/config";
import { STATUS_AR_VALUES, type AttendanceExportResult } from "@/exporters/attendanceExport";
import { downloadWorkbook } from "@/lib/excel";

const DAY_TYPES = ["عمل", "إجازة", "إجازة رسمية", "جمعة", "فترة التحاق", "فترة ترك", "إجازة بالخصم", "غياب بعذر"];
const BORDER = {
  top: { style: "thin" as const, color: { argb: "FFD0D7E2" } },
  left: { style: "thin" as const, color: { argb: "FFD0D7E2" } },
  bottom: { style: "thin" as const, color: { argb: "FFD0D7E2" } },
  right: { style: "thin" as const, color: { argb: "FFD0D7E2" } },
};

const loadExcelJS = async () => {
  const mod: any = await import("exceljs");
  return (mod.default ?? mod) as typeof import("exceljs");
};

type Worksheet = import("exceljs").Worksheet;

const styleHeader = (ws: Worksheet) => {
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
    cell.border = BORDER;
  });
};

const addList = (ws: Worksheet, column: number, lastRow: number, values: readonly string[]) => {
  // Per-cell validation (typed API) – `ws.dataValidations` is not part of ExcelJS's public typings.
  for (let r = 2; r <= lastRow; r++) {
    ws.getCell(r, column).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`"${values.join(",")}"`],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "قيمة غير صحيحة",
      error: "اختر قيمة من القائمة فقط.",
    };
  }
};

const buildSheet = (
  workbook: import("exceljs").Workbook,
  name: string,
  headers: string[],
  rows: unknown[][],
  xSplit: number
) => {
  const ws = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, xSplit, rightToLeft: true }] });
  ws.addRows(rows as any[][]);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  styleHeader(ws);

  const col = (h: string) => headers.indexOf(h) + 1;
  const dateCols = ["التاريخ", "تاريخ التعيين", "تاريخ ترك العمل"].map(col).filter((c) => c > 0);
  const timeCols = ["الدخول", "الخروج"].map(col).filter((c) => c > 0);
  const hourCols = ["ساعات العمل", "الإضافي"].map(col).filter((c) => c > 0);
  const lastRow = ws.rowCount;

  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    row.eachCell((cell) => {
      if ((r - 2) % 2 === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    const fmt = (cols: number[], numFmt: string) =>
      cols.forEach((c) => {
        const cell = row.getCell(c);
        if (typeof cell.value === "number" && Number.isFinite(cell.value)) cell.numFmt = numFmt;
      });
    fmt(dateCols, "dd/mm/yyyy");
    fmt(timeCols, "hh:mm");
    fmt(hourCols, "0.00");
  }

  headers.forEach((h, i) => {
    let maxLen = String(h).length;
    ws.getColumn(i + 1).eachCell({ includeEmpty: false }, (cell) => {
      const v: any = cell.value;
      const text = v == null ? "" : typeof v === "object" && "text" in v ? String(v.text) : String(v);
      maxLen = Math.max(maxLen, text.length);
    });
    ws.getColumn(i + 1).width = Math.min(40, Math.max(10, maxLen + 2));
  });

  if (col("نوع اليوم") > 0) addList(ws, col("نوع اليوم"), lastRow, DAY_TYPES);
  if (col("الحالة") > 0) addList(ws, col("الحالة"), lastRow, STATUS_AR_VALUES);
  return ws;
};

export const buildAttendanceWorkbook = async (
  data: AttendanceExportResult,
  info: { start?: string; end?: string; employeeCount: number; recordCount: number }
) => {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HR Attendance";
  workbook.created = new Date();
  const generatedAtText = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const wsDetail = buildSheet(workbook, "تفصيلي", data.detailHeaders, data.detailRows, 4);
  const wsSummary = buildSheet(workbook, "ملخص", data.summaryHeaders, data.summaryRows, 2);

  // Summary totals as live SUMIF formulas (stay correct after manual edits in Excel). Every formula
  // also carries its computed value, so viewers that do not recalculate still show the numbers.
  const detailCol = (header: string) => wsDetail.getColumn(data.detailHeaders.indexOf(header) + 1).letter;
  const codeLetter = detailCol("الكود");
  const summaryCol = (header: string) => data.summaryHeaders.indexOf(header) + 1;

  const sumif = (detailHeader: string, summaryHeader: string, multiplier = 1) => {
    const target = summaryCol(summaryHeader);
    if (target <= 0) return;
    const letter = detailCol(detailHeader);
    for (let r = 2; r <= wsSummary.rowCount; r++) {
      const cell = wsSummary.getRow(r).getCell(target);
      if (!wsSummary.getRow(r).getCell(1).value) continue;
      const current = typeof cell.value === "number" ? cell.value : Number(cell.value ?? 0);
      const factor = multiplier === 1 ? "" : `*${multiplier}`;
      cell.value = {
        formula: `SUMIF('تفصيلي'!$${codeLetter}:$${codeLetter},$A${r},'تفصيلي'!$${letter}:$${letter})${factor}`,
        result: Number.isFinite(current) ? current : 0,
      };
    }
  };
  sumif("تأخير", "إجمالي التأخيرات");
  sumif("انصراف مبكر", "إجمالي الانصراف المبكر");
  sumif("سهو بصمة", "إجمالي سهو البصمة");
  sumif("غياب", "إجمالي الغياب", ENGINE_CONFIG.absenceWeight); // absence is weighted, like the total
  sumif("إجمالي الجزاءات", "إجمالي الجزاءات");
  sumif("الإضافي", "إجمالي الإضافي");

  const wsAudit = workbook.addWorksheet("سجل", { views: [{ state: "frozen", ySplit: 1, rightToLeft: true }] });
  wsAudit.addRow(["البند", "القيمة"]);
  wsAudit.addRows([
    ["تاريخ إنشاء التقرير", generatedAtText],
    ["الفترة", `${info.start || ""} → ${info.end || ""}`],
    ["عدد الموظفين", info.employeeCount],
    ["عدد السجلات", info.recordCount],
    ["وزن الغياب في الإجماليات", `${ENGINE_CONFIG.absenceWeight}×`],
    ["Generated by", "HR Attendance System"],
  ]);
  styleHeader(wsAudit);
  wsAudit.getColumn(1).width = 28;
  wsAudit.getColumn(2).width = 60;

  [wsDetail, wsSummary, wsAudit].forEach((ws) => {
    ws.headerFooter = { oddFooter: `&CGenerated by HR Attendance System - ${generatedAtText}` };
  });

  return workbook;
};

export const downloadAttendanceWorkbook = async (
  data: AttendanceExportResult,
  info: { start?: string; end?: string; employeeCount: number; recordCount: number },
  filename: string
) => downloadWorkbook(await buildAttendanceWorkbook(data, info), filename);
