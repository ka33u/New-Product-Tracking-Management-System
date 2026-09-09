import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer,
  PageNumber, Paragraph, Table, TableCell, TableLayoutType, TableRow,
  TextRun, VerticalAlign, WidthType,
} from "docx";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type WordBlock = Paragraph | Table;
const font = { ascii: "Arial", hAnsi: "Arial", eastAsia: "宋体", cs: "Arial" };
const width = 9866; // A4 minus 18 mm left/right, matching the supplied forms.

export function wordText(value: unknown): string {
  const text = value == null || value === "" ? "未填写" : typeof value === "boolean" ? (value ? "是" : "否")
    : Array.isArray(value) ? value.length ? value.map(wordText).join("、") : "未选择"
      : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(text)) throw new Error("档案文字包含Word不支持的控制字符或无效Unicode字符，请检查相关记录。");
  return text;
}

function runs(value: unknown, options: { bold?: boolean; size?: number; color?: string } = {}) {
  return wordText(value).split(/\r\n|\r|\n/).map((line, index) => new TextRun({
    text: line, break: index ? 1 : undefined, font, ...options,
  }));
}
export function wordParagraph(value: unknown, options: { small?: boolean; center?: boolean; keepNext?: boolean } = {}) {
  return new Paragraph({ children: runs(value, { size: options.small ? 19 : 22 }),
    alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: 100, line: 290 }, widowControl: true, keepNext: options.keepNext });
}
export function wordHeading(value: string, level: 1 | 2 = 1, newPage = false) {
  return new Paragraph({ text: wordText(value), heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    pageBreakBefore: newPage, keepNext: true });
}
export function wordFields(fields: [string, unknown][]): WordBlock[] {
  return fields.map(([label, value]) => new Paragraph({
    children: [...runs(`${label}：`, { bold: true }), ...runs(value)],
    spacing: { after: 100, line: 290 }, widowControl: true,
  }));
}
export function wordTable(headers: string[], rows: unknown[][], proportions: number[], centered: number[] = []): WordBlock[] {
  if (!rows.length) return [wordParagraph("暂无记录")];
  const total = proportions.reduce((a, b) => a + b, 0);
  const widths = proportions.map((value) => Math.floor(width * value / total));
  widths[widths.length - 1] += width - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" };
  return [new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [headers, ...rows].map((row, rowIndex) => new TableRow({ tableHeader: rowIndex === 0,
      // Long report text must be able to continue on a second page.
      cantSplit: false,
      children: row.map((value, index) => new TableCell({ width: { size: widths[index], type: WidthType.DXA },
        margins: { top: 90, bottom: 90, left: 115, right: 115 }, verticalAlign: VerticalAlign.CENTER,
        shading: { fill: rowIndex === 0 ? "E8EFF5" : "FFFFFF" },
        children: [new Paragraph({ children: runs(value, { bold: rowIndex === 0, size: 21, color: "000000" }),
          alignment: centered.includes(index) ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { after: 0, line: 270 }, widowControl: true })],
      })),
    })),
  }), new Paragraph({ spacing: { after: 60 }, children: [] })];
}

export async function packWordArchive(title: string, projectCode: string, blocks: WordBlock[], author: string) {
  const doc = new Document({ creator: wordText(author), title: wordText(title), description: "新品开发项目受控记录及归档索引",
    styles: { default: {
      document: { run: { font, size: 22, color: "000000" }, paragraph: { spacing: { after: 100, line: 290 } } },
      title: { run: { font, size: 40, color: "000000", bold: true }, paragraph: { spacing: { after: 220 }, keepNext: true } },
      heading1: { run: { font, size: 30, color: "000000", bold: true }, paragraph: { spacing: { before: 200, after: 140 }, keepNext: true } },
      heading2: { run: { font, size: 25, color: "000000", bold: true }, paragraph: { spacing: { before: 170, after: 100 }, keepNext: true } },
    } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 },
      margin: { top: 1020, bottom: 1020, left: 1020, right: 1020, footer: 450, header: 450 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `亨达新品开发  ${wordText(projectCode)}  第 `, font, size: 18 }),
        new TextRun({ children: [PageNumber.CURRENT], font, size: 18 }), new TextRun({ text: " 页  共 ", font, size: 18 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font, size: 18 }), new TextRun({ text: " 页", font, size: 18 })],
    })] }) },
    children: [new Paragraph({ text: wordText(title), heading: HeadingLevel.TITLE }), ...blocks] }],
  });
  return Packer.toBlob(doc);
}
