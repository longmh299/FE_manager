// src/pages/RevenuePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { fetchRevenueSummary } from "../api/reports";
import type {
  RevenueSummary,
  RevenueUserStat,
  RevenueProductStat,
  RevenueInvoice,
} from "../types";

type SelectedUser = {
  id: string;
  type: "sale" | "tech";
  username: string;
};

type InvoiceListItem = RevenueInvoice;

// ===== Helpers dùng chung =====
function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  return { fromStr, toStr };
}

function formatCurrencyVND(value: number) {
  return value.toLocaleString("vi-VN", {
    style: "currency",
    currency: "VND",
  });
}

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("vi-VN");
}

const RevenuePage: React.FC = () => {
  const { fromStr: defaultFrom, toStr: defaultTo } = useMemo(
    () => getCurrentMonthRange(),
    []
  );

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const [data, setData] = useState<RevenueSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);
  const [userInvoices, setUserInvoices] = useState<InvoiceListItem[]>([]);
  const [loadingUserInvoices, setLoadingUserInvoices] = useState(false);

  // ===== Load summary =====
  const loadSummary = async () => {
    try {
      setLoading(true);
      setError(null);
      const summary = await fetchRevenueSummary({ from, to });
      setData(summary);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyRange = () => {
    loadSummary();
    setSelectedUser(null);
    setUserInvoices([]);
  };

  // ===== Load invoices theo nhân viên (sale/tech) =====
  const loadUserInvoices = async (u: SelectedUser) => {
    try {
      setLoadingUserInvoices(true);
      const params: any = {
        page: 1,
        pageSize: 100,
        type: "SALES",
        from,
        to,
      };
      if (u.type === "sale") {
        params.saleUserId = u.id;
      } else {
        params.techUserId = u.id;
      }

      const res = await api.get("/invoices", { params });
      const payload = res.data;

      const list: InvoiceListItem[] = (payload.data || []).map((inv: any) => ({
        id: inv.id,
        code: inv.code,
        issueDate: inv.issueDate,
        total:
          typeof inv.total === "number" ? inv.total : Number(inv.total || 0),
        partnerName: inv.partnerName,
        saleUserName: inv.saleUserName,
        techUserName: inv.techUserName,
      }));

      setUserInvoices(list);
    } catch (err) {
      console.error(err);
      setUserInvoices([]);
    } finally {
      setLoadingUserInvoices(false);
    }
  };

  const handleSelectUser = (stat: RevenueUserStat, type: "sale" | "tech") => {
    const u: SelectedUser = {
      id: stat.userId,
      type,
      username: stat.username,
    };
    setSelectedUser(u);
    loadUserInvoices(u);
  };

  // ===== Render helpers =====
  const renderUserTable = (
    title: string,
    rows: RevenueUserStat[],
    type: "sale" | "tech"
  ) => {
    return (
      <section className="bg-white shadow-sm rounded-md p-4">
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-xs text-gray-500 mb-2">
          Click vào dòng nhân viên để xem lịch sử hóa đơn trong khoảng thời
          gian trên.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-600">Không có dữ liệu.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                    STT
                  </th>
                  <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                    Username
                  </th>
                  <th className="px-2 py-1 border border-gray-200 text-right text-xs font-semibold">
                    Số hóa đơn
                  </th>
                  <th className="px-2 py-1 border border-gray-200 text-right text-xs font-semibold">
                    Doanh thu
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u, idx) => {
                  const isActive =
                    selectedUser &&
                    selectedUser.id === u.userId &&
                    selectedUser.type === type;
                  return (
                    <tr
                      key={u.userId}
                      className={
                        "cursor-pointer hover:bg-blue-50" +
                        (isActive ? " bg-blue-100" : "")
                      }
                      onClick={() => handleSelectUser(u, type)}
                    >
                      <td className="px-2 py-1 border border-gray-200">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-1 border border-gray-200">
                        {u.username}
                      </td>
                      <td className="px-2 py-1 border border-gray-200 text-right">
                        {u.invoiceCount}
                      </td>
                      <td className="px-2 py-1 border border-gray-200 text-right">
                        {formatCurrencyVND(u.totalRevenue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const renderTopProducts = (rows: RevenueProductStat[]) => {
    return (
      <section className="bg-white shadow-sm rounded-md p-4">
        <h3 className="font-semibold mb-2">Top 10 sản phẩm theo doanh thu</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-600">Không có dữ liệu.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                    STT
                  </th>
                  <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                    Mã SP
                  </th>
                  <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                    Tên sản phẩm
                  </th>
                  <th className="px-2 py-1 border border-gray-200 text-right text-xs font-semibold">
                    Số lượng
                  </th>
                  <th className="px-2 py-1 border border-gray-200 text-right text-xs font-semibold">
                    Doanh thu
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, idx) => (
                  <tr key={p.itemId}>
                    <td className="px-2 py-1 border border-gray-200">
                      {idx + 1}
                    </td>
                    <td className="px-2 py-1 border border-gray-200">
                      {p.sku || "-"}
                    </td>
                    <td className="px-2 py-1 border border-gray-200">
                      {p.name || "-"}
                    </td>
                    <td className="px-2 py-1 border border-gray-200 text-right">
                      {p.qty}
                    </td>
                    <td className="px-2 py-1 border border-gray-200 text-right">
                      {formatCurrencyVND(p.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-lg font-semibold mb-2">Thống kê doanh thu</h2>

      {/* Bộ lọc thời gian */}
      <section className="bg-white shadow-sm rounded-md p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-semibold mb-1">Từ ngày</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Đến ngày</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={handleApplyRange}
          disabled={loading}
          className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Áp dụng
        </button>
        {loading && (
          <span className="text-xs text-gray-500">Đang tải dữ liệu...</span>
        )}
        {error && (
          <span className="text-xs text-red-500 ml-auto">{error}</span>
        )}
      </section>

      {data && !loading && (
        <>
          {/* Tổng quan */}
          <section className="grid gap-4 md:grid-cols-3">
            <div className="bg-white shadow-sm rounded-md p-4">
              <div className="text-xs text-gray-500 mb-1">Khoảng thời gian</div>
              <div className="font-semibold text-sm">
                {formatDate(data.from)} - {formatDate(data.to)}
              </div>
            </div>
            <div className="bg-white shadow-sm rounded-md p-4">
              <div className="text-xs text-gray-500 mb-1">Tổng doanh thu</div>
              <div className="font-semibold text-green-700">
                {formatCurrencyVND(data.totalRevenue)}
              </div>
            </div>
            <div className="bg-white shadow-sm rounded-md p-4">
              <div className="text-xs text-gray-500 mb-1">Số hóa đơn</div>
              <div className="font-semibold text-sm">{data.invoiceCount}</div>
            </div>
          </section>

          {/* Bảng theo nhân viên */}
          <section className="grid gap-4 lg:grid-cols-2">
            {renderUserTable(
              "Doanh thu theo nhân viên SALE",
              data.bySaleUser,
              "sale"
            )}
            {renderUserTable(
              "Doanh thu theo nhân viên KỸ THUẬT",
              data.byTechUser,
              "tech"
            )}
          </section>

          {/* Top sản phẩm */}
          {renderTopProducts(data.topProducts)}

          {/* Lịch sử hóa đơn của nhân viên được chọn */}
          <section className="bg-white shadow-sm rounded-md p-4">
            <h3 className="font-semibold mb-2">
              Lịch sử hóa đơn của{" "}
              {selectedUser
                ? `${selectedUser.username} (${selectedUser.type.toUpperCase()})`
                : "nhân viên (nhấn chọn ở bảng trên)"}
            </h3>

            {loadingUserInvoices ? (
              <p className="text-sm text-gray-600">Đang tải hóa đơn...</p>
            ) : !selectedUser ? (
              <p className="text-sm text-gray-600">Chưa chọn nhân viên.</p>
            ) : userInvoices.length === 0 ? (
              <p className="text-sm text-gray-600">
                Không có hóa đơn trong khoảng thời gian này.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                        Mã HĐ
                      </th>
                      <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                        Ngày
                      </th>
                      <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                        Khách hàng
                      </th>
                      <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                        Nhân viên sale
                      </th>
                      <th className="px-2 py-1 border border-gray-200 text-left text-xs font-semibold">
                        Nhân viên kỹ thuật
                      </th>
                      <th className="px-2 py-1 border border-gray-200 text-right text-xs font-semibold">
                        Tổng tiền
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {userInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-2 py-1 border border-gray-200">
                          {inv.code}
                        </td>
                        <td className="px-2 py-1 border border-gray-200">
                          {formatDate(inv.issueDate)}
                        </td>
                        <td className="px-2 py-1 border border-gray-200">
                          {inv.partnerName || "-"}
                        </td>
                        <td className="px-2 py-1 border border-gray-200">
                          {inv.saleUserName || "-"}
                        </td>
                        <td className="px-2 py-1 border border-gray-200">
                          {inv.techUserName || "-"}
                        </td>
                        <td className="px-2 py-1 border border-gray-200 text-right">
                          {formatCurrencyVND(inv.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default RevenuePage;
