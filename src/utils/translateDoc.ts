// src/utils/translateDoc.ts
// ✅ Tách tài liệu thành từng phần nhỏ để gửi đi dịch + xuất file Word / Excel sau khi dịch.
// Mọi thứ chạy trên trình duyệt, server chỉ chuyển cho AI dịch rồi trả về — không lưu gì.
import { PDFDocument } from "pdf-lib";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export type Block = {
  type: "heading" | "paragraph" | "list" | "table" | "note";
  src?: string;
  vi?: string;
  srcRows?: string[][];
  viRows?: string[][];
  /** BE đã thử dịch lại mà vẫn còn chữ gốc -> hiện cảnh báo vàng */
  untranslated?: boolean;
};
/** page = số trang thật (PDF) để AI chat trích dẫn "(Trang 12)" và bấm nhảy tới */
export type DocPage = { title?: string; page?: number; blocks: Block[] };

// ---------------------------------------------------------------- base64
export function bytesToBase64(bytes: Uint8Array) {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

// ---------------------------------------------------------------- PDF
export async function loadPdf(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  return PDFDocument.load(buf, { ignoreEncryption: true });
}

/** Cắt trang [start, start+count) (đánh số từ 0) thành 1 file PDF nhỏ, trả base64 */
export async function pdfSliceBase64(src: PDFDocument, start: number, count: number) {
  const out = await PDFDocument.create();
  const idx = Array.from({ length: count }, (_, i) => start + i).filter((i) => i < src.getPageCount());
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return bytesToBase64(await out.save());
}

// ---------------------------------------------------------------- Ảnh
/** Thu nhỏ ảnh (tối đa 1800px) để gửi nhanh, AI vẫn đọc rõ chữ */
export async function imageToBase64(file: File, maxSide = 1800): Promise<{ data: string; mediaType: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Không đọc được ảnh"))), "image/jpeg", 0.88)
  );
  return { data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), mediaType: "image/jpeg" };
}

// ---------------------------------------------------------------- Word
export type SrcItem = { type: Block["type"]; text?: string; rows?: string[][] };

export async function docxToItems(file: File): Promise<SrcItem[]> {
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items: SrcItem[] = [];
  const txt = (el: Element) => (el.textContent || "").replace(/\s+/g, " ").trim();
  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const t = txt(el);
      if (t) items.push({ type: "heading", text: t });
    } else if (tag === "ul" || tag === "ol") {
      const lines = Array.from(el.querySelectorAll("li")).map(txt).filter(Boolean);
      if (lines.length) items.push({ type: "list", text: lines.join("\n") });
    } else if (tag === "table") {
      const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("th,td")).map(txt)
      );
      if (rows.some((r) => r.some(Boolean))) items.push({ type: "table", rows });
    } else {
      const t = txt(el);
      if (t) items.push({ type: "paragraph", text: t });
    }
  }
  return items;
}

/** Gom các đoạn thành từng lô ~4000 ký tự để gửi dịch */
export function batchItems<T>(items: T[], size: (t: T) => number, maxChars = 4000, maxCount = 60): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let n = 0;
  for (const it of items) {
    const s = size(it);
    if (cur.length && (n + s > maxChars || cur.length >= maxCount)) {
      out.push(cur);
      cur = [];
      n = 0;
    }
    cur.push(it);
    n += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- Excel
export type SheetData = { name: string; src: string[][]; vi?: string[][] };
const MAX_ROWS = 2000;
const MAX_COLS = 60;

export async function xlsxToSheets(file: File): Promise<SheetData[]> {
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  return wb.SheetNames.map((name) => {
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    const src = aoa.slice(0, MAX_ROWS).map((r) => (r || []).slice(0, MAX_COLS).map((c) => String(c ?? "")));
    return { name, src };
  });
}

/** Ô cần dịch: có chữ, và không phải mã toàn chữ in hoa + số (JL-1000, SUS304, PLC...) */
export function cellNeedsTranslate(s: string) {
  const t = s.trim();
  if (!t || !/[A-Za-z㐀-鿿]/.test(t)) return false;
  if (/^[A-Z0-9][A-Z0-9\-_./ ]*$/.test(t)) return false;
  return true;
}

export function downloadTranslatedXlsx(sheets: SheetData[], fileName: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.vi ?? s.src), s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, fileName);
}

// ---------------------------------------------------------------- Xuất Word
const thin = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const borders = { top: thin, bottom: thin, left: thin, right: thin, insideHorizontal: thin, insideVertical: thin };

function textParas(text: string | undefined, opts: { bold?: boolean; color?: string; size?: number } = {}) {
  return String(text || "")
    .split("\n")
    .map((line) => new Paragraph({ children: [new TextRun({ text: line, bold: opts.bold, color: opts.color, size: opts.size })] }));
}

