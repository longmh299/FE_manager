// src/utils/stockReconcileExport.ts
// ✅ Xuất lại ĐÚNG file kiểm kê đã tải lên (đủ sheet, cột, thứ tự dòng) + chèn 2 cột "Mã hệ thống" / "Tên hệ thống"
//    ngay sau cột mã của kho, để kho sửa mã cho khớp hệ thống.
//  - Trắng: đã khớp, mã + tên giống hệt hệ thống (so chính xác: hoa/thường, dấu, gạch đều tính)
//  - Vàng: đã ghép nhưng mã / tên trong file khác hệ thống -> cần sửa (ô khác được in đỏ đậm)
//  - Cam: gần giống, máy tự đoán, cần kiểm tra lại
//  - Đỏ: chưa có trên hệ thống
//  Xuất từ dữ liệu phiên (chỉ chữ + số), nên không giữ định dạng gốc của file (màu, ô gộp, công thức).
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import type { ColumnGuess, ReconRow } from "./stockReconcile";
import { parseQty, splitName } from "./stockReconcile";

type Book = { names: string[]; aoa: Record<string, string[][]> };

const FILL = {
  fix: "FFFEF08A", // vàng: cần sửa
  fuzzy: "FFFED7AA", // cam: gần giống
  missing: "FFFECACA", // đỏ: chưa có trên hệ thống
  head: "FFE2E8F0",
  newCol: "FFDBEAFE", // nền tiêu đề 2 cột mới
};
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const isMatched = (st: ReconRow["status"]) =>
  st === "EXACT_BOTH" || st === "EXACT_CODE" || st === "EXACT_NAME" || st === "MANUAL";

export type StandardizeStats = { ok: number; fix: number; fuzzy: number; missing: number; sysOnly: number };

