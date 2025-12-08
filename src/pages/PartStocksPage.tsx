// src/pages/PartStocksPage.tsx
import React, { useEffect, useRef, useState } from "react";
import api, { extractList, getApiBaseUrl } from "../api/client";
// 👇 nhớ chỉnh import này cho đúng đường dẫn hook auth của anh
import { useAuth } from "../context/AuthContext";

type PartStockRow = {
  sku: string;
  name: string;
  unit: string;
  totalQty: number;
  sellPrice: number | null; // 🔹 thêm giá bán
};

type ToastState = {
  type: "success" | "error";
  message: string;
} | null;

const PAGE_SIZE = 30;

const PartStocksPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [rows, setRows] = useState<PartStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState(""); // từ khóa đang áp dụng cho API

  const [page, setPage] = useState(1);

  // ✅ state cho tạo nhanh linh kiện
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("pcs");
  const [newSellPrice, setNewSellPrice] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const [toast, setToast] = useState<ToastState>(null);

  // ref để scroll về đầu trang khi đổi page
  const containerRef = useRef<HTMLDivElement | null>(null);

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  // --- helper: hiển thị toast, auto ẩn ---
  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  // Load data từ API, chỉ lấy kind=PART, sort theo tồn kho giảm dần
  async function fetchStocks(keyword: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/stocks/summary-by-item", {
        params: {
          kind: "PART", // 🔹 chỉ lấy linh kiện
          page: 1,
          pageSize: 2000, // linh kiện thường nhiều hơn máy, để rộng ra
          q: keyword.trim() || undefined,
        },
      });

      const list = extractList<any>(res.data) || [];

      const mapped: PartStockRow[] = list.map((r: any) => ({
        sku: r.sku ?? "",
        name: r.name ?? "",
        unit: r.unit ?? "",
        totalQty: Number(r.totalQty ?? 0),
        sellPrice:
          r.sellPrice === null || r.sellPrice === undefined
            ? null
            : Number(r.sellPrice),
      }));

      // Sắp xếp tồn kho từ lớn xuống nhỏ
      mapped.sort((a, b) => b.totalQty - a.totalQty);

      setRows(mapped);
      setPage(1);
      // sau khi filter lại cũng đẩy lên đầu danh sách
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
      "/api/stocks/summary-by-item/export?kind=PART" +
      (q ? `&q=${encodeURIComponent(q)}` : "");
    window.open(url, "_blank");
  };

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
    scrollToTop();
  };

  // tạo danh sách số trang
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  // ✅ tạo nhanh linh kiện mới (chỉ admin mới chạy được vì UI chỉ hiện cho admin)
  const handleCreatePart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return; // safety

    if (!newName.trim()) {
      showToast("error", "Vui lòng nhập TÊN linh kiện.");
      return;
    }

    const sellPriceNumber =
      newSellPrice.trim() === "" ? null : Number(newSellPrice.replace(/,/g, ""));

    if (sellPriceNumber !== null && Number.isNaN(sellPriceNumber)) {
      showToast("error", "Giá bán không hợp lệ.");
      return;
    }

    try {
      setCreating(true);

      const payload: any = {
        sku: newSku.trim() || undefined,
        name: newName.trim(),
        unit: newUnit.trim() || "pcs",
        sellPrice: sellPriceNumber ?? undefined,
        kind: "PART", // ✅ gợi ý cho BE: tạo item loại linh kiện
      };

      await api.post("/items", payload);

      showToast("success", "Đã tạo linh kiện mới.");

      // reset form
      setNewSku("");
      setNewName("");
      setNewUnit("pcs");
      setNewSellPrice("");

      // reload tồn linh kiện
      fetchStocks(q);
    } catch (err: any) {
      console.error("create part error", err);
      const msg =
        err?.response?.data?.message ||
        "Tạo linh kiện thất bại, vui lòng kiểm tra log.";
      showToast("error", msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page-container" ref={containerRef}>
      <div className="page-subtitle">Tồn kho theo linh kiện</div>

      {/* ✅ Toast thông báo đẹp */}
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

      {/* ✅ Block tạo mới linh kiện nhanh – chỉ admin thấy */}
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
            <span>Tạo mới linh kiện nhanh</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              (Chỉ dành cho Admin)
            </span>
          </div>

          <form
            onSubmit={handleCreatePart}
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
                Mã linh kiện
              </label>
              <input
                type="text"
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                placeholder="VD: KP-001"
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
                Tên linh kiện *
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nhập tên linh kiện..."
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

            <div style={{ minWidth: 140, flex: "0 0 auto" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 500,
                  marginBottom: 4,
                }}
              >
                Giá bán (VND)
              </label>
              <input
                type="number"
                min={0}
                value={newSellPrice}
                onChange={(e) => setNewSellPrice(e.target.value)}
                placeholder="VD: 150000"
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: "1px solid #d0d7de",
                  fontSize: 13,
                  textAlign: "right",
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
                {creating ? "Đang tạo..." : "Tạo linh kiện"}
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
                  borderRight: "1px solid #e5e7eb",
                  width: 120,
                }}
              >
                Giá bán
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
                <td colSpan={5} style={{ padding: 12, textAlign: "center" }}>
                  Đang tải dữ liệu...
                </td>
              </tr>
            ) : pagedRows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 12, textAlign: "center" }}>
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
                      borderRight: "1px solid #f3f4f6",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.sellPrice !== null
                      ? row.sellPrice.toLocaleString("vi-VN")
                      : "-"}
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
