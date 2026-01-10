// src/pages/StockCountListPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { extractList } from "../api/client";

type Location = {
  id: string;
  code: string;
  name: string;
};

type StockCount = {
  id: string;
  refNo: string | null;
  note: string | null;
  status: "draft" | "posted" | string;
  locationId: string;
  location?: Location;
  createdAt: string;
  updatedAt: string;
};

const PAGE_SIZE = 20;

function getApiErrorMessage(err: any, fallback: string) {
  return err?.response?.data?.message || err?.message || fallback;
}

function isPeriodLockMessage(msg: string) {
  const s = String(msg || "").toLowerCase();
  return (
    (s.includes("kỳ sổ") && s.includes("khoá")) ||
    s.includes("kỳ đã khoá") ||
    s.includes("thuộc kỳ đã khoá")
  );
}

const StockCountListPage: React.FC = () => {
  const navigate = useNavigate();

  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string>("");

  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [page, setPage] = useState<number>(1);

  const [rows, setRows] = useState<StockCount[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  // form tạo phiếu kiểm kê
  const [newRefNo, setNewRefNo] = useState<string>("");
  const [includeZero, setIncludeZero] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);

  // ✅ period lock banner (session-level)
  const [createLocked, setCreateLocked] = useState<boolean>(false);
  const [createLockedMsg, setCreateLockedMsg] = useState<string>("");

  // ---- Load danh sách kho ----
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const res = await api.get("/locations", {
          params: { page: 1, pageSize: 1000 },
        });
        const list = extractList(res.data) as Location[];
        setLocations(list);
        if (!locationId && list.length) {
          setLocationId(list[0].id);
        }
      } catch (err) {
        console.error("Failed to load locations", err);
      }
    };
    fetchLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Load danh sách phiếu kiểm kê ----
  useEffect(() => {
    const fetchStockCounts = async () => {
      setLoading(true);
      try {
        const res = await api.get("/stock-counts", {
          params: {
            locationId: locationId || undefined,
            status: status || undefined,
            q: q || undefined,
            page,
            pageSize: PAGE_SIZE,
          },
        });

        setRows(res.data.rows || []);
        setTotal(res.data.total || 0);
      } catch (err) {
        console.error("Failed to load stock counts", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStockCounts();
  }, [locationId, status, q, page]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [total]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId) {
      alert("Vui lòng chọn kho để tạo phiếu kiểm kê.");
      return;
    }
    if (createLocked) {
      alert(createLockedMsg || "Kỳ sổ đã khoá, không thể tạo phiếu kiểm kê.");
      return;
    }

    try {
      setCreating(true);
      const res = await api.post("/stock-counts", {
        locationId,
        refNo: newRefNo || undefined,
        includeZero,
      });
      const sc: StockCount = res.data.data;
      if (sc?.id) {
        navigate(`/stock-counts/${sc.id}`);
      } else {
        alert("Tạo phiếu kiểm kê thành công nhưng không nhận được ID.");
      }
    } catch (err: any) {
      console.error("Failed to create stock count", err);
      const msg = getApiErrorMessage(err, "Tạo phiếu kiểm kê thất bại");
      if (isPeriodLockMessage(msg)) {
        setCreateLocked(true);
        setCreateLockedMsg(msg);
      }
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const renderStatusBadge = (s: string) => {
    const base: React.CSSProperties = {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 500,
    };
    if (s === "posted") {
      return (
        <span
          style={{
            ...base,
            backgroundColor: "#e6ffed",
            color: "#007f3b",
            border: "1px solid #9ae6b4",
          }}
        >
          Posted
        </span>
      );
    }
    return (
      <span
        style={{
          ...base,
          backgroundColor: "#fff8e1",
          color: "#b7791f",
          border: "1px solid #fbd38d",
        }}
      >
        Draft
      </span>
    );
  };

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 12 }}>Kiểm tồn kho (Stock Count)</h2>

      {/* ✅ Period lock banner (create) */}
      {createLocked && (
        <div
          style={{
            border: "1px solid #fed7d7",
            backgroundColor: "#fff5f5",
            color: "#c53030",
            borderRadius: 6,
            padding: "10px 12px",
            marginBottom: 16,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⛔ Kỳ sổ đã khoá — không thể tạo phiếu kiểm kê mới
          </div>
          <div>{createLockedMsg || "Bạn chỉ có thể xem danh sách phiếu."}</div>
        </div>
      )}

      {/* Filter & Search */}
      <form
        onSubmit={handleSearchSubmit}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
          alignItems: "flex-end",
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
            Kho
          </label>
          <select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 200, padding: 6 }}
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.code} - {loc.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
            Trạng thái
          </label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 140, padding: 6 }}
          >
            <option value="">Tất cả</option>
            <option value="draft">Draft</option>
            <option value="posted">Posted</option>
          </select>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
            Tìm theo mã phiếu / ghi chú
          </label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nhập refNo hoặc note..."
            style={{ width: "100%", padding: 6 }}
          />
        </div>

        <button
          type="submit"
          style={{
            padding: "6px 12px",
            borderRadius: 4,
            border: "1px solid #3182ce",
            backgroundColor: "#3182ce",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Lọc
        </button>
      </form>

      {/* Form tạo phiếu kiểm kê */}
      <form
        onSubmit={handleCreate}
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: 12,
          marginBottom: 20,
          backgroundColor: "#f7fafc",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
              Mã phiếu kiểm kê (tùy chọn)
            </label>
            <input
              type="text"
              value={newRefNo}
              onChange={(e) => setNewRefNo(e.target.value)}
              placeholder="VD: KK-11-2025"
              style={{ minWidth: 200, padding: 6 }}
              disabled={createLocked}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="includeZero"
              type="checkbox"
              checked={includeZero}
              onChange={(e) => setIncludeZero(e.target.checked)}
              disabled={createLocked}
            />
            <label htmlFor="includeZero" style={{ fontSize: 13 }}>
              Bao gồm cả hàng tồn = 0
            </label>
          </div>

          <button
            type="submit"
            disabled={creating || !locationId || createLocked}
            style={{
              padding: "6px 12px",
              borderRadius: 4,
              border: "1px solid #2f855a",
              backgroundColor:
                creating || createLocked ? "#9ae6b4" : "#38a169",
              color: "#fff",
              cursor: creating || createLocked ? "default" : "pointer",
              minWidth: 160,
            }}
            title={
              createLocked
                ? (createLockedMsg || "Kỳ sổ đã khoá")
                : ""
            }
          >
            {creating ? "Đang tạo..." : "Tạo phiếu kiểm kê"}
          </button>
        </div>
      </form>

      {/* Table */}
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ backgroundColor: "#f7fafc" }}>
            <tr>
              <th style={thStyle}>Mã phiếu</th>
              <th style={thStyle}>Kho</th>
              <th style={thStyle}>Trạng thái</th>
              <th style={thStyle}>Ghi chú</th>
              <th style={thStyle}>Tạo lúc</th>
              <th style={thStyle}>#</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ padding: 12, textAlign: "center" }}>
                  Đang tải...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 12, textAlign: "center" }}>
                  Không có phiếu kiểm kê nào.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #edf2f7" }}>
                  <td style={tdStyle}>{row.refNo || row.id}</td>
                  <td style={tdStyle}>
                    {row.location
                      ? `${row.location.code} - ${row.location.name}`
                      : row.locationId}
                  </td>
                  <td style={tdStyle}>{renderStatusBadge(row.status)}</td>
                  <td style={tdStyle}>{row.note || ""}</td>
                  <td style={tdStyle}>
                    {new Date(row.createdAt).toLocaleString("vi-VN")}
                  </td>
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => navigate(`/stock-counts/${row.id}`)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        border: "1px solid #3182ce",
                        backgroundColor: "#fff",
                        color: "#3182ce",
                        cursor: "pointer",
                      }}
                    >
                      Xem / Sửa
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 8,
        }}
      >
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          style={pageBtnStyle(page <= 1)}
        >
          Trước
        </button>
        <span style={{ fontSize: 13 }}>
          Trang {page}/{totalPages} ({total} phiếu)
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          style={pageBtnStyle(page >= totalPages)}
        >
          Sau
        </button>
      </div>
    </div>
  );
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: "1px solid #e2e8f0",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
};

const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid #cbd5e0",
  backgroundColor: disabled ? "#edf2f7" : "#fff",
  color: disabled ? "#a0aec0" : "#2d3748",
  cursor: disabled ? "default" : "pointer",
});

export default StockCountListPage;