export async function exportStandardizedFile(opts: {
  book: Book;
  colsMap: Record<string, ColumnGuess>;
  usedSheets: string[];
  rows: ReconRow[]; // toàn bộ kết quả ghép (không lọc)
  fileName: string;
}): Promise<StandardizeStats> {
  const { book, colsMap, usedSheets, rows, fileName } = opts;
  const stats: StandardizeStats = { ok: 0, fix: 0, fuzzy: 0, missing: 0, sysOnly: 0 };

  // số dòng trong phiên (rowNo) -> kết quả ghép. rowNo = (thứ tự sheet + 1) * 1.000.000 + chỉ số dòng + 1
  const byRowNo = new Map<number, ReconRow>();
  for (const r of rows) if (r.file) for (const n of r.file.rowNos) byRowNo.set(n, r);

  const wb = new ExcelJS.Workbook();

  book.names.forEach((sheetName, k) => {
    const aoa = book.aoa[sheetName] || [];
    const ws = wb.addWorksheet(safeSheetName(sheetName, wb));
    const cols = colsMap[sheetName];
    const used = usedSheets.includes(sheetName) && !!cols;

    if (!used) {
      // sheet không dùng để đối soát: chép nguyên
      aoa.forEach((r) => ws.addRow(r));
      autoWidth(ws);
      return;
    }

    const anchor = cols.code >= 0 ? cols.code : cols.name; // chèn sau cột mã (không có cột mã thì sau cột tên)
    const pos = anchor + 1;
    const shift = (i: number) => (i >= pos ? i + 2 : i); // chỉ số cột sau khi chèn

    aoa.forEach((src, r) => {
      const cells: Array<string | number> = src.slice();
      while (cells.length < pos) cells.push("");
      // cột số lượng: ghi thành số để Excel cộng được
      if (r > cols.headerRow && cols.qty >= 0) {
        const q = parseQty(src[cols.qty]);
        if (Number.isFinite(q)) cells[cols.qty] = q;
      }

      const rec = r > cols.headerRow ? byRowNo.get((k + 1) * 1_000_000 + r + 1) : undefined;
      let added: [string, string] = ["", ""];
      let kind: "" | "ok" | "fix" | "fuzzy" | "missing" = "";
      let badCode = false;
      let badName = false;

      if (r === cols.headerRow) added = ["Mã hệ thống", "Tên hệ thống"];
      else if (rec?.status === "FILE_ONLY") {
        added = ["", "(chưa có trên hệ thống)"];
        kind = "missing";
      } else if (rec?.sys) {
        // tên hệ thống bỏ phần [mã] ở cuối (kho không cần ghi phần đó)
        const sysName = clean(splitName(rec.sys.name).name);
        added = [rec.sys.sku, sysName];
        // so CHÍNH XÁC (chỉ bỏ khoảng trắng thừa): "dz-500" ≠ "DZ-500", thiếu dấu cũng tính là cần sửa
        const code = cols.code >= 0 ? clean(String(src[cols.code] ?? "")) : "";
        const name = cols.name >= 0 ? clean(String(src[cols.name] ?? "")) : "";
        badCode = cols.code >= 0 && code !== clean(rec.sys.sku);
        badName = cols.name >= 0 && name !== sysName;
        if (rec.status === "FUZZY") kind = "fuzzy";
        else if (isMatched(rec.status)) kind = badCode || badName ? "fix" : "ok";
      }
      if (kind) stats[kind]++;

      cells.splice(pos, 0, ...added);
      const row = ws.addRow(cells);

      if (r === cols.headerRow) {
        row.font = { bold: true };
        row.eachCell({ includeEmpty: true }, (c) => (c.fill = fill(FILL.head)));
        row.getCell(pos + 1).fill = fill(FILL.newCol);
        row.getCell(pos + 2).fill = fill(FILL.newCol);
        return;
      }
      if (kind === "fix" || kind === "fuzzy" || kind === "missing") {
        const color = kind === "fix" ? FILL.fix : kind === "fuzzy" ? FILL.fuzzy : FILL.missing;
        const last = Math.max(cells.length, pos + 2);
        for (let c = 1; c <= last; c++) row.getCell(c).fill = fill(color);
      }
      // ô trong file khác hệ thống: in đỏ đậm để kho thấy ngay chỗ cần sửa
      const red = { bold: true, color: { argb: "FFDC2626" } };
      if (kind === "fix" || kind === "fuzzy") {
        if (badCode) {
          row.getCell(shift(cols.code) + 1).font = red;
          row.getCell(pos + 1).font = { bold: true };
        }
        if (badName) {
          row.getCell(shift(cols.name) + 1).font = red;
          row.getCell(pos + 2).font = { bold: true };
        }
      }
    });

    ws.views = [{ state: "frozen", ySplit: cols.headerRow + 1 }];
    autoWidth(ws);
    if (cols.qty >= 0) ws.getColumn(shift(cols.qty) + 1).numFmt = "#,##0.###";
  });

  // hàng hệ thống còn tồn mà không thấy trong file (kho có thể quên đếm / ghi tên khác hẳn)
  const sysOnly = rows.filter((r) => r.status === "SYSTEM_ONLY" && r.sys && Math.abs(r.sys.qty) > 1e-9);
  stats.sysOnly = sysOnly.length;
  if (sysOnly.length) {
    const ws = wb.addWorksheet(safeSheetName("Hệ thống có - file không", wb));
    ws.addRow(["Mã hệ thống", "Tên hệ thống", "ĐVT", "Tồn hệ thống"]).font = { bold: true };
    for (const r of sysOnly) ws.addRow([r.sys!.sku, r.sys!.name, r.sys!.unit, r.sys!.qty]);
    ws.getColumn(4).numFmt = "#,##0.###";
    ws.views = [{ state: "frozen", ySplit: 1 }];
    autoWidth(ws);
  }

  // chú thích màu
  const note = wb.addWorksheet(safeSheetName("Chú thích", wb));
  note.addRow(["Màu", "Ý nghĩa"]).font = { bold: true };
  const legend: Array<[string, string]> = [
    ["", "Trắng: đã khớp, mã + tên giống hệt hệ thống (tính cả chữ hoa/thường, dấu, gạch nối)"],
    [FILL.fix, "Vàng: đã ghép nhưng mã / tên trong file khác hệ thống — sửa theo cột Mã / Tên hệ thống (ô khác in đỏ)"],
    [FILL.fuzzy, "Cam: gần giống, máy tự đoán — kiểm tra lại có đúng hàng không"],
    [FILL.missing, "Đỏ: chưa có mã trên hệ thống"],
  ];
  for (const [c, t] of legend) {
    const row = note.addRow(["", t]);
    if (c) row.getCell(1).fill = fill(c);
  }
  note.getColumn(1).width = 8;
  note.getColumn(2).width = 100;

  const buf = await wb.xlsx.writeBuffer();
  const base = (fileName || "kiem_ke").replace(/\.(xlsx|xls|csv)$/i, "");
  saveAs(new Blob([buf]), `${base}_chuan_ma.xlsx`);
  return stats;
}

const clean = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/** tên sheet Excel: tối đa 31 ký tự, không chứa : \ / ? * [ ], không trùng */
function safeSheetName(name: string, wb: ExcelJS.Workbook) {
  const base = (String(name || "Sheet").replace(/[:\\/?*[\]]/g, " ").trim() || "Sheet").slice(0, 31);
  let n = base;
  let i = 2;
  while (wb.getWorksheet(n)) {
    const suf = ` (${i++})`;
    n = base.slice(0, 31 - suf.length) + suf;
  }
  return n;
}

function autoWidth(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col) => {
    let w = 8;
    col.eachCell?.({ includeEmpty: false }, (c) => {
      const len = String(c.value ?? "").length;
      if (len > w) w = len;
    });
    col.width = Math.min(w + 2, 50);
  });
}
