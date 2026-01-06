// src/pages/StockCountDetailPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";

type Location = {
  id: string;
  code: string;
  name: string;
};

type Item = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  kind?: "PART" | "MACHINE" | string;
};

type StockCountLine = {
  id: string;
  itemId: string;
  countedQty: string;
  bookQty?: string;
  diff?: string;
  item?: Item;
};

type StockCountDetail = {
  id: string;
  refNo: string | null;
  note: string | null;
  status: "draft" | "posted" | string;
  locationId: string;
  location?: Location;
  createdAt: string;
  updatedAt: string;
  lines: StockCountLine[];
};

type TabKind = "PART" | "MACHINE";

function getApiErrorMessage(err: any, fallback: string) {
  return err?.response?.data?.message || err?.message || fallback;
}

function isPeriodLockMessage(msg: string) {
  const s = String(msg || "").toLowerCase();
  // match các message BE bạn đang dùng
  return (
    (s.includes("kỳ sổ") && s.includes("khoá")) ||
    s.includes("kỳ đã khoá") ||
    s.includes("thuộc kỳ đã khoá")
  );
}

/** ========================= Confirm Modal (no browser confirm) ========================= */
type ConfirmTone = "primary" | "danger";
type ConfirmConfig = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
};

const StockCountDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<StockCountDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [posting, setPosting] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  // ✅ lock state (BE period lock)
  const [locked, setLocked] = useState<boolean>(false);
  const [lockedMsg, setLockedMsg] = useState<string>("");

  // giá trị đang gõ trên input, key = lineId
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});

  // tab hiện tại: Linh kiện (PART) / Máy (MACHINE)
  const [activeTab, setActiveTab] = useState<TabKind>("PART");

  // ✅ custom confirm modal (replace window.confirm)
  const [confirmModal, setConfirmModal] = useState<ConfirmConfig | null>(null);
  const confirmResolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirmDialog = (cfg: ConfirmConfig) => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmModal(cfg);
    });
  };

  const closeConfirm = (result: boolean) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmModal(null);
    resolve?.(result);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!confirmModal) return;
      if (ev.key === "Escape") closeConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmModal]);

  const loadDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/stock-counts/${id}`);
      const detail: StockCountDetail = res.data.data;
      setData(detail);

      // reset lock banner mỗi lần reload (nếu vẫn bị lock thì sẽ bật lại khi thao tác)
      setLocked(false);
      setLockedMsg("");

      const init: Record<string, string> = {};
      (detail.lines || []).forEach((l) => {
        init[l.id] = (l.countedQty as any)?.toString?.() ?? l.countedQty ?? "0";
      });
      setEditingValues(init);
    } catch (err) {
      console.error("Failed to load stock count detail", err);
      alert("Không tải được phiếu kiểm kê.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const parseNumber = (v: string | undefined | null): number => {
    if (v == null || v === "") return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  const isPosted = data?.status === "posted";
  const isReadOnly = isPosted || locked;

  const visibleLines = data?.lines.filter((l) => l.item?.kind === activeTab) ?? [];

  const totals = useMemo(() => {
    const lines = visibleLines || [];
    let book = 0;
    let counted = 0;
    let diff = 0;
    for (const l of lines) {
      const b = parseNumber(l.bookQty ?? "0");
      const c = parseNumber(
        (editingValues[l.id] ??
          (l.countedQty as any)?.toString?.() ??
          l.countedQty ??
          "0") as string
      );
      book += b;
      counted += c;
      diff += c - b;
    }
    return { book, counted, diff };
  }, [visibleLines, editingValues]);

  const applyPeriodLockIfNeeded = (msg: string) => {
    if (isPeriodLockMessage(msg)) {
      setLocked(true);
      setLockedMsg(msg);
    }
  };

  const handleUpdateCountedQty = async (line: StockCountLine) => {
    if (!id || !data) return;
    if (isReadOnly) return;

    const value =
      editingValues[line.id] ?? (line.countedQty as any)?.toString?.() ?? "0";

    try {
      setSavingLineId(line.id);
      await api.put(`/stock-counts/lines/${line.id}`, {
        countedQty: value || "0",
      });

      // Cập nhật local state cho dòng đó, không reload toàn phiếu
      setData((prev) => {
        if (!prev) return prev;
        const newLines = prev.lines.map((l) => {
          if (l.id !== line.id) return l;
          const newCounted = value || "0";
          const book = parseNumber(l.bookQty ?? "0");
          const counted = parseNumber(newCounted);
          const diff = counted - book;
          return {
            ...l,
            countedQty: newCounted,
            diff: diff.toString(),
          };
        });
        return { ...prev, lines: newLines };
      });
    } catch (err: any) {
      console.error("Failed to update countedQty", err);
      const msg = getApiErrorMessage(err, "Cập nhật số thực đếm thất bại");
      applyPeriodLockIfNeeded(msg);
      alert(msg);
    } finally {
      setSavingLineId(null);
    }
  };

  const handlePost = async () => {
    if (!id || !data) return;
    if (isPosted) {
      alert("Phiếu kiểm kê đã được post.");
      return;
    }
    if (locked) {
      alert(lockedMsg || "Phiếu thuộc kỳ đã khoá, không thể post.");
      return;
    }

    const ok = await confirmDialog({
      title: "Xác nhận Post kiểm kê",
      message: "Post kiểm kê sẽ điều chỉnh tồn kho theo số thực đếm.\nBạn chắc chắn muốn thực hiện?",
      confirmText: "Post kiểm kê",
      cancelText: "Hủy",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setPosting(true);
      await api.post(`/stock-counts/${id}/post`, {});
      await loadDetail();
      alert("Đã post kiểm kê và điều chỉnh tồn kho.");
    } catch (err: any) {
      console.error("Failed to post stock count", err);
      const msg = getApiErrorMessage(err, "Post kiểm kê thất bại");
      applyPeriodLockIfNeeded(msg);
      alert(msg);
    } finally {
      setPosting(false);
    }
  };

  const handleExport = async () => {
    if (!id) return;
    try {
      const res = await api.get(`/stock-counts/${id}/export`, {
        params: { kind: activeTab }, // PART hoặc MACHINE
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        activeTab === "PART"
          ? `stock_count_parts_${id}.xlsx`
          : `stock_count_machines_${id}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Failed to export stock count", err);
      const msg = getApiErrorMessage(err, "Xuất Excel thất bại");
      alert(msg);
    }
  };

  const handleDelete = async () => {
    if (!id || !data) return;
    if (isPosted) {
      alert("Không thể xoá phiếu kiểm kê đã post.");
      return;
    }
    if (locked) {
      alert(lockedMsg || "Phiếu thuộc kỳ đã khoá, không thể xoá.");
      return;
    }

    const ok = await confirmDialog({
      title: "Xác nhận xoá phiếu",
      message: "Bạn chắc chắn muốn xoá phiếu kiểm kê này?\n(Chỉ nên xoá phiếu test/demo)",
      confirmText: "Xoá phiếu",
      cancelText: "Hủy",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setDeleting(true);
      await api.delete(`/stock-counts/${id}`);
      alert("Đã xoá phiếu kiểm kê.");
      navigate("/stock-counts");
    } catch (err: any) {
      console.error("Failed to delete stock count", err);
      const msg = getApiErrorMessage(err, "Xoá phiếu kiểm kê thất bại");
      applyPeriodLockIfNeeded(msg);
      alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  const renderDiff = (diffStr?: string) => {
    if (diffStr == null) return "";
    const diff = Number(diffStr);
    if (Number.isNaN(diff)) return diffStr;
    const style: React.CSSProperties = {
      fontWeight: 500,
    };
    if (diff > 0) {
      style.color = "#38a169";
      return <span style={style}>+{diff}</span>;
    }
    if (diff < 0) {
      style.color = "#e53e3e";
      return <span style={style}>{diff}</span>;
    }
    style.color = "#4a5568";
    return <span style={style}>0</span>;
  };

  if (!id) {
    return <div style={{ padding: 16 }}>Thiếu ID phiếu kiểm kê.</div>;
  }

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          marginBottom: 12,
          padding: "4px 10px",
          borderRadius: 4,
          border: "1px solid #cbd5e0",
          backgroundColor: "#fff",
          cursor: "pointer",
        }}
      >
        ← Quay lại danh sách
      </button>

      {loading && !data && <div>Đang tải phiếu kiểm kê...</div>}

      {!loading && data && (
        <>
          {/* ✅ Period lock banner */}
          {locked && (
            <div
              style={{
                border: "1px solid #fed7d7",
                backgroundColor: "#fff5f5",
                color: "#c53030",
                borderRadius: 6,
                padding: "10px 12px",
                marginBottom: 12,
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                ⛔ Phiếu thuộc kỳ đã khoá
              </div>
              <div>{lockedMsg || "Kỳ sổ đã khoá, không thể sửa / post / xoá."}</div>
            </div>
          )}

          {/* Header info */}
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: 12,
              marginBottom: 16,
              backgroundColor: "#f7fafc",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2 style={{ margin: 0, marginBottom: 4 }}>
                  Phiếu kiểm kê: {data.refNo || data.id}
                </h2>
                <div style={{ fontSize: 13, color: "#4a5568" }}>
                  Kho:{" "}
                  {data.location
                    ? `${data.location.code} - ${data.location.name}`
                    : data.locationId}
                </div>
                {data.note && (
                  <div style={{ fontSize: 13, color: "#4a5568" }}>
                    Ghi chú: {data.note}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#718096", marginTop: 4 }}>
                  Tạo lúc: {new Date(data.createdAt).toLocaleString("vi-VN")} | Cập nhật:{" "}
                  {new Date(data.updatedAt).toLocaleString("vi-VN")}
                </div>

                {/* ✅ mini summary theo tab */}
                <div style={{ fontSize: 12, color: "#4a5568", marginTop: 6 }}>
                  Tổng tab {activeTab === "PART" ? "Linh kiện" : "Máy"} • Tồn sổ:{" "}
                  <b>{totals.book}</b> • Thực đếm: <b>{totals.counted}</b> • Chênh:{" "}
                  <b>{totals.diff > 0 ? `+${totals.diff}` : totals.diff}</b>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ marginBottom: 8 }}>
                  {data.status === "posted" ? (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        backgroundColor: "#e6ffed",
                        color: "#007f3b",
                        border: "1px solid #9ae6b4",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      Posted
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        backgroundColor: "#fff8e1",
                        color: "#b7791f",
                        border: "1px solid #fbd38d",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      Draft
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleExport}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #4a5568",
                      backgroundColor: "#fff",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    Xuất Excel {activeTab === "PART" ? "Linh kiện" : "Máy"}
                  </button>

                  <button
                    type="button"
                    disabled={isReadOnly || posting}
                    onClick={handlePost}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #2f855a",
                      backgroundColor: isReadOnly || posting ? "#9ae6b4" : "#38a169",
                      color: "#fff",
                      cursor: isReadOnly || posting ? "default" : "pointer",
                      fontSize: 13,
                    }}
                    title={
                      locked
                        ? lockedMsg || "Phiếu thuộc kỳ đã khoá"
                        : isPosted
                        ? "Phiếu đã post"
                        : ""
                    }
                  >
                    {posting ? "Đang post..." : "Post kiểm kê"}
                  </button>

                  <button
                    type="button"
                    disabled={isReadOnly || deleting}
                    onClick={handleDelete}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #e53e3e",
                      backgroundColor: isReadOnly || deleting ? "#fed7d7" : "#fff5f5",
                      color: "#e53e3e",
                      cursor: isReadOnly || deleting ? "default" : "pointer",
                      fontSize: 13,
                    }}
                    title={
                      locked
                        ? lockedMsg || "Phiếu thuộc kỳ đã khoá"
                        : isPosted
                        ? "Phiếu đã post"
                        : ""
                    }
                  >
                    {deleting ? "Đang xoá..." : "Xoá phiếu"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs PART / MACHINE */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => setActiveTab("PART")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: activeTab === "PART" ? "1px solid #3182ce" : "1px solid #cbd5e0",
                backgroundColor: activeTab === "PART" ? "#ebf8ff" : "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Linh kiện (PART)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("MACHINE")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border:
                  activeTab === "MACHINE" ? "1px solid #3182ce" : "1px solid #cbd5e0",
                backgroundColor: activeTab === "MACHINE" ? "#ebf8ff" : "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Máy (MACHINE)
            </button>
          </div>

          {/* Table lines */}
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              overflow: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ backgroundColor: "#f7fafc" }}>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Tên hàng</th>
                  <th style={thStyle}>ĐVT</th>
                  <th style={thStyle}>Tồn sổ</th>
                  <th style={thStyle}>Thực đếm</th>
                  <th style={thStyle}>Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {visibleLines.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, textAlign: "center" }}>
                      Không có dòng nào trong tab {activeTab === "PART" ? "Linh kiện" : "Máy"}.
                    </td>
                  </tr>
                )}

                {visibleLines.map((line) => {
                  const inputValue =
                    editingValues[line.id] ?? (line.countedQty as any)?.toString?.() ?? "0";

                  return (
                    <tr key={line.id} style={{ borderTop: "1px solid #edf2f7" }}>
                      <td style={tdStyle}>{line.item?.sku || ""}</td>
                      <td style={tdStyle}>{line.item?.name || ""}</td>
                      <td style={tdStyle}>{line.item?.unit || ""}</td>
                      <td style={tdStyle}>{line.bookQty ?? "0"}</td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          value={inputValue}
                          disabled={isReadOnly}
                          onChange={(e) =>
                            setEditingValues((prev) => ({
                              ...prev,
                              [line.id]: e.target.value,
                            }))
                          }
                          onBlur={() => {
                            if (isReadOnly) return;
                            handleUpdateCountedQty(line);
                          }}
                          style={{
                            width: 100,
                            padding: "2px 4px",
                            borderRadius: 4,
                            border:
                              savingLineId === line.id ? "1px solid #3182ce" : "1px solid #cbd5e0",
                            fontSize: 13,
                            backgroundColor: isReadOnly ? "#f7fafc" : "#fff",
                            color: isReadOnly ? "#718096" : "#111827",
                            cursor: isReadOnly ? "not-allowed" : "text",
                          }}
                          title={
                            locked
                              ? lockedMsg || "Phiếu thuộc kỳ đã khoá"
                              : isPosted
                              ? "Phiếu đã post"
                              : ""
                          }
                        />
                      </td>
                      <td style={tdStyle}>{renderDiff(line.diff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ========================= CUSTOM CONFIRM MODAL ========================= */}
      {confirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeConfirm(false);
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
              width: "min(560px, 96vw)",
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
              <div style={{ fontSize: 15, fontWeight: 900 }}>
                {confirmModal.title || "Xác nhận"}
              </div>

              <button
                type="button"
                onClick={() => closeConfirm(false)}
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

            <div style={{ padding: 14, fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-line" }}>
              {confirmModal.message}
            </div>

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
            </div>
          </div>
        </div>
      )}
      {/* ========================= END CONFIRM MODAL ========================= */}
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
  padding: "6px 10px",
  fontSize: 13,
};

export default StockCountDetailPage;
