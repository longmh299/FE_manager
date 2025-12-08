// src/pages/MachineStocksPage.tsx
import React, { useEffect, useRef, useState } from "react";
import api, { extractList, getApiBaseUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";

type MachineStockRow = {
  sku: string;
  name: string;
  unit: string;
  totalQty: number;
};

type ToastState = {
  type: "success" | "error";
  message: string;
} | null;

const PAGE_SIZE = 30;

const MachineStocksPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [rows, setRows] = useState<MachineStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState(""); // từ khóa đang áp dụng cho API

  const [page, setPage] = useState(1);

  // ref để kéo lên đầu khi đổi trang
  const containerRef = useRef<HTMLDivElement | null>(null);

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const [toast, setToast] = useState<ToastState>(null);

  // state tạo nhanh máy
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("pcs");
  const [creating, setCreating] = useState(false);

  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  // Load data từ API, chỉ lấy kind=MACHINE, sort theo tồn kho giảm dần
  async function fetchStocks(keyword: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/stocks/summary-by-item", {
        params: {
          kind: "MACHINE",
          // để chắc chắn lấy hết máy (khoảng 300), cho pageSize lớn
          page: 1,
          pageSize: 1000,
          q: keyword.trim() || undefined,
        },
      });

      const list = extractList<any>(res.data) || [];

      const mapped: MachineStockRow[] = list.map((r: any) => ({
        sku: r.sku ?? "",
        name: r.name ?? "",
        unit: r.unit ?? "",
        totalQty: Number(r.totalQty ?? 0),
      }));

      // Sắp xếp tồn kho từ lớn xuống nhỏ
      mapped.sort((a, b) => b.totalQty - a.totalQty);

      setRows(mapped);
      setPage(1);
      scrollToTop();
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStocks(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQ(searchText);
  };

  const handleExport = () => {
    const base = getApiBaseUrl();
    const url =
      base +
      "/api/stocks/summary-by-item/export?kind=MACHINE" +
      (q ? `&q=${encodeURIComponent(q)}` : "");
    window.open(url, "_blank");
  };

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
    scrollToTop();
  };

  // tạo danh sách số trang (ít máy nên thường < 10)
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  // ✅ tạo nhanh máy (chỉ admin mới có UI)
  const handleCreateMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    if (!newName.trim()) {
      showToast("error", "Vui lòng nhập TÊN máy.");
      return;
    }

    try {
      setCreating(true);

      const payload: any = {
        sku: newSku.trim() || undefined,
        name: newName.trim(),
        unit: newUnit.trim() || "pcs",
        kind: "MACHINE", // gắn loại máy
      };

      await api.post("/items", payload);

      showToast("success", "Đã tạo máy mới.");

      setNewSku("");
      setNewName("");
      setNewUnit("pcs");

      // reload danh sách tồn máy
      fetchStocks(q);
    } catch (err: any) {
      console.error("create machine error", err);
      const msg =
        err?.response?.data?.message ||
        "Tạo máy mới thất bại, vui lòng kiểm tra log.";
      showToast("error", msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page-container" ref={containerRef}>
      <div className="page-subtitle">Tồn kho theo máy</div>

      {/* Toast thông báo */}
      {toast && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid",
            backgroundColor:
              toast.type === "success" ? "#ecfdf3" : "#fef2f2",
            borderColor:
              toast.type === "success" ? "#4ade80" : "#fecaca",
            color: toast.type === "success" ? "#166534" : "#b91c1c",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              textTransform: "uppercase",
              fontSize: 11,
            }}
          >
            {toast.type === "success" ? "THÀNH CÔNG" : "LỖI"}
          </span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* ✅ Block tạo mới máy nhanh – chỉ Admin thấy */}
      {isAdmin && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 6,
            border: "1px dashed #d1d5db",
            backgroundColor: "#f9fafb",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>Tạo mới máy nhanh</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              (Chỉ dành cho Admin)
            </span>
          </div>

          <form
            onSubmit={handleCreateMachine}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "flex-end",
            }}
          >
            <div style={{ minWidth: 140, flex: "0 0 auto" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                Mã máy
              </label>
              <input
                type="text"
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                placeholder="VD: DZ-500"
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: "1px solid #d0d7de",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ minWidth: 220, flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                Tên máy *
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nhập tên máy..."
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: "1px solid #d0d7de",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ minWidth: 80, flex: "0 0 auto" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                ĐVT
              </label>
              <input
                type="text"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                placeholder="pcs"
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: "1px solid #d0d7de",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ flex: "0 0 auto" }}>
              <button
                type="submit"
                disabled={creating}
                style={{
                  padding: "8px 16px",
                  borderRadius: 4,
                  border: "1px solid #16a34a",
                  backgroundColor: creating ? "#bbf7d0" : "#16a34a",
                  color: "#fff",
                  fontSize: 13,
                  cursor: creating ? "default" : "pointer",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                {creating ? "Đang tạo..." : "Tạo máy"}
              </button>
            </div>
          </form>
        </div>
      )}

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
            placeholder="Tìm theo mã / tên máy..."
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
          Xuất Excel tồn máy
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
                Tên máy
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
                  Không có dòng máy nào thỏa điều kiện.
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
          Trang {page}/{totalPages} – Tổng {totalItems} dòng máy
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

export default MachineStocksPage;
