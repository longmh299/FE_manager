// src/pages/StockCountListPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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

/** =========================
 *  Simple Modal Helpers
 *  ========================= */
type AlertModalState =
  | null
  | {
      open: true;
      title?: string;
      message: string;
    };

type ConfirmModalState =
  | null
  | {
      open: true;
      title?: string;
      message: string;
      confirmText?: string;
      cancelText?: string;
      tone?: "primary" | "danger";
    };

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

  // ✅ custom dialogs
  const [alertModal, setAlertModal] = useState<AlertModalState>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>(null);
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);

  const showAlert = (message: string, title = "Thông báo") => {
    setAlertModal({ open: true, title, message });
  };

  const confirmDialog = (opts: Omit<NonNullable<ConfirmModalState>, "open">) => {
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmModal({ open: true, ...opts });
    });
  };

  const closeConfirm = (result: boolean) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmModal(null);
    resolve?.(result);
  };

  // đóng modal bằng ESC
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (confirmModal?.open) closeConfirm(false);
      if (alertModal?.open) setAlertModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmModal?.open, alertModal?.open]);

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
      showAlert("Vui lòng chọn kho để tạo phiếu kiểm kê.");
      return;
    }
    if (createLocked) {
      showAlert(createLockedMsg || "Kỳ sổ đã khoá, không thể tạo phiếu kiểm kê.");
      return;
    }

    const loc = locations.find((x) => x.id === locationId);
    const refNoText = String(newRefNo || "").trim();

    const ok = await confirmDialog({
      title: "Xác nhận tạo phiếu kiểm kê",
      message:
        `Bạn chắc chắn muốn tạo phiếu kiểm kê?\n\n` +
        `Kho: ${loc ? `${loc.code} - ${loc.name}` : locationId}\n` +
        `Mã phiếu: ${refNoText ? refNoText : "(tự sinh / để trống)"}\n` +
        `Bao gồm tồn = 0: ${includeZero ? "Có" : "Không"}`,
      confirmText: "Tạo phiếu",
      cancelText: "Hủy",
      tone: "primary",
    });

    if (!ok) return;

    try {
      setCreating(true);
      const res = await api.post("/stock-counts", {
        locationId,
        refNo: refNoText || undefined,
        includeZero,
      });
      const sc: StockCount = res.data.data;
      if (sc?.id) {
        navigate(`/stock-counts/${sc.id}`);
      } else {
        showAlert("Tạo phiếu kiểm kê thành công nhưng không nhận được ID.", "Lỗi");
      }
    } catch (err: any) {
      console.error("Failed to create stock count", err);
      const msg = getApiErrorMessage(err, "Tạo phiếu kiểm kê thất bại");
      if (isPeriodLockMessage(msg)) {
        setCreateLocked(true);
        setCreateLockedMsg(msg);
      }
      showAlert(msg, "Lỗi");
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
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Kho</label>
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
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Trạng thái</label>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
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
              backgroundColor: creating || createLocked ? "#9ae6b4" : "#38a169",
              color: "#fff",
              cursor: creating || createLocked ? "default" : "pointer",
              minWidth: 160,
            }}
            title={createLocked ? createLockedMsg || "Kỳ sổ đã khoá" : ""}
          >
            {creating ? "Đang tạo..." : "Tạo phiếu kiểm kê"}
          </button>
        </div>
      </form>

      {/* Table */}
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
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
                    {row.location ? `${row.location.code} - ${row.location.name}` : row.locationId}
                  </td>
                  <td style={tdStyle}>{renderStatusBadge(row.status)}</td>
                  <td style={tdStyle}>{row.note || ""}</td>
                  <td style={tdStyle}>{new Date(row.createdAt).toLocaleString("vi-VN")}</td>
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

      {/* ========================= ALERT MODAL ========================= */}
      {alertModal?.open && (
        <ModalShell
          onClose={() => setAlertModal(null)}
          title={alertModal.title || "Thông báo"}
          footer={
            <button
              type="button"
              onClick={() => setAlertModal(null)}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #e5e7eb",
                backgroundColor: "#fff",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Đóng
            </button>
          }
        >
          <div style={{ whiteSpace: "pre-line", fontSize: 14, color: "#111827", lineHeight: 1.5 }}>
            {alertModal.message}
          </div>
        </ModalShell>
      )}

      {/* ========================= CONFIRM MODAL ========================= */}
      {confirmModal?.open && (
        <ModalShell
          onClose={() => closeConfirm(false)}
          title={confirmModal.title || "Xác nhận"}
          footer={
            <>
              <button
                type="button"
                onClick={() => closeConfirm(false)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                {confirmModal.cancelText || "Hủy"}
              </button>

              <button
                type="button"
                onClick={() => closeConfirm(true)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid",
                  borderColor: confirmModal.tone === "danger" ? "#dc2626" : "#16a34a",
                  backgroundColor: confirmModal.tone === "danger" ? "#dc2626" : "#16a34a",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                {confirmModal.confirmText || "OK"}
              </button>
            </>
          }
        >
          <div style={{ whiteSpace: "pre-line", fontSize: 14, color: "#111827", lineHeight: 1.55 }}>
            {confirmModal.message}
          </div>
        </ModalShell>
      )}
    </div>
  );
};

const ModalShell: React.FC<{
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}> = ({ title, children, footer, onClose }) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(520px, 96vw)",
          maxHeight: "90vh",
          backgroundColor: "#fff",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              backgroundColor: "#fff",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 14, overflow: "auto", flex: 1 }}>{children}</div>

        <div
          style={{
            padding: 12,
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            backgroundColor: "#fff",
          }}
        >
          {footer}
        </div>
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
