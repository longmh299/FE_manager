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

// ==== kiểu dùng cho popup chi tiết hóa đơn ====
type InvoiceLineSummary = {
  id: string;
  itemName: string;
  qty: number;
  price: number;
  amount: number;
};

type InvoiceDetail = {
  invoiceId: string;
  code: string;
  date: string;
  partnerCode: string;
  partnerName: string;
  saleUserName?: string;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  note?: string;
  lines: InvoiceLineSummary[];
};

// ==== kiểu dùng cho dòng đã gộp theo hóa đơn ====
type InvoiceDebtRow = {
  invoiceId: string;
  invoiceCode?: string;
  date: string;
  customerCode: string;
  customerName: string;
  totalAmount: number;
  totalPaid: number;
  totalDebt: number;
  saleUserName?: string;
  note?: string;
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

// Tìm mảng user trong mọi kiểu response
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

  // rows = chi tiết từng dòng (máy)
  const [rows, setRows] = useState<DebtRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saleUsers, setSaleUsers] = useState<SaleUser[]>([]);

  // note tạm + trạng thái saving
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>(
    {}
  );

  // popup chi tiết hóa đơn
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(
    null
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

  // ===== Load bảng công nợ (từng dòng) =====
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

  // ===== Gộp theo hóa đơn + CHỈ GIỮ HĐ CÒN NỢ > 0 =====
  const invoiceRows: InvoiceDebtRow[] = useMemo(() => {
    const map: Record<string, InvoiceDebtRow> = {};

    for (const r of rows) {
      if (!r.invoiceId && !r.invoiceCode) continue;
      const key = r.invoiceId ?? r.invoiceCode!;
      if (!map[key]) {
        map[key] = {
          invoiceId: r.invoiceId ?? key,
          invoiceCode: r.invoiceCode,
          date: r.date,
          customerCode: r.customerCode,
          customerName: r.customerName,
          totalAmount: 0,
          totalPaid: 0,
          totalDebt: 0,
          saleUserName: r.saleUserName,
          note: r.note,
        };
      }
      map[key].totalAmount += toNumberSafe(r.amount);
      map[key].totalPaid += toNumberSafe(r.paid);
      map[key].totalDebt += toNumberSafe(r.debt);
    }

    const list = Object.values(map);

    // ✅ chỉ giữ lại hóa đơn còn nợ > 0
    return list
      .filter((inv) => toNumberSafe(inv.totalDebt) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  // ===== Tổng cộng toàn kỳ (chỉ tính các HĐ còn nợ) =====
  const totalAmount = useMemo(
    () =>
      invoiceRows.reduce((sum, inv) => sum + toNumberSafe(inv.totalAmount), 0),
    [invoiceRows]
  );
  const totalPaid = useMemo(
    () =>
      invoiceRows.reduce((sum, inv) => sum + toNumberSafe(inv.totalPaid), 0),
    [invoiceRows]
  );
  const totalDebt = useMemo(
    () =>
      invoiceRows.reduce((sum, inv) => sum + toNumberSafe(inv.totalDebt), 0),
    [invoiceRows]
  );

  // ===== Lưu note =====
  const handleNoteChange = (invoiceId: string, value: string) => {
    setNoteDrafts((prev) => ({
      ...prev,
      [invoiceId]: value,
    }));
  };

  const handleNoteBlur = async (row: InvoiceDebtRow) => {
    const key = row.invoiceId;
    const note = noteDrafts[key] ?? row.note ?? "";

    try {
      setSavingNoteIds((prev) => ({ ...prev, [key]: true }));
      await api.patch(`/debts/${key}/note`, { note });

      // cập nhật note trong rows chi tiết để sync UI
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

  // ===== Xuất Excel qua API (vẫn dùng dữ liệu chi tiết) =====
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

  // ===== Mở popup chi tiết hóa đơn – dùng dữ liệu rows chi tiết =====
  const handleOpenInvoiceDetail = (row: InvoiceDebtRow) => {
    const sameInvoiceRows = rows.filter(
      (r) => r.invoiceId === row.invoiceId
    );
    if (!sameInvoiceRows.length) return;

    const totalAmount = sameInvoiceRows.reduce(
      (sum, r) => sum + toNumberSafe(r.amount),
      0
    );
    const paidAmount = sameInvoiceRows.reduce(
      (sum, r) => sum + toNumberSafe(r.paid),
      0
    );
    const debtAmount = sameInvoiceRows.reduce(
      (sum, r) => sum + toNumberSafe(r.debt),
      0
    );

    const lines: InvoiceLineSummary[] = sameInvoiceRows.map((r, idx) => ({
      id: `${r.invoiceId}-${idx}`,
      itemName: r.itemName,
      qty: toNumberSafe(r.qty),
      price: toNumberSafe(r.unitPrice),
      amount: toNumberSafe(r.amount),
    }));

    const base = sameInvoiceRows[0];

    const detail: InvoiceDetail = {
      invoiceId: base.invoiceId!,
      code: base.invoiceCode ?? "",
      date: base.date,
      partnerCode: base.customerCode,
      partnerName: base.customerName,
      saleUserName: base.saleUserName,
      totalAmount,
      paidAmount,
      debtAmount,
      note: base.note,
      lines,
    };

    setSelectedInvoice(detail);
  };

  const handleCloseInvoiceDetail = () => {
    setSelectedInvoice(null);
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

      {/* Card tổng hợp (chỉ hóa đơn còn nợ) */}
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

      {/* Bảng công nợ đã gộp theo hóa đơn (chỉ còn nợ) */}
      <div className="overflow-auto border rounded bg-white shadow-sm">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr className="text-slate-700">
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                NGÀY
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Mã HĐ
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Mã KH
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-left">
                Tên KH
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                Tổng tiền
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                Đã thanh toán
              </th>
              <th className="border px-2 py-1 whitespace-nowrap text-right">
                Còn nợ
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
            {invoiceRows.map((r, idx) => {
              const key = r.invoiceId;
              const noteValue = noteDrafts[key] ?? r.note ?? "";
              const saving = savingNoteIds[key];

              return (
                <tr
                  key={r.invoiceId}
                  className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}
                >
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.date}
                  </td>
                  {/* Mã HĐ – click để mở popup chi tiết */}
                  <td className="border px-2 py-1 whitespace-nowrap">
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => handleOpenInvoiceDetail(r)}
                    >
                      {r.invoiceCode}
                    </button>
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.customerCode}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.customerName}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">
                    {toNumberSafe(r.totalAmount).toLocaleString("vi-VN")}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap">
                    {toNumberSafe(r.totalPaid).toLocaleString("vi-VN")}
                  </td>
                  <td className="border px-2 py-1 text-right whitespace-nowrap text-red-600 font-medium">
                    {toNumberSafe(r.totalDebt).toLocaleString("vi-VN")}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap">
                    {r.saleUserName}
                  </td>
                  <td className="border px-2 py-1 whitespace-nowrap max-w-[220px]">
                    <input
                      className="w-full border rounded px-1 py-[2px] text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={noteValue}
                      onChange={(e) =>
                        handleNoteChange(r.invoiceId, e.target.value)
                      }
                      onBlur={() => handleNoteBlur(r)}
                    />
                    {saving && (
                      <span className="ml-1 text-[10px] text-slate-400">
                        (đang lưu…)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {invoiceRows.length === 0 && !loading && (
              <tr>
                <td
                  className="border px-2 py-3 text-center text-slate-500"
                  colSpan={9}
                >
                  Không có dữ liệu
                </td>
              </tr>
            )}
          </tbody>

          {invoiceRows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-100 font-semibold">
                {/* 1:Ngày, 2:Mã HĐ, 3:Mã KH, 4:Tên KH */}
                <td className="border px-2 py-1" colSpan={4}>
                  TỔNG
                </td>
                {/* 5:Tổng tiền, 6:Đã thanh toán, 7:Còn nợ */}
                <td className="border px-2 py-1 text-right">
                  {toNumberSafe(totalAmount).toLocaleString("vi-VN")}
                </td>
                <td className="border px-2 py-1 text-right">
                  {toNumberSafe(totalPaid).toLocaleString("vi-VN")}
                </td>
                <td className="border px-2 py-1 text-right text-red-600">
                  {toNumberSafe(totalDebt).toLocaleString("vi-VN")}
                </td>
                {/* 8:Sale, 9:Ghi chú */}
                <td className="border px-2 py-1" colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ===== Popup chi tiết hóa đơn ===== */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-auto p-4 sm:p-6">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold mb-1">
                  Hóa đơn {selectedInvoice.code}
                </h2>
                <div className="text-xs text-slate-600 space-y-0.5">
                  <div>
                    Ngày:{" "}
                    <span className="font-medium">
                      {selectedInvoice.date}
                    </span>
                  </div>
                  <div>
                    Khách:{" "}
                    <span className="font-medium">
                      {selectedInvoice.partnerName}
                    </span>{" "}
                    {selectedInvoice.partnerCode && (
                      <span className="text-slate-500">
                        ({selectedInvoice.partnerCode})
                      </span>
                    )}
                  </div>
                  <div>
                    Sale:{" "}
                    <span className="font-medium">
                      {selectedInvoice.saleUserName}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseInvoiceDetail}
                className="ml-3 text-slate-500 hover:text-slate-800 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <table className="w-full text-xs sm:text-sm border border-slate-200 mb-3">
              <thead className="bg-slate-100">
                <tr>
                  <th className="border px-2 py-1 text-left">Sản phẩm</th>
                  <th className="border px-2 py-1 text-right">SL</th>
                  <th className="border px-2 py-1 text-right">Đơn giá</th>
                  <th className="border px-2 py-1 text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoice.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="border px-2 py-1">{l.itemName}</td>
                    <td className="border px-2 py-1 text-right">
                      {l.qty}
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {l.price.toLocaleString("vi-VN")}
                    </td>
                    <td className="border px-2 py-1 text-right">
                      {l.amount.toLocaleString("vi-VN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
              <div className="space-y-0.5">
                <div>
                  Tổng tiền:{" "}
                  <span className="font-semibold">
                    {formatCurrency(selectedInvoice.totalAmount)}
                  </span>
                </div>
                <div>
                  Đã thanh toán:{" "}
                  <span className="font-semibold text-emerald-600">
                    {formatCurrency(selectedInvoice.paidAmount)}
                  </span>
                </div>
                <div>
                  Còn nợ:{" "}
                  <span className="font-semibold text-red-600">
                    {formatCurrency(selectedInvoice.debtAmount)}
                  </span>
                </div>
              </div>
              {selectedInvoice.note && (
                <div className="text-xs text-slate-600 max-w-xs">
                  Ghi chú: {selectedInvoice.note}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DebtsBySalesPage;
