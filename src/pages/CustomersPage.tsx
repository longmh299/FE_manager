import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

type Customer = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  taxCode?: string;
  totalRevenue: number;
  orderCount: number;
  lastActivityAt?: string;
  lastActivityType?: string;
  lastNote?: string;
  needCare: boolean;
};

const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyMine, setOnlyMine] = useState(true); // 🔥 NEW
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get("/customers", {
        params: { onlyMine },
      });
      setCustomers(res.data.data || []);
    } catch (err) {
      console.error(err);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [onlyMine]); // 🔥 reload khi đổi tab

  // 🔍 filter local
  const filtered = customers.filter((c) => {
    const keyword = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(keyword) ||
      c.phone?.includes(keyword)
    );
  });

  // ⚠️ check thiếu info
  const getMissingFields = (c: Customer) => {
    const missing: string[] = [];
    if (!c.phone) missing.push("SĐT");
    if (!c.email) missing.push("Email");
    if (!c.taxCode) missing.push("MST");
    return missing;
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold">Khách hàng (CSKH)</h2>

      {/* 🔥 TABS */}
      <div className="flex gap-2">
        <button
          onClick={() => setOnlyMine(false)}
          className={`px-3 py-1 text-sm rounded ${
            !onlyMine
              ? "bg-blue-500 text-white"
              : "bg-gray-100"
          }`}
        >
          Tất cả
        </button>

        <button
          onClick={() => setOnlyMine(true)}
          className={`px-3 py-1 text-sm rounded ${
            onlyMine
              ? "bg-blue-500 text-white"
              : "bg-gray-100"
          }`}
        >
          Khách của tôi
        </button>
      </div>

      {/* 🔍 SEARCH */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Tìm theo tên / SĐT..."
          className="w-full border rounded-lg px-3 py-2 text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* STATE */}
      {loading && (
        <div className="text-center text-gray-500">
          Đang tải...
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center text-gray-400">
          Không có khách
        </div>
      )}

      {/* GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((c) => {
          const lastDate = c.lastActivityAt
            ? new Date(c.lastActivityAt)
            : null;

          const missingFields = getMissingFields(c);

          return (
            <div
              key={c.id}
              onClick={() => navigate(`/customers/${c.id}`)}
              className={`
                cursor-pointer rounded-2xl p-4 border shadow-sm transition
                hover:shadow-md hover:-translate-y-0.5
                ${
                  c.needCare
                    ? "border-red-300 bg-red-50"
                    : "bg-white"
                }
              `}
            >
              {/* HEADER */}
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold text-base">
                    {c.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {c.phone || "Chưa có SĐT"}
                  </div>
                </div>

                <div className="flex gap-1 flex-wrap justify-end">
                  {c.needCare && (
                    <span className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded">
                      ⚠️ Cần chăm
                    </span>
                  )}

                  {missingFields.length > 0 && (
                    <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                      Thiếu: {missingFields.join(", ")}
                    </span>
                  )}
                </div>
              </div>

              {/* NOTE */}
              {c.lastNote && (
                <div className="text-xs text-gray-400 italic mt-2 line-clamp-2">
                  {c.lastNote}
                </div>
              )}

              {/* STATS */}
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-gray-400 text-xs">
                    Đơn
                  </div>
                  <div className="font-medium">
                    {c.orderCount}
                  </div>
                </div>

                <div>
                  <div className="text-gray-400 text-xs">
                    Doanh thu
                  </div>
                  <div className="font-medium">
                    {c.totalRevenue.toLocaleString(
                      "vi-VN"
                    )}{" "}
                    đ
                  </div>
                </div>
              </div>

              {/* ACTIVITY */}
              <div className="mt-4 text-xs">
                {lastDate ? (
                  <>
                    <div className="font-medium">
                      {c.lastActivityType}
                    </div>
                    <div className="text-gray-500">
                      {lastDate.toLocaleDateString()}
                    </div>
                  </>
                ) : (
                  <div className="text-gray-400 italic">
                    Chưa chăm
                  </div>
                )}
              </div>

              {/* ACTIONS */}
              <div
                className="mt-4 flex gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="flex-1 text-xs bg-slate-100 hover:bg-slate-200 rounded px-2 py-1"
                  onClick={() =>
                    navigate(`/customers/${c.id}`)
                  }
                >
                  Xem
                </button>

                <button className="flex-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded px-2 py-1">
                  Chăm
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomersPage;