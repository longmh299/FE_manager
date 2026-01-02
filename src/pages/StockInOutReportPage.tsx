// src/pages/StockInOutReportPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { ToastHost, useToast } from "../components/Toast";

type StockInOutRow = {
  itemId: string;
  sku: string;
  name: string;
  unitCode: string;
  openingQty: number;
  inQty: number;
  outQty: number;
  closingQty: number;
};

type ReportData = {
  warehouse: { id: string; code: string; name: string };
  from: string; // yyyy-mm-dd
  to: string; // yyyy-mm-dd
  rows: StockInOutRow[];
  totals: { openingQty: number; inQty: number; outQty: number; closingQty: number };
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtQty(n: number) {
  // hiển thị gọn: nếu là số nguyên -> không lẻ; nếu có lẻ -> tối đa 3 số
  if (!Number.isFinite(n)) return "0";
  const isInt = Math.abs(n - Math.round(n)) < 1e-9;
  return isInt ? String(Math.round(n)) : n.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}
function safeNum(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const PAGE_SIZE = 30;

const StockInOutReportPage: React.FC = () => {
  const { toasts, push, remove } = useToast();

  const [from, setFrom] = useState(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return toDateInputValue(first);
  });
  const [to, setTo] = useState(() => toDateInputValue(new Date()));
  const [q, setQ] = useState("");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);

  const [page, setPage] = useState(1);

  const rows = data?.rows ?? [];

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), [rows.length]);
  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  // reset page when data changes or filters change
  useEffect(() => {
    setPage(1);
  }, [from, to, q]);

  async function load() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q.trim()) params.set("q", q.trim());

      const res = await api.get(`/reports/stock-inout?${params.toString()}`);
      const payload = res?.data?.data ?? res?.data; // phòng trường hợp BE trả khác
      if (!payload || !payload.rows) throw new Error("Response invalid");

      // normalize numbers
      const normalized: ReportData = {
        warehouse: payload.warehouse,
        from: payload.from,
        to: payload.to,
        rows: (payload.rows as any[]).map((r) => ({
          itemId: String(r.itemId),
          sku: String(r.sku ?? ""),
          name: String(r.name ?? ""),
          unitCode: String(r.unitCode ?? ""),
          openingQty: safeNum(r.openingQty),
          inQty: safeNum(r.inQty),
          outQty: safeNum(r.outQty),
          closingQty: safeNum(r.closingQty),
        })),
        totals: {
          openingQty: safeNum(payload.totals?.openingQty),
          inQty: safeNum(payload.totals?.inQty),
          outQty: safeNum(payload.totals?.outQty),
          closingQty: safeNum(payload.totals?.closingQty),
        },
      };

      setData(normalized);
      push({ type: "success", title: "OK", message: `Đã tải ${normalized.rows.length} dòng.` });
    } catch (e: any) {
      push({
        type: "error",
        title: "Lỗi tải báo cáo",
        message: e?.response?.data?.message || e?.message || "Không tải được báo cáo",
      });
    } finally {
      setLoading(false);
    }
  }

  async function exportExcel() {
    try {
      if (!data) {
        push({ type: "warning", title: "Chưa có dữ liệu", message: "Bấm Tải báo cáo trước." });
        return;
      }

      const wb = new ExcelJS.Workbook();
      wb.creator = "MCBROTHER";
      wb.created = new Date();

      const ws = wb.addWorksheet("NhapXuat", {
        views: [{ state: "frozen", ySplit: 4 }],
      });

      // Title
      ws.mergeCells("A1:H1");
      ws.getCell("A1").value = "BÁO CÁO NHẬP - XUẤT - TỒN";
      ws.getCell("A1").font = { bold: true, size: 16 };
      ws.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };

      ws.mergeCells("A2:H2");
      ws.getCell("A2").value = `Kho: ${data.warehouse?.name || ""}    Range: ${data.from} → ${data.to}    Số dòng: ${data.rows.length}`;
      ws.getCell("A2").font = { size: 11 };
      ws.getCell("A2").alignment = { vertical: "middle", horizontal: "center" };

      // Header row (row 4)
      const headerRowIdx = 4;
      const headers = ["SKU", "Tên hàng", "ĐVT", "Tồn đầu", "Nhập", "Xuất", "Tồn cuối", "Ghi chú"];
      ws.addRow(headers);

      const headerRow = ws.getRow(headerRowIdx);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 20;

      // column widths
      ws.getColumn(1).width = 14; // SKU
      ws.getColumn(2).width = 45; // name
      ws.getColumn(3).width = 10; // unit
      ws.getColumn(4).width = 12; // opening
      ws.getColumn(5).width = 12; // in
      ws.getColumn(6).width = 12; // out
      ws.getColumn(7).width = 12; // closing
      ws.getColumn(8).width = 18; // note

      // style header border
      for (let c = 1; c <= 8; c++) {
        const cell = ws.getRow(headerRowIdx).getCell(c);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
      }

      // Data rows start at row 5
      const startRow = headerRowIdx + 1;
      data.rows.forEach((r) => {
        ws.addRow([
          r.sku || "",
          r.name || "",
          r.unitCode || "",
          r.openingQty,
          r.inQty,
          r.outQty,
          r.closingQty,
          "",
        ]);
      });

      // number format + borders + alignment
      const lastDataRow = startRow + data.rows.length - 1;
      for (let rr = startRow; rr <= lastDataRow; rr++) {
        const row = ws.getRow(rr);
        row.height = 18;

        // text columns
        row.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
        row.getCell(2).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        row.getCell(3).alignment = { vertical: "middle", horizontal: "center" };

        // qty columns
        for (const c of [4, 5, 6, 7]) {
          const cell = row.getCell(c);
          cell.numFmt = "#,##0.###";
          cell.alignment = { vertical: "middle", horizontal: "right" };
        }

        // color IN green, OUT red
        row.getCell(5).font = { color: { argb: "FF16A34A" } }; // green
        row.getCell(6).font = { color: { argb: "FFDC2626" } }; // red

        // borders
        for (let c = 1; c <= 8; c++) {
          row.getCell(c).border = {
            top: { style: "thin", color: { argb: "FFE5E7EB" } },
            left: { style: "thin", color: { argb: "FFE5E7EB" } },
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
            right: { style: "thin", color: { argb: "FFE5E7EB" } },
          };
        }
      }

      // Totals row
      const totalRowIdx = lastDataRow + 1;
      const tr = ws.addRow(["Tổng", "", "", data.totals.openingQty, data.totals.inQty, data.totals.outQty, data.totals.closingQty, ""]);
      ws.mergeCells(`A${totalRowIdx}:C${totalRowIdx}`);
      tr.font = { bold: true };
      tr.getCell(5).font = { bold: true, color: { argb: "FF16A34A" } };
      tr.getCell(6).font = { bold: true, color: { argb: "FFDC2626" } };
      for (const c of [4, 5, 6, 7]) {
        tr.getCell(c).numFmt = "#,##0.###";
        tr.getCell(c).alignment = { vertical: "middle", horizontal: "right" };
      }
      for (let c = 1; c <= 8; c++) {
        tr.getCell(c).border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
        tr.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const now = new Date();
      const fileName = `nhap_xuat_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.xlsx`;
      saveAs(blob, fileName);

      push({ type: "success", title: "OK", message: "Đã xuất Excel." });
    } catch (e: any) {
      push({ type: "error", title: "Lỗi xuất Excel", message: e?.message || "Xuất Excel thất bại" });
    }
  }

  return (
    <div className="space-y-4">
      <ToastHost toasts={toasts} onClose={remove} />

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">Từ</div>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Đến</div>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div className="flex-1 min-w-[260px]">
            <div className="text-xs text-slate-500 mb-1">Tìm</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nhập tên hàng hoặc SKU..."
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <button
            onClick={load}
            disabled={loading}
            className={`px-4 py-2 rounded bg-slate-900 text-white hover:bg-slate-800 ${
              loading ? "opacity-60 cursor-not-allowed" : ""
            }`}
          >
            {loading ? "Đang tải..." : "Tải báo cáo"}
          </button>

          <button
            onClick={exportExcel}
            disabled={!data || loading}
            className={`px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 ${
              !data || loading ? "opacity-60 cursor-not-allowed" : ""
            }`}
            title="Xuất toàn bộ dữ liệu (không chỉ trang hiện tại)"
          >
            Xuất Excel
          </button>
        </div>

        {data ? (
          <div className="mt-3 text-xs text-slate-500">
            Kho: <span className="font-semibold text-slate-700">{data.warehouse?.name}</span>{" "}
            <span className="mx-2">·</span>
            Range: <span className="font-semibold text-slate-700">{data.from}</span> →{" "}
            <span className="font-semibold text-slate-700">{data.to}</span>
            <span className="mx-2">·</span>
            Số dòng: <span className="font-semibold text-slate-700">{rows.length}</span>
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left">
                <th className="px-4 py-3 border-b border-slate-200">SKU</th>
                <th className="px-4 py-3 border-b border-slate-200">Tên hàng</th>
                <th className="px-4 py-3 border-b border-slate-200 text-center">ĐVT</th>
                <th className="px-4 py-3 border-b border-slate-200 text-right">Tồn đầu</th>
                <th className="px-4 py-3 border-b border-slate-200 text-right">
                  <span className="text-green-600">Nhập</span>
                </th>
                <th className="px-4 py-3 border-b border-slate-200 text-right">
                  <span className="text-red-600">Xuất</span>
                </th>
                <th className="px-4 py-3 border-b border-slate-200 text-right">Tồn cuối</th>
              </tr>
            </thead>

            <tbody>
              {pagedRows.map((r) => (
                <tr key={r.itemId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">{r.sku}</td>
                  <td className="px-4 py-3 border-b border-slate-100">{r.name}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-center whitespace-nowrap">
                    {r.unitCode}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right">
                    {fmtQty(r.openingQty)}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right text-green-600 font-medium">
                    {fmtQty(r.inQty)}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right text-red-600 font-medium">
                    {fmtQty(r.outQty)}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right">
                    {fmtQty(r.closingQty)}
                  </td>
                </tr>
              ))}

              {data ? (
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-3" colSpan={3}>
                    Tổng
                  </td>
                  <td className="px-4 py-3 text-right">{fmtQty(data.totals.openingQty)}</td>
                  <td className="px-4 py-3 text-right text-green-600">{fmtQty(data.totals.inQty)}</td>
                  <td className="px-4 py-3 text-right text-red-600">{fmtQty(data.totals.outQty)}</td>
                  <td className="px-4 py-3 text-right">{fmtQty(data.totals.closingQty)}</td>
                </tr>
              ) : null}

              {!loading && !data ? (
                <tr>
                  <td className="px-4 py-8 text-slate-500" colSpan={7}>
                    Chưa có dữ liệu. Bấm <b>Tải báo cáo</b>.
                  </td>
                </tr>
              ) : null}

              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-slate-500" colSpan={7}>
                    Đang tải...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
          <div className="text-slate-600">
            Trang <b>{page}</b> / <b>{totalPages}</b> — {PAGE_SIZE} SP / trang
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Trước
            </button>

            <button
              className="px-3 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Sau →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StockInOutReportPage;
