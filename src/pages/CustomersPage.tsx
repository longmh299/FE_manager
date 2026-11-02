import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

type Customer = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  taxCode?: string;
  totalRevenue: number;
  orderCount: number;
  lastInvoiceDate?: string | null;
  lastNote?: string;
};

// API mặc định chỉ trả 20 khách, trong khi ô tìm kiếm lọc ngay trên trình duyệt
const PAGE_SIZE = 1000;

const normalize = (s?: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

const fmtMoney = (n: number) => `${Number(n || 0).toLocaleString("vi-VN")} đ`;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("vi-VN") : "Chưa mua");

const getMissingFields = (c: Customer) => {
  const missing: string[] = [];
  if (!c.phone) missing.push("SĐT");
  if (!c.email) missing.push("email");
  if (!c.taxCode) missing.push("MST");
  return missing;
};

const actionClass =
  "inline-flex !min-h-[34px] items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:border-blue-500 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

const ContactActions: React.FC<{ phone?: string }> = ({ phone }) =>
  phone ? (
    <div className="flex shrink-0 gap-2" onClick={(e) => e.stopPropagation()}>
      <a href={`tel:${phone.replace(/\s/g, "")}`} className={actionClass}>
        Gọi
      </a>
      <a href={`https://zalo.me/${phone.replace(/\s/g, "")}`} target="_blank" rel="noreferrer" className={actionClass}>
        Zalo
      </a>
    </div>
  ) : null;

const CustomersPage: React.FC = () => {
  const { user } = useAuth();
  const isStaff = user?.role === "staff"; // staff chỉ có khách của mình nên không cần chọn tab

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(true);
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/customers", { params: { onlyMine, pageSize: PAGE_SIZE } });
      setCustomers(res.data.data || []);
    } catch (err) {
      console.error(err);
      setCustomers([]);
      setError("Không tải được danh sách khách hàng.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyMine]);

  // Tìm theo tên không cần dấu, theo SĐT không cần dấu cách; khách mua gần đây nhất lên đầu
  const rows = useMemo(() => {
    const keyword = normalize(search.trim());
    const digits = keyword.replace(/\D/g, "");
    return customers
      .filter(
        (c) =>
          !keyword ||
          normalize(c.name).includes(keyword) ||
          (!!digits && (c.phone || "").replace(/\D/g, "").includes(digits))
      )
      .sort((a, b) => String(b.lastInvoiceDate || "").localeCompare(String(a.lastInvoiceDate || "")));
  }, [customers, search]);

  const topRevenue = useMemo(() => Math.max(0, ...rows.map((c) => c.totalRevenue || 0)), [rows]);

  const tabClass = (active: boolean) =>
    `flex-1 md:flex-none rounded-md px-3 py-1.5 text-sm font-medium ${
      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
    }`;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-semibold">Khách hàng</h1>
        {!loading && !error && (
          <span className="text-sm tabular-nums text-slate-500">{rows.length} khách</span>
        )}
      </div>

      <div className="bg-white shadow-sm rounded-md">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-3 md:flex-row md:items-center md:p-4">
          <input
            type="search"
            aria-label="Tìm khách hàng"
            placeholder="Tìm theo tên hoặc số điện thoại..."
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!isStaff && (
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Phạm vi khách hàng">
              <button type="button" aria-pressed={onlyMine} onClick={() => setOnlyMine(true)} className={tabClass(onlyMine)}>
                Khách của tôi
              </button>
              <button type="button" aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)} className={tabClass(!onlyMine)}>
                Tất cả
              </button>
            </div>
          )}
        </div>

        {/* Tiêu đề cột, chỉ có trên máy tính */}
        <div className="hidden grid-cols-[minmax(0,1fr)_64px_190px_110px_132px] gap-4 border-b border-slate-200 px-4 py-2 text-xs font-medium text-slate-500 md:grid">
          <div>Khách hàng</div>
          <div className="text-right">Số đơn</div>
          <div className="text-right">Doanh thu</div>
          <div>Mua gần nhất</div>
          <div />
        </div>

        {loading && <div className="px-4 py-10 text-center text-sm text-slate-500">Đang tải danh sách khách hàng...</div>}

        {!loading && error && (
          <div className="px-4 py-10 text-center text-sm text-slate-600">
            <p>{error}</p>
            <button type="button" onClick={fetchData} className="mt-3 rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700">
              Tải lại
            </button>
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {search.trim()
              ? `Không tìm thấy khách nào khớp với "${search.trim()}". Thử tìm bằng tên ngắn hơn hoặc số điện thoại.`
              : onlyMine
                ? "Bạn chưa có khách nào. Khách sẽ hiện ở đây sau khi bạn có hoá đơn bán đầu tiên."
                : "Chưa có khách hàng nào."}
          </div>
        )}

        {!loading &&
          !error &&
          rows.map((c) => {
            const missing = getMissingFields(c);
            const share = topRevenue > 0 && c.totalRevenue > 0 ? Math.max(2, (c.totalRevenue / topRevenue) * 100) : 0;

            return (
              <div
                key={c.id}
                onClick={() => navigate(`/customers/${c.id}`)}
                className="cursor-pointer border-b border-slate-100 px-3 py-3 last:border-b-0 hover:bg-slate-50 md:grid md:grid-cols-[minmax(0,1fr)_64px_190px_110px_132px] md:items-center md:gap-4 md:px-4"
              >
                <div className="flex items-start justify-between gap-3 md:block md:min-w-0">
                  <div className="min-w-0">
                    <Link
                      to={`/customers/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="block font-medium md:truncate text-slate-900 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm">
                      {c.phone && <span className="tabular-nums text-slate-500">{c.phone}</span>}
                      {missing.length > 0 && <span className="text-amber-700">Thiếu {missing.join(", ")}</span>}
                    </div>
                    {c.lastNote && <div className="mt-0.5 truncate text-sm text-slate-400">{c.lastNote}</div>}
                  </div>
                  {/* Điện thoại: doanh thu nằm cùng hàng với tên */}
                  <div className="shrink-0 text-right font-semibold tabular-nums text-slate-900 md:hidden">
                    {fmtMoney(c.totalRevenue)}
                  </div>
                </div>

                <div className="hidden text-right tabular-nums text-slate-700 md:block">{c.orderCount}</div>

                <div className="hidden md:block">
                  <div className="text-right font-semibold tabular-nums text-slate-900">{fmtMoney(c.totalRevenue)}</div>
                  <div className="mt-1 h-1 rounded-full bg-slate-100" aria-hidden="true">
                    <div className="ml-auto h-1 rounded-full bg-blue-500" style={{ width: `${share}%` }} />
                  </div>
                </div>

                <div className={`hidden text-sm tabular-nums md:block ${c.lastInvoiceDate ? "text-slate-700" : "text-slate-400"}`}>
                  {fmtDate(c.lastInvoiceDate)}
                </div>

                <div className="mt-2 flex items-center justify-between gap-3 md:mt-0 md:justify-end">
                  <div className="flex flex-wrap gap-x-3 text-sm text-slate-500 md:hidden">
                    <span className="tabular-nums">{c.orderCount} đơn</span>
                    <span className="tabular-nums">{c.lastInvoiceDate ? `Mua ${fmtDate(c.lastInvoiceDate)}` : "Chưa mua"}</span>
                  </div>
                  <ContactActions phone={c.phone} />
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default CustomersPage;