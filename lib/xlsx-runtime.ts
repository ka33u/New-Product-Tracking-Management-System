import writeXlsxFile, { type CellObject, type Sheet } from "write-excel-file/universal";

export type ExportCell = string | number | boolean | null | undefined;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const dateHeaders = new Set(["计划开始", "计划完成", "实际完成", "计划节点", "订单日期", "交付日期", "计划日期", "实际日期", "试验日期", "检验日期"]);
const timeHeaders = new Set(["最后更新", "更新时间", "最后更新时间", "确认时间", "生产确认时间", "提交时间", "记录时间", "加入时间", "上传时间", "时间戳", "导出时间"]);
const textWidth = (value: string) => [...value].reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 0);

// Excel has no timezone. All timestamp cells represent China Standard Time;
// date-only business deadlines are deliberately never shifted.
export function excelDate(value: string, timestamp: boolean): Date | null {
  if (!timestamp) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value)) return null;
  const normalized = value.replace(" ", "T");
  const date = new Date(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * 3600000) : null;
}

export function worksheet(name: string, rows: ExportCell[][]): Sheet<Blob> {
  if (rows.length > 1048576 || rows.some((row) => row.length > 16384)) throw new Error(`“${name}”超过Excel单表容量，请缩小导出范围。`);
  const headers = (rows[0] || []).map((cell) => String(cell ?? ""));
  const widths = headers.map((header, column) => Math.min(52, Math.max(16, textWidth(header) + 3,
    ...rows.slice(1, 101).map((row) => Math.min(52, textWidth(String(row[column] ?? "").split("\n")[0]) + 2)))));
  return {
    sheet: name.replace(/[\\/?*\[\]:]/g, "-").slice(0, 31),
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: 1,
    showGridLines: false,
    data: rows.map((row, rowIndex) => {
      const height = Math.min(409, Math.max(30, ...row.map((value, column) => {
        const text = String(value ?? "");
        const lines = text.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(textWidth(line) / Math.max(8, widths[column] - 2))), 0);
        return lines * 15 + 12;
      })));
      return row.map((value, column): CellObject => {
        const header = headers[column];
        const style = { height, wrap: true, alignVertical: "top" as const };
        if (rowIndex === 0) return { ...style, value: value ?? "", type: String, fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: "#163A5F" };
        if (value == null) return { ...style, value: "", type: String };
        if (typeof value === "number") {
          if (!Number.isFinite(value)) throw new Error(`“${name}”第${rowIndex + 1}行存在无效数值。`);
          return { ...style, value, type: Number, format: header === "进度" ? "0%" : header === "金额" ? "#,##0.00" : Number.isInteger(value) ? "#,##0" : "0.############", align: "right" };
        }
        if (typeof value === "boolean") return { ...style, value, type: Boolean };
        if (value.length > 32767) throw new Error(`“${name}”第${rowIndex + 1}行的“${header}”超过Excel单元格文字上限，未截断数据，请使用分段导出。`);
        const date = dateHeaders.has(header) || timeHeaders.has(header) ? excelDate(value, timeHeaders.has(header)) : null;
        if (date) return { ...style, value: date, type: Date, format: timeHeaders.has(header) ? "yyyy-mm-dd hh:mm:ss" : "yyyy-mm-dd" };
        // Explicit String cells, never Formula: names/notes beginning with '='
        // remain literal text and cannot execute spreadsheet formulas.
        return { ...style, value, type: String, format: "@" };
      });
    }),
  };
}

export function workbook(sheets: Sheet<Blob>[]) {
  if (new Set(sheets.map((sheet) => sheet.sheet?.toLowerCase())).size !== sheets.length) throw new Error("导出工作表名称重复。");
  return writeXlsxFile(sheets, { fontFamily: "Microsoft YaHei", fontSize: 11 }).toBlob();
}
