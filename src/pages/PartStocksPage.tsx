// src/pages/PartStocksPage.tsx
import React, { useEffect, useState } from "react";
import api, { extractList, getApiBaseUrl } from "../api/client";

type PartStockRow = {
  sku: string;
  name: string;
  unit: string;
  totalQty: number;
};

const PAGE_SIZE = 50;

const PartStocksPage: React.FC = () => {
  const [rows, setRows] = useState<PartStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState(""); // từ khóa đang áp dụng cho API

  const [page, setPage] = useState(1);

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Load data từ API, chỉ lấy kind=PART, sort theo tồn kho giảm dần
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get("/stocks/summary-by-item", {
          params: {
            kind: "PART", // 🔹 chỉ lấy linh kiện
            page: 1,
            pageSize: 2000, // linh kiện thường nhiều hơn máy, để rộng ra
            q: q.trim() || undefined,
          },
        });

        const list = extractList<any>(res.data) || [];

        const mapped: PartStockRow[] = list.map((r: any) => ({
          sku: r.sku ?? "",
          name: r.name ?? "",
          unit: r.unit ?? "",
          totalQty: Number(r.totalQty ?? 0),
        }));

        // Sắp xếp tồn kho từ lớn xuống nhỏ
        mapped.sort((a, b) => b.totalQty - a.totalQty);

        setRows(mapped);
        setPage(1);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "Lỗi tải dữ liệu");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [q]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQ(searchText);
  };

  const handleExport = () => {
    const base = getApiBaseUrl();
    const url =
      base +
      "/api/stocks/summary-by-item/export?kind=PART" +
      (q ? `&q=${encodeURIComponent(q)}` : "");
    window.open(url, "_blank");
  };

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
  };

  // tạo danh sách số trang
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="page-container">
      <div className="page-subtitle">Tồn kho theo linh kiện</div>

      {/* Thanh tìm kiếm + nút export */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 16,
        }}
      >
        <form
          onSubmit={handleSearchSubmit}
          style={{ display: "flex", gap: 8, alignItems: "center" }}
        >
          <input
            type="text"
            placeholder="Tìm theo mã / tên linh kiện..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              minWidth: 260,
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #d0d7de",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              padding: "6px 14px",
              borderRadius: 4,
              border: "1px solid #1d4ed8",
              backgroundColor: "#1d4ed8",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Tìm
          </button>
        </form>

        <button
          type="button"
          onClick={handleExport}
          style={{
            padding: "6px 14px",
            borderRadius: 4,
            border: "1px solid #2563eb",
            backgroundColor: "#f9fafb",
            color: "#2563eb",
            fontSize: 14,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Xuất Excel tồn linh kiện
        </button>
      </div>

      {/* Thông báo / lỗi */}
      {error && (
        <div
          style={{
            marginBottom: 8,
            color: "#b91c1c",
            fontSize: 14,
          }}
        >
          Lỗi: {error}
        </div>
      )}

      {/* Bảng dữ liệu */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          overflow: "hidden",
          backgroundColor: "#fff",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
          }}
        >
          <thead
            style={{
              backgroundColor: "#f9fafb",
              borderBottom: "1px solid #e5e7eb",
            }}
          >
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRight: "1px solid #e5e7eb",
                  width: 160,
                }}
              >
                Mã
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                Tên linh kiện
              </th>
              <th
                style={{
                  textAlign: "center",
                  padding: "8px 10px",
                  borderRight: "1px solid #e5e7eb",
                  width: 80,
                }}
              >
                ĐVT
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "8px 10px",
                  width: 120,
                }}
              >
                Tồn kho
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: 12, textAlign: "center" }}>
                  Đang tải dữ liệu...
                </td>
              </tr>
            ) : pagedRows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 12, textAlign: "center" }}>
                  Không có linh kiện nào thỏa điều kiện.
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.sku}>
                  <td
                    style={{
                      padding: "6px 10px",
                      borderTop: "1px solid #f3f4f6",
                      borderRight: "1px solid #f3f4f6",
                    }}
                  >
                    {row.sku}
                  </td>
                  <td
                    style={{
                      padding: "6px 10px",
                      borderTop: "1px solid #f3f4f6",
                      borderRight: "1px solid #f3f4f6",
                    }}
                  >
                    {row.name}
                  </td>
                  <td
                    style={{
                      padding: "6px 10px",
                      borderTop: "1px solid #f3f4f6",
                      borderRight: "1px solid #f3f4f6",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.unit || "pcs"}
                  </td>
                  <td
                    style={{
                      padding: "6px 10px",
                      borderTop: "1px solid #f3f4f6",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.totalQty.toLocaleString("vi-VN")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Thông tin trang + phân trang */}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 13,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          Trang {page}/{totalPages} – Tổng {totalItems} linh kiện
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              backgroundColor: page <= 1 ? "#f9fafb" : "#ffffff",
              color: "#374151",
              cursor: page <= 1 ? "default" : "pointer",
            }}
          >
            Trước
          </button>

          {pageNumbers.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => goToPage(p)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
                backgroundColor: p === page ? "#1d4ed8" : "#ffffff",
                color: p === page ? "#ffffff" : "#374151",
                cursor: "pointer",
                minWidth: 32,
              }}
            >
              {p}
            </button>
          ))}

          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              backgroundColor: page >= totalPages ? "#f9fafb" : "#ffffff",
              color: "#374151",
              cursor: page >= totalPages ? "default" : "pointer",
            }}
          >
            Sau
          </button>
        </div>
      </div>
    </div>
  );
};

export default PartStocksPage;
