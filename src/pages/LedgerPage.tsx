import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type MovementType = "IN" | "OUT" | "ADJUST" | "TRANSFER";

type LedgerRow = {
  at: string;
  movementId: string;
  movementType: MovementType;
  invoiceCode?: string | null;

  itemId: string;
  itemSku?: string | null;
  itemName?: string | null;

  qty: number;
  unitCost?: number | null;
  costTotal?: number | null;

  note?: string | null;
};

type LedgerResponse = {
  rows: LedgerRow[];
  summary: { totalIn: number; totalOut: number; count: number };
};

function unwrapUser(res: any): any {
  const body = res?.data;
  return body?.data ?? body;
}

function normalizeRole(me: any) {
  return String(me?.role ?? me?.user?.role ?? me?.data?.role ?? "");
}

function formatDateTimeVN(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function formatNumber(n: number, digits = 3) {
  const v = Number(n || 0);
  return v.toLocaleString("vi-VN", { maximumFractionDigits: digits });
}

function formatMoney(n: number) {
  const v = Number(n || 0);
  return v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

function movementLabel(t: MovementType) {
  switch (t) {
    case "IN":
      return "Nhập kho";
    case "OUT":
      return "Xuất kho";
    case "ADJUST":
      return "Điều chỉnh";
    case "TRANSFER":
      return "Chuyển kho";
    default:
      return t;
  }
}

function movementBadgeClass(t: MovementType) {
  const base =
    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ";
  if (t === "IN") return base + "bg-green-50 text-green-700 border-green-200";
  if (t === "OUT") return base + "bg-red-50 text-red-700 border-red-200";
  if (t === "ADJUST") return base + "bg-amber-50 text-amber-800 border-amber-200";
  return base + "bg-gray-50 text-gray-700 border-gray-200";
}

function startOfMonthISO() {
  const d = new Date();
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return x.toISOString().slice(0, 10);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function downloadBlob(url: string, filename: string) {
  const res = await api.get(url, { responseType: "blob" as any });
  const blob = new Blob([res.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

const LedgerPage: React.FC = () => {
  const toast = useToast();

  const [role, setRole] = useState<string>("");
  const isStaff = role === "staff";

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [summary, setSummary] = useState<LedgerResponse["summary"]>({
    totalIn: 0,
    totalOut: 0,
    count: 0,
  });

  // Filters (chỉ còn 1 ô search q + from/to + type)
  const [from, setFrom] = useState<string>(startOfMonthISO());
  const [to, setTo] = useState<string>(todayISO());
  const [q, setQ] = useState<string>("");
  const [type, setType] = useState<"" | MovementType>("");

  useEffect(() => {
    api
      .get("/auth/me", { params: { t: Date.now() } })
      .then((res) => {
        const u = unwrapUser(res);
        setRole(normalizeRole(u));
      })
      .catch(() => setRole(""));
  }, []);

  const fetchLedger = async () => {
    try {
      setLoading(true);

      const res = await api.get("/reports/ledger", {
        params: {
          from: from || undefined,
          to: to || undefined,
          q: q.trim() || undefined,
          type: type || undefined,
        },
      });

      const data = res?.data?.data as LedgerResponse | undefined;
      const r = data?.rows ?? [];
      const s = data?.summary ?? { totalIn: 0, totalOut: 0, count: 0 };

      setRows(r);
      setSummary(s);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || "Không tải được sổ kho.";
      toast.push({ type: "error", title: "Lỗi", message: msg });
      setRows([]);
      setSummary({ totalIn: 0, totalOut: 0, count: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    fetchLedger();
  };

  const handleReset = () => {
    setFrom(startOfMonthISO());
    setTo(todayISO());
    setQ("");
    setType("");
    setTimeout(fetchLedger, 0);
  };

  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (q.trim()) params.set("q", q.trim());
      if (type) params.set("type", type);

      const name = `so_kho_${from || "all"}_${to || "all"}.xlsx`;
      await downloadBlob(`/reports/ledger.xlsx?${params.toString()}`, name);

      toast.push({
        type: "success",
        title: "Thành công",
        message: "Đã xuất Excel.",
      });
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || "Xuất Excel thất bại.";
      toast.push({ type: "error", title: "Lỗi", message: msg });
    }
  };

  const totalCostOut = useMemo(() => {
    return rows.reduce(
      (s, r) => (r.qty < 0 ? s + (Number(r.costTotal || 0) || 0) : s),
      0
    );
  }, [rows]);

  if (isStaff) {
    return (
      <div className="p-4">
        <ToastHost toasts={toast.toasts} onClose={toast.remove} />
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="text-lg font-semibold">Sổ kho</div>
          <div className="mt-2 text-sm text-gray-600">
            Tài khoản của bạn không có quyền xem báo cáo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />

      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sổ kho</h1>
          <div className="text-sm text-gray-600">
            Lịch sử biến động kho (đã chốt) theo chứng từ – dùng để đối soát
            xuất/nhập.
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center justify-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
            disabled={loading}
            title="Xuất Excel theo bộ lọc hiện tại"
          >
            Xuất Excel
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-xs text-gray-500">Số dòng</div>
          <div className="mt-1 text-2xl font-semibold">
            {formatNumber(summary.count, 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-xs text-gray-500">Tổng nhập</div>
          <div className="mt-1 text-2xl font-semibold text-green-700">
            {formatNumber(summary.totalIn)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-xs text-gray-500">Tổng xuất</div>
          <div className="mt-1 text-2xl font-semibold text-red-700">
            {formatNumber(summary.totalOut)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-xs text-gray-500">Tổng vốn xuất</div>
          <div className="mt-1 text-2xl font-semibold">
            {formatMoney(totalCostOut)} đ
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <form onSubmit={handleApply} className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Tìm chứng từ / khách hàng / SKU / tên hàng..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <div className="flex gap-2">
              <button
                type="submit"
                className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
                disabled={loading}
              >
                Áp dụng
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold"
              >
                Đặt lại
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold mb-1">Từ ngày</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Đến ngày</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Loại</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Tất cả</option>
                <option value="IN">Nhập kho</option>
                <option value="OUT">Xuất kho</option>
                <option value="ADJUST">Điều chỉnh</option>
              </select>
            </div>

            {loading && <div className="text-xs text-gray-500">Đang tải dữ liệu...</div>}
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="text-sm font-semibold">Chi tiết biến động</div>
          <div className="text-xs text-gray-500">
            Dữ liệu chỉ gồm chứng từ đã chốt (posted).
          </div>
        </div>

      <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Thời gian
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Chứng từ
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">
                  Loại
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Mã hàng
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Tên hàng
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-right text-xs font-semibold border-b border-gray-200">
                  SL (+/-)
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-right text-xs font-semibold border-b border-gray-200">
                  Giá vốn
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-right text-xs font-semibold border-b border-gray-200">
                  Thành tiền vốn
                </th>
                <th className="sticky top-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Ghi chú
                </th>
              </tr>
            </thead>

            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-4 text-gray-600 border-t border-gray-200"
                    colSpan={9}
                  >
                    Không có dữ liệu theo bộ lọc hiện tại.
                  </td>
                </tr>
              )}

              {rows.map((r) => {
                const qtyCls =
                  r.qty > 0
                    ? "text-green-700"
                    : r.qty < 0
                    ? "text-red-700"
                    : "text-gray-700";

                return (
                  <tr
                    key={r.movementId + ":" + r.itemId + ":" + r.at}
                    className="hover:bg-blue-50/40"
                  >
                    <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap">
                      {formatDateTimeVN(r.at)}
                    </td>

                    <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap">
                      <div className="font-semibold text-gray-900">
                        {r.invoiceCode || "-"}
                      </div>
                      {/* Ẩn movementId để UI gọn hơn (nếu muốn hiện lại thì bỏ comment) */}
                      {/* <div className="text-xs text-gray-500 truncate max-w-[240px]">{r.movementId}</div> */}
                    </td>

                    <td className="px-3 py-2 border-t border-gray-200 text-center whitespace-nowrap">
                      <span className={movementBadgeClass(r.movementType)}>
                        {movementLabel(r.movementType)}
                      </span>
                    </td>

                    <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap">
                      {r.itemSku || "-"}
                    </td>

                    <td className="px-3 py-2 border-t border-gray-200">
                      <div className="font-medium text-gray-900">
                        {r.itemName || "-"}
                      </div>
                      {/* Ẩn itemId để UI gọn hơn */}
                      {/* <div className="text-xs text-gray-500 truncate max-w-[460px]">{r.itemId}</div> */}
                    </td>

                    <td
                      className={`px-3 py-2 border-t border-gray-200 text-right whitespace-nowrap font-semibold ${qtyCls}`}
                    >
                      {r.qty > 0 ? "+" : ""}
                      {formatNumber(r.qty)}
                    </td>

                    <td className="px-3 py-2 border-t border-gray-200 text-right whitespace-nowrap">
                      {r.unitCost != null ? `${formatMoney(r.unitCost)} đ` : "-"}
                    </td>

                    <td className="px-3 py-2 border-t border-gray-200 text-right whitespace-nowrap">
                      {r.costTotal != null ? `${formatMoney(r.costTotal)} đ` : "-"}
                    </td>

                    <td className="px-3 py-2 border-t border-gray-200">
                      <div className="text-gray-700">{r.note || ""}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="px-4 py-3 text-xs text-gray-500 border-t border-gray-200">
            Đang tải dữ liệu...
          </div>
        )}
      </div>

      {!role && (
        <div className="text-xs text-orange-600">
          Không đọc được role từ /auth/me. Kiểm tra response /api/auth/me có field
          role ở đâu (data.role hay role).
        </div>
      )}
    </div>
  );
};

export default LedgerPage;