function gridTable(rows: string[][] | undefined) {
  const r = rows?.length ? rows : [[""]];
  const cols = Math.max(...r.map((x) => x.length), 1);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: r.map(
      (row) =>
        new TableRow({
          children: Array.from({ length: cols }, (_, i) => new TableCell({ children: textParas(row[i] ?? "", { size: 18 }) })),
        })
    ),
  });
}

function blockChildren(b: Block, side: "src" | "vi") {
  if (b.type === "table") return [gridTable(side === "src" ? b.srcRows : b.viRows)];
  const text = side === "src" ? b.src : b.vi;
  return textParas(text, {
    bold: b.type === "heading" || b.type === "note",
    color: b.type === "note" ? "B45309" : side === "src" ? "555555" : undefined,
  });
}

/** mode "song-ngu": bảng 2 cột Gốc | Tiếng Việt.  mode "tieng-viet": chỉ bản dịch. */
export async function downloadDocx(pages: DocPage[], fileName: string, mode: "song-ngu" | "tieng-viet") {
  const children: (Paragraph | Table)[] = [];
  for (const p of pages) {
    if (p.title) children.push(new Paragraph({ text: p.title, heading: HeadingLevel.HEADING_2 }));
    if (!p.blocks.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: "(Trang không có chữ)", italics: true, color: "888888" })] }));
      continue;
    }
    if (mode === "tieng-viet") {
      for (const b of p.blocks) {
        if (b.type === "table") children.push(gridTable(b.viRows));
        else if (b.type === "heading") children.push(new Paragraph({ text: b.vi || "", heading: HeadingLevel.HEADING_3 }));
        else children.push(...blockChildren(b, "vi"));
        children.push(new Paragraph({ text: "" }));
      }
    } else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders,
          rows: [
            new TableRow({
              tableHeader: true,
              children: ["Bản gốc", "Tiếng Việt"].map(
                (h) =>
                  new TableCell({
                    shading: { fill: "EEF2FF" },
                    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true })] })],
                  })
              ),
            }),
            ...p.blocks.map(
              (b) =>
                new TableRow({
                  children: [
                    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: blockChildren(b, "src") }),
                    new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: blockChildren(b, "vi") }),
                  ],
                })
            ),
          ],
        })
      );
    }
  }
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * Các cặp [gốc, dịch] đã có trên trang -> gửi kèm khi tạo "Word giữ bố cục gốc"
 * để BE dùng lại, không tốn tiền dịch lần 2 (BE chỉ dịch các khúc còn thiếu).
 */
export function pagesToDict(pages: DocPage[]): [string, string][] {
  const out: [string, string][] = [];
  const add = (a?: string, b?: string) => {
    if (a?.trim() && b?.trim() && a.trim() !== b.trim()) out.push([a, b]);
  };
  for (const b of pages.flatMap((p) => p.blocks)) {
    if (b.type === "table") {
      (b.srcRows || []).forEach((r, i) => r.forEach((c, j) => add(c, b.viRows?.[i]?.[j])));
      continue;
    }
    add(b.src, b.vi);
    // Danh sách: mỗi mục 1 dòng -> ghép từng dòng nếu số dòng khớp
    const s = (b.src || "").split("\n");
    const v = (b.vi || "").split("\n");
    if (s.length > 1 && s.length === v.length) s.forEach((line, i) => add(line, v[i]));
  }
  return out;
}

export function pagesToPlainVi(pages: DocPage[]) {
  return pages
    .map((p) =>
      [p.title ? `=== ${p.title} ===` : "", ...p.blocks.map((b) => (b.type === "table" ? (b.viRows || []).map((r) => r.join("\t")).join("\n") : b.vi || ""))]
        .filter(Boolean)
        .join("\n\n")
    )
    .join("\n\n");
}

// ---------------------------------------------------------------- Nội dung gửi cho AI chat
/** Ghép bản dịch tiếng Việt thành văn bản để AI đọc khi hỏi đáp */
export function pagesToChatText(pages: DocPage[]) {
  const rowsText = (rows?: string[][]) => (rows || []).map((r) => r.join(" | ")).join("\n");
  return pages
    .map((p) => {
      const lines = p.blocks.map((b) => {
        // Chỉ gửi bản tiếng Việt (bỏ chữ gốc) -> AI đọc ít hơn một nửa, tiền rẻ hơn một nửa
        if (b.type === "table") return `[Bảng]\n${rowsText(b.viRows ?? b.srcRows)}`;
        const head = b.type === "heading" ? "## " : b.type === "note" ? "⚠ " : "";
        return `${head}${b.vi || b.src || ""}`;
      });
      return `=== ${p.title || "Tài liệu"} ===\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export function sheetsToChatText(sheets: SheetData[]) {
  return sheets
    .map((s) => `=== Sheet ${s.name} ===\n${(s.vi ?? s.src).map((r) => r.join(" | ")).join("\n")}`)
    .join("\n\n");
}