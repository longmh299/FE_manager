// src/pages/DebtsBySalesPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";

type DebtRow = {
  invoiceId?: string;
  date: string;
  customerCode: string;
  customerName: string;
  itemName: string;
  qty: number | null;
  unitPrice: number | null;
  amount: number | null;
  paid: number | null;
  debt: number | null;
  note?: string;
  saleUserId?: string | null;
  saleUserName?: string;
  invoiceCode?: string;
};

type SaleUser = {
  id: string;
  username: string;
  name?: string;
  role?: string;
};

function toNumberSafe(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: any) {
  const n = toNumberSafe(value);
  return n.toLocaleString("vi-VN", {
    style: "currency",
    currency: "VND",
  });
}

// Tìm mảng user trong mọi kiểu response: [], {data:[]}, {items:[]}, {users:[]}, ...
function extractUserList(raw: any): SaleUser[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  const candidates: any[] = [];

  Object.values(raw).forEach((v) => {
    if (Array.isArray(v)) candidates.push(v);
    else if (v && typeof v === "object") {
      Object.values(v).forEach((v2) => {
        if (Array.isArray(v2)) candidates.push(v2);
      });
    }
  });

  for (const arr of candidates) {
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      typeof arr[0] === "object" &&
      ("id" in arr[0] || "username" in arr[0])
    ) {
      return arr as SaleUser[];
    }
  }

  return [];
}

function getDefaultDateRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  return { fromStr, toStr };
}

