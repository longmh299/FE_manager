// src/pages/ItemsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { StockSummaryByItem } from "../types";
import { extractList } from "../utils/apiHelpers";

const PAGE_SIZE = 50;

const ItemsPage: React.FC = () => {
  const [stocks, setStocks] = useState<StockSummaryByItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // Lấy toàn bộ summary 1 lần
  const fetchStockSummary = async () => {
    setLoading(true);
    try {
      const res = await api.get("/stocks/summary-by-item");
      const list = extractList<StockSummaryByItem>(res.data);
      setStocks(list);
      setPage(1);
    } catch (err) {
      console.error("Error fetching stock summary", err);
      setStocks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStockSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lọc theo q (SKU hoặc tên), không phụ thuộc backend
  const filteredStocks = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    if (!keyword) return stocks;
    return stocks.filter((s) => {
      const sku = (s.sku || "").toLowerCase();
      const name = (s.name || "").toLowerCase();
      return sku.includes(keyword) || name.includes(keyword);
    });
  }, [q, stocks]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // lọc đã làm bằng useMemo, ở đây chỉ reset page
    setPage(1);
  };

  // Xuất Excel tồn kho (vẫn gửi q lên backend – nếu server có hỗ trợ thì sẽ lọc trên file luôn)
  const handleExport = async () => {
    try {
      const res = await api.get("/stocks/export", {
        params: q ? { q } : {},
        responseType: "blob",
      });

      const blob = new Blob(
        [res.data],
        {
          type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
      );
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "ton-kho-theo-mat-hang.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Export stocks error", err);
      alert(err?.response?.data?.message || "Xuất Excel tồn kho thất bại");
    }
  };

  const formatQty = (n: number) =>
    typeof n === "number" ? n.toLocaleString("vi-VN") : n;

  // ====== Phân trang dựa trên danh sách đã lọc ======
  const totalPages = Math.max(
    1,
    Math.ceil(filteredStocks.length / PAGE_SIZE)
  );
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pagedStocks = filteredStocks.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Tồn kho theo mặt hàng</h2>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            placeholder="Tìm theo mã / tên..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded bg-slate-900 text-white hover:bg-slate-800"
          >
            Tìm
          </button>
        </form>

        <button
          type="button"
          onClick={handleExport}
          className="ml-auto px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs md:text-sm"
        >
          Xuất Excel tồn kho
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-auto text-sm">
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2 border-b">SKU</th>
              <th className="text-left px-3 py-2 border-b">Tên hàng</th>
              <th className="text-left px-3 py-2 border-b">Loại</th>
              <th className="text-right px-3 py-2 border-b">Tồn kho</th>
              <th className="text-left px-3 py-2 border-b">Đơn vị</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-center">
                  Đang tải...
                </td>
              </tr>
            )}

            {!loading && pagedStocks.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-3 text-center text-slate-500"
                >
                  Không có dữ liệu tồn kho
                </td>
              </tr>
            )}

            {!loading &&
              pagedStocks.map((it) => {
                const kindStr = (() => {
                  const k = (it.kind || "").toLowerCase();
                  if (k === "machine") return "Máy";
                  if (k === "part") return "Linh kiện";
                  return it.kind || "-";
                })();

                return (
                  <tr key={it.itemId} className="hover:bg-slate-50">
                    <td className="px-3 py-2 border-b">{it.sku}</td>
                    <td className="px-3 py-2 border-b">{it.name}</td>
                    <td className="px-3 py-2 border-b">{kindStr}</td>
                    <td className="px-3 py-2 border-b text-right">
                      {formatQty(it.totalQty)}
                    </td>
                    <td className="px-3 py-2 border-b">{it.unit}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        {/* Thanh phân trang */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-200 text-xs text-slate-600">
          <div>
            Trang {currentPage}/{totalPages} – Tổng:{" "}
            {filteredStocks.length} mặt hàng
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-2 py-1 rounded border disabled:opacity-40"
            >
              Trước
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`px-2 py-1 rounded border ${
                  n === currentPage
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white hover:bg-slate-50"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-2 py-1 rounded border disabled:opacity-40"
            >
              Sau
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemsPage;
