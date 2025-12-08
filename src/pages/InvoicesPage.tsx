// src/pages/InvoicesPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

type InvoiceType = "SALES" | "PURCHASE";
type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

type InvoiceListItem = {
  id: string | number;
  code: string;
  date?: string;
  type: InvoiceType;
  partnerName: string;
  totalAmount: number;
  paymentStatus?: PaymentStatus;
  posted?: boolean;
};

// ------ helpers ------
function formatDateDisplay(raw?: string) {
  if (!raw) return "";
  // nếu đang là yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);

  // ---- load list ----
  const fetchInvoices = async (q: string, fromVal: string, toVal: string) => {
    try {
      setLoading(true);
      const res = await api.get("/invoices", {
        params: {
          q,
          page: 1,
          pageSize: 100,
          type: "",
          saleUserId: "",
          techUserId: "",
          from: fromVal || undefined,
          to: toVal || undefined,
        },
      });

      const body = (res as any).data || {};
      const data: any[] = body.data || body || [];

      const mapped: InvoiceListItem[] = data.map((x: any) => {
        const total =
          typeof x.total === "number"
            ? x.total
            : Number(x.total ?? x.subtotal ?? 0);

        const rawDate = x.issueDate ?? x.date ?? x.createdAt ?? "";

        return {
          id: x.id,
          code: x.code ?? "",
          date: rawDate,
          type: (x.type === "PURCHASE" ? "PURCHASE" : "SALES") as InvoiceType,
          partnerName: x.partner?.name ?? x.partnerName ?? "",
          totalAmount: total,
          paymentStatus: (x.paymentStatus as PaymentStatus) ?? "UNPAID",
          // đã post tồn nếu có movement
          posted: Array.isArray(x.movements) && x.movements.length > 0,
        };
      });

      setInvoices(mapped);
    } catch (err) {
      console.error("load invoices error", err);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices("", "", "");
  }, []);

  const handleApplyFilter = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    fetchInvoices(search.trim(), from, to);
  };

  const handleClearFilter = () => {
    const emptyFrom = "";
    const emptyTo = "";
    setFrom(emptyFrom);
    setTo(emptyTo);
    fetchInvoices(search.trim(), emptyFrom, emptyTo);
  };

  const handleDelete = async (inv: InvoiceListItem) => {
    if (!inv.id) return;
    if (!window.confirm("Bạn có chắc muốn xóa hóa đơn này?")) return;
    try {
      await api.delete(`/invoices/${inv.id}`);
      fetchInvoices(search.trim(), from, to);
    } catch (err) {
      console.error("delete invoice error", err);
      alert("Xóa hóa đơn thất bại, xem log console.");
    }
  };

  // ------ render helpers ------
  const renderPaymentBadge = (status?: PaymentStatus) => {
    const st = status || "UNPAID";

    let label = "";
    let className =
      "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ";

    if (st === "PAID") {
      label = "Đã thanh toán";
      className += "bg-green-100 text-green-700 border-green-200";
    } else if (st === "PARTIAL") {
      label = "Thanh toán một phần";
      className += "bg-red-100 text-red-700 border-red-200";
    } else {
      label = "Chưa thanh toán";
      className += "bg-red-100 text-red-700 border-red-200";
    }

    return <span className={className}>{label}</span>;
  };

  const renderStockBadge = (posted?: boolean) => {
    const className = posted
      ? "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap bg-green-100 text-green-700 border-green-200"
      : "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap bg-orange-100 text-orange-700 border-orange-200";

    return <span className={className}>{posted ? "Đã lưu tồn" : "Nháp"}</span>;
  };

  // ------ render ------
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold mb-2">Hóa đơn</h1>

      <div className="bg-white shadow-sm rounded-md p-4">
        {/* Thanh tìm kiếm + bộ lọc thời gian */}
        <form onSubmit={handleApplyFilter} className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Tìm theo số HĐ / tên khách hàng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={() => navigate("/invoices/new")}
              className="inline-flex items-center justify-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap"
            >
              + Thêm hóa đơn
            </button>
          </div>

          {/* Bộ lọc theo ngày */}
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div>
              <label className="block text-xs font-semibold mb-1">
                Từ ngày
              </label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">
                Đến ngày
              </label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-60"
                disabled={loading}
              >
                Áp dụng
              </button>
              <button
                type="button"
                onClick={handleClearFilter}
                className="px-3 py-1 rounded-md border border-gray-300 text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Xóa lọc
              </button>
            </div>
            {loading && (
              <span className="text-xs text-gray-500">Đang tải dữ liệu...</span>
            )}
          </div>
        </form>

        {/* Bảng list */}
        <div className="mt-4 border border-gray-200 rounded-md overflow-hidden">
          <table className="min-w-full table-fixed text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Số HĐ
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Ngày
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Khách hàng
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold border-b border-gray-200">
                  Tổng tiền
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">
                  Thanh toán
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold border-b border-gray-200">
                  Tồn kho
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold border-b border-gray-200">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    className="px-3 py-2 text-sm text-gray-600 border-t border-gray-200"
                    colSpan={7}
                  >
                    Đang tải dữ liệu...
                  </td>
                </tr>
              )}

              {!loading && invoices.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-2 text-sm text-gray-600 border-t border-gray-200"
                    colSpan={7}
                  >
                    Không tìm thấy hóa đơn.
                  </td>
                </tr>
              )}

              {!loading &&
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="odd:bg-white even:bg-gray-50 hover:bg-blue-50 transition-colors"
                  >
                    <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap truncate">
                      {inv.code}
                    </td>
                    <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap">
                      {formatDateDisplay(inv.date)}
                    </td>
                    <td className="px-3 py-2 border-t border-gray-200 whitespace-nowrap truncate">
                      {inv.partnerName}
                    </td>
                    <td className="px-3 py-2 border-t border-gray-200 text-right whitespace-nowrap">
                      {inv.totalAmount.toLocaleString("vi-VN")} đ
                    </td>
                    <td className="px-3 py-2 border-t border-gray-200 text-center">
                      {renderPaymentBadge(inv.paymentStatus)}
                    </td>
                    <td className="px-3 py-2 border-t border-gray-200 text-center">
                      {renderStockBadge(inv.posted)}
                    </td>
                    <td className="px-3 py-2 border-t border-gray-200">
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
                          onClick={() => navigate(`/invoices/${inv.id}`)}
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
                          onClick={() =>
                            window.open(
                              `/invoices/${inv.id}/print`,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          In
                        </button>
                        <button
                          type="button"
                          className="text-red-600 hover:underline"
                          onClick={() => handleDelete(inv)}
                        >
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default InvoicesPage;