const DebtsBySalesPage: React.FC = () => {
  const { fromStr: defaultFrom, toStr: defaultTo } = useMemo(
    () => getDefaultDateRange(),
    []
  );

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [saleUserId, setSaleUserId] = useState<string>("");

  const [rows, setRows] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saleUsers, setSaleUsers] = useState<SaleUser[]>([]);

  // note tạm + trạng thái saving
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>(
    {}
  );

  // ===== Load danh sách user (sale) =====
  useEffect(() => {
    const fetchSaleUsers = async () => {
      try {
        const res = await api.get("/users", {
          params: { page: 1, pageSize: 100 },
        });

        let list = extractUserList(res.data);

        const hasRole = list.some((u) => !!u.role);
        if (hasRole) {
          list = list.filter(
            (u) => !u.role || u.role === "staff" || u.role === "accountant"
          );
        }

        setSaleUsers(list);
      } catch (err) {
        console.error("Failed to load sale users", err);
        setSaleUsers([]);
      }
    };
    fetchSaleUsers();
  }, []);

  // ===== Load bảng công nợ =====
  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get("/debts/by-sale", {
        params: {
          from: dateFrom || undefined,
          to: dateTo || undefined,
          saleUserId: saleUserId || undefined,
        },
      });

      const data = Array.isArray(res.data) ? res.data : [];
      setRows(data as DebtRow[]);

      // reset draft note theo dữ liệu mới
      const drafts: Record<string, string> = {};
      (data as DebtRow[]).forEach((r) => {
        if (r.invoiceId) drafts[r.invoiceId] = r.note ?? "";
      });
      setNoteDrafts(drafts);
    } catch (err) {
      console.error("Failed to load debts", err);
      setRows([]);
      setNoteDrafts({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalDebt = useMemo(
    () => rows.reduce((sum, r) => sum + toNumberSafe(r.debt), 0),
    [rows]
  );
  const totalAmount = useMemo(
    () => rows.reduce((sum, r) => sum + toNumberSafe(r.amount), 0),
    [rows]
  );
  const totalPaid = useMemo(
    () => rows.reduce((sum, r) => sum + toNumberSafe(r.paid), 0),
    [rows]
  );

  // ===== Lưu note =====
  const handleNoteChange = (row: DebtRow, value: string) => {
    if (!row.invoiceId) return;
    const key = row.invoiceId;
    setNoteDrafts((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleNoteBlur = async (row: DebtRow) => {
    if (!row.invoiceId) return;
    const key = row.invoiceId;
    const note = noteDrafts[key] ?? row.note ?? "";

    try {
      setSavingNoteIds((prev) => ({ ...prev, [key]: true }));
      // ✅ gọi BE mới: /debts/:invoiceId/note
      await api.patch(`/debts/${key}/note`, { note });

      // cập nhật lại note trong rows để UI sync
      setRows((prev) =>
        prev.map((r) =>
          r.invoiceId === key
            ? {
                ...r,
                note,
              }
            : r
        )
      );
    } catch (err) {
      console.error("Failed to save note", err);
    } finally {
      setSavingNoteIds((prev) => ({ ...prev, [key]: false }));
    }
  };

  // ===== Xuất Excel qua API =====
  const handleExportExcel = async () => {
    try {
      if (!rows.length) return;
      const res = await api.get("/debts/by-sale/export", {
        params: {
          from: dateFrom || undefined,
          to: dateTo || undefined,
          saleUserId: saleUserId || undefined,
        },
        responseType: "blob",
      });

      const blob = new Blob([res.data], {
        type:
          res.headers["content-type"] ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      const fileName = `cong-no-theo-sale_${dateFrom}_to_${dateTo}.xlsx`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export excel", err);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Công nợ theo sale</h1>
        <button
          onClick={handleExportExcel}
          disabled={!rows.length}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-4 py-2 rounded text-sm"
        >
          Xuất Excel
        </button>
      </div>

      {/* Bộ lọc */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Từ ngày</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Đến ngày</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Nhân viên sale
          </label>
          <select
            value={saleUserId}
            onChange={(e) => setSaleUserId(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          >
            <option value="">-- Tất cả --</option>
            {saleUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.username || u.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={fetchData}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded w-full md:w-auto"
          >
            {loading ? "Đang tải..." : "Lọc"}
          </button>
        </div>
      </div>

      {/* Card tổng hợp */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-4 py-3">
          <div className="text-xs font-medium text-slate-500 uppercase">
            TỔNG THÀNH TIỀN
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-800">
            {formatCurrency(totalAmount)}
          </div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 shadow-sm px-4 py-3">
          <div className="text-xs font-medium text-emerald-600 uppercase">
            TỔNG ĐÃ THANH TOÁN
          </div>
          <div className="mt-1 text-xl font-semibold text-emerald-700">
            {formatCurrency(totalPaid)}
          </div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 shadow-sm px-4 py-3">
          <div className="text-xs font-medium text-red-600 uppercase">
            TỔNG CÒN NỢ
          </div>
          <div className="mt-1 text-xl font-semibold text-red-600">
            {formatCurrency(totalDebt)}
          </div>
        </div>
      </div>

      {/* Bảng công nợ */}
      <div className="overflow-auto border rounded bg-white shadow-sm">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr className="text-slate-700">
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                NGÀY
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Mã KH
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Tên KH
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Tên hàng
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                SL
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                ĐG
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                Thành tiền
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                Thanh toán
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                Nợ
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Sale
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Ghi chú
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const qty = toNumberSafe(r.qty);
              const unitPrice = toNumberSafe(r.unitPrice);
              const amount = toNumberSafe(r.amount);
              const paid = toNumberSafe(r.paid);
              const debt = toNumberSafe(r.debt);

              const key = r.invoiceId || r.invoiceCode || `${idx}`;
              const noteValue = noteDrafts[key] ?? r.note ?? "";
              const saving = savingNoteIds[r.invoiceId || ""];

              return (
                <tr
                  key={idx}
                  className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}
                >
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.date}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.customerCode}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.customerName}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.itemName}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">
                    {qty}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">
                    {unitPrice.toLocaleString("vi-VN")}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">
                    {amount.toLocaleString("vi-VN")}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">
                    {paid.toLocaleString("vi-VN")}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap text-red-600 font-medium">
                    {debt.toLocaleString("vi-VN")}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.saleUserName}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap max-w-[220px]">
                    {r.invoiceId ? (
                      <input
                        className="w-full border rounded px-1 py-[2px] text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={noteValue}
                        onChange={(e) =>
                          handleNoteChange(r, e.target.value)
                        }
                        onBlur={() => handleNoteBlur(r)}
                      />
                    ) : (
                      <span className="text-slate-500">{r.note}</span>
                    )}
                    {saving && (
                      <span className="ml-1 text-[10px] text-slate-400">
                        (đang lưu…)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && !loading && (
              <tr>
                <td
                  className="border px-2 py-3 text-center text-slate-500"
                  colSpan={11}
                >
                  Không có dữ liệu
                </td>
              </tr>
            )}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 font-semibold">
                <td className="border px-2 py-1" colSpan={6}>
                  TỔNG
                </td>
                <td className="border px-2 py-1 text-right">
                  {toNumberSafe(totalAmount).toLocaleString("vi-VN")}
                </td>
                <td className="border px-2 py-1 text-right">
                  {toNumberSafe(totalPaid).toLocaleString("vi-VN")}
                </td>
                <td className="border px-2 py-1 text-right text-red-600">
                  {toNumberSafe(totalDebt).toLocaleString("vi-VN")}
                </td>
                <td className="border px-2 py-1" colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default DebtsBySalesPage;
