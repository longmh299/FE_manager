// src/pages/StockCountDetailPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { appAlert } from "../components/AppDialog";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PinActionDialog } from "../components/SecondPassword"; // ✅ ghi sổ kiểm kê: chỉ quản trị + mật khẩu cấp 2

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
  countedQty: string | null; // null = chưa đếm
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
type CountFilter = "ALL" | "TODO" | "DONE" | "DIFF";

/** tìm không dấu: "bom 3hp" thấy "Bơm thủy lực 3HP"; mã viết liền / có gạch như nhau ("dhz550" thấy "DHZ-550") */
function foldVN(s: string) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}
const compact = (s: string) => foldVN(s).replace(/[^a-z0-9]/g, "");
function lineMatches(line: StockCountLine, q: string) {
  const words = foldVN(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const name = foldVN(line.item?.name || "");
  const sku = foldVN(line.item?.sku || "");
  const all = `${sku} ${name} ${compact(line.item?.sku || "")} ${compact(line.item?.name || "")}`;
  return words.every((w) => all.includes(w) || all.includes(compact(w)));
}

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
  const [pinOpen, setPinOpen] = useState(false);
  const { user: authUser } = useAuth();
  const isAdmin = String(authUser?.role || "") === "admin";
  const [deleting, setDeleting] = useState<boolean>(false);

  // ✅ lock state (BE period lock)
  const [locked, setLocked] = useState<boolean>(false);
  const [lockedMsg, setLockedMsg] = useState<string>("");

  // giá trị đang gõ trên input, key = lineId
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});

  // tab hiện tại: Linh kiện (PART) / Máy móc
  const [activeTab, setActiveTab] = useState<TabKind>("PART");
  // ✅ đếm không theo thứ tự danh sách: tìm mã / tên -> nhập số -> Enter -> tìm tiếp
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<CountFilter>("ALL");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // màn rộng (máy tính / điện thoại xoay ngang) -> bảng; điện thoại dọc -> thẻ. Chỉ vẽ 1 dạng để Enter nhảy đúng ô.
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // màn thấp (điện thoại xoay ngang): thu gọn khung thông tin phiếu để chừa chỗ cho danh sách đếm
  const [short, setShort] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-height: 500px)").matches);
  const [showHead, setShowHead] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-height: 500px)");
    const on = () => setShort(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const headOpen = !short || showHead;

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
        init[l.id] = (l.countedQty as any)?.toString?.() ?? ""; // trống = chưa đếm
      });
      setEditingValues(init);
    } catch (err) {
      console.error("Failed to load stock count detail", err);
      appAlert("Không tải được phiếu kiểm kê. Thử tải lại trang.", { tone: "danger" });
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

  const tabLines = data?.lines.filter((l) => l.item?.kind === activeTab) ?? [];
  const rawOf = (l: StockCountLine) => String(editingValues[l.id] ?? (l.countedQty == null ? "" : String(l.countedQty)));
  const isCounted = (l: StockCountLine) => rawOf(l).trim() !== "";
  const hasDiff = (l: StockCountLine) => isCounted(l) && parseNumber(rawOf(l)) !== parseNumber(l.bookQty ?? "0");
  // đang tìm: tìm trên CẢ máy lẫn linh kiện (đỡ phải nhớ hàng nằm tab nào)
  const searching = q.trim() !== "";
  const visibleLines = (searching ? data?.lines ?? [] : tabLines).filter((l) => {
    if (searching && !lineMatches(l, q)) return false;
    if (filter === "TODO") return !isCounted(l);
    if (filter === "DONE") return isCounted(l);
    if (filter === "DIFF") return hasDiff(l);
    return true;
  });
  const progress = {
    done: tabLines.filter(isCounted).length,
    total: tabLines.length,
    diff: tabLines.filter(hasDiff).length,
  };

  /** nhập xong 1 dòng (Enter): đang tìm -> xoá ô tìm, quay về ô tìm để tìm hàng kế; không tìm -> xuống dòng dưới */
  // ✅ hàng đếm thấy mà phiếu chưa có: tìm trong danh mục hàng để thêm vào phiếu
  const [extra, setExtra] = useState<Array<{ id: string; sku: string; name: string; kind?: string; stockQty?: number; unit?: { name?: string; code?: string } | string }>>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  useEffect(() => {
    const kw = q.trim();
    if (!kw || !data || isReadOnly) {
      setExtra([]);
      return;
    }
    const inPhieu = new Set(data.lines.map((l) => l.itemId));
    let stop = false;
    setExtraLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get("/items", { params: { q: kw, page: 1, pageSize: 15 } });
        const rows = (res?.data?.data || res?.data?.items || []) as typeof extra;
        if (!stop) setExtra(rows.filter((it) => !inPhieu.has(it.id)).slice(0, 8));
      } catch {
        if (!stop) setExtra([]);
      } finally {
        if (!stop) setExtraLoading(false);
      }
    }, 350);
    return () => {
      stop = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, data?.lines.length, isReadOnly]);

  const addToPhieu = async (it: (typeof extra)[number]) => {
    if (!id || !data) return;
    try {
      setAddingId(it.id);
      const res = await api.post(`/stock-counts/${id}/lines`, { itemId: it.id });
      const line: StockCountLine = res.data.data;
      setData((prev) => (prev ? { ...prev, lines: [...prev.lines, line] } : prev));
      setExtra((xs) => xs.filter((x) => x.id !== it.id));
      // tìm đúng mã vừa thêm để nhập số đếm luôn
      setQ(it.sku || it.name);
      setTimeout(() => {
        qtyRefs.current[line.id]?.focus();
      }, 50);
    } catch (err) {
      appAlert(getApiErrorMessage(err, "Không thêm được hàng vào phiếu."), { tone: "danger" });
    } finally {
      setAddingId(null);
    }
  };

  const afterEnter = (lineId: string) => {
    if (searching) {
      setQ("");
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    const idx = visibleLines.findIndex((l) => l.id === lineId);
    const next = visibleLines[idx + 1];
    if (next) requestAnimationFrame(() => qtyRefs.current[next.id]?.focus());
  };

  const totals = useMemo(() => {
    const lines = tabLines || [];
    let book = 0;
    let counted = 0;
    let diff = 0;
    for (const l of lines) {
      const b = parseNumber(l.bookQty ?? "0");
      const raw = (editingValues[l.id] ?? (l.countedQty as any)?.toString?.() ?? "") as string;
      book += b;
      if (raw.trim() === "") continue; // chưa đếm: không tính chênh lệch
      const c = parseNumber(raw);
      counted += c;
      diff += c - b;
    }
    return { book, counted, diff };
  }, [tabLines, editingValues]);

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
      editingValues[line.id] ?? (line.countedQty as any)?.toString?.() ?? "";
    const isBlank = String(value).trim() === "";

    try {
      setSavingLineId(line.id);
      await api.put(`/stock-counts/lines/${line.id}`, {
        countedQty: isBlank ? null : value,
      });

      // Cập nhật local state cho dòng đó, không reload toàn phiếu
      setData((prev) => {
        if (!prev) return prev;
        const newLines = prev.lines.map((l) => {
          if (l.id !== line.id) return l;
          const book = parseNumber(l.bookQty ?? "0");
          const diff = isBlank ? 0 : parseNumber(value) - book;
          return {
            ...l,
            countedQty: isBlank ? null : value,
            diff: diff.toString(),
          };
        });
        return { ...prev, lines: newLines };
      });
    } catch (err: any) {
      console.error("Failed to update countedQty", err);
      const msg = getApiErrorMessage(err, "Cập nhật số thực đếm thất bại");
      applyPeriodLockIfNeeded(msg);
      appAlert(msg, { tone: "danger" });
    } finally {
      setSavingLineId(null);
    }
  };

  const handlePost = async () => {
    if (!isAdmin) {
      appAlert("Chỉ quản trị được ghi sổ kiểm kê. Kế toán nhập xong số đếm thì báo quản trị ghi sổ.", { tone: "warning" });
      return;
    }
    if (!id || !data) return;
    if (isPosted) {
      appAlert("Phiếu kiểm kê này đã ghi sổ rồi.", { tone: "info" });
      return;
    }
    if (locked) {
      appAlert(lockedMsg || "Phiếu thuộc kỳ đã khoá, không ghi sổ được.", { tone: "warning" });
      return;
    }

    setPinOpen(true); // -> hộp nhập mật khẩu cấp 2
  };

  // gọi từ hộp mật khẩu cấp 2; lỗi PIN ném ra để hộp tự xử lý, lỗi khác báo như cũ
  const doPostWithPin = async (pin: string) => {
    try {
      setPosting(true);
      await api.post(`/stock-counts/${id}/post`, { pin });
      setPinOpen(false);
      await loadDetail();
      appAlert("Tồn kho đã được chỉnh theo số đếm thực tế.", { title: "Đã ghi sổ kiểm kê", tone: "success" });
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code && String(code).startsWith("PIN_")) throw err;
      console.error("Failed to post stock count", err);
      const msg = getApiErrorMessage(err, "Ghi sổ kiểm kê thất bại");
      applyPeriodLockIfNeeded(msg);
      setPinOpen(false);
      appAlert(msg, { tone: "danger" });
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
      appAlert(msg, { tone: "danger" });
    }
  };

  const handleDelete = async () => {
    if (!id || !data) return;
    if (isPosted) {
      appAlert("Phiếu đã ghi sổ thì không xoá được.", { tone: "warning" });
      return;
    }
    if (locked) {
      appAlert(lockedMsg || "Phiếu thuộc kỳ đã khoá, không xoá được.", { tone: "warning" });
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
      appAlert("Đã xoá phiếu kiểm kê.", { tone: "success" });
      navigate("/stock-counts");
    } catch (err: any) {
      console.error("Failed to delete stock count", err);
      const msg = getApiErrorMessage(err, "Xoá phiếu kiểm kê thất bại");
      applyPeriodLockIfNeeded(msg);
      appAlert(msg, { tone: "danger" });
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

  // ô nhập số đếm (dùng chung bảng + thẻ). Enter = lưu rồi sang hàng kế / quay về ô tìm
  const renderQtyInput = (line: StockCountLine, width: number | string) => (
    <input
      ref={(el) => {
        qtyRefs.current[line.id] = el;
      }}
      type="number"
      inputMode="decimal"
      enterKeyHint="next"
      value={rawOf(line)}
      placeholder="Chưa đếm"
      disabled={isReadOnly}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setEditingValues((prev) => ({ ...prev, [line.id]: e.target.value }))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur(); // blur -> lưu
          afterEnter(line.id);
        }
      }}
      onBlur={() => {
        if (isReadOnly) return;
        const saved = line.countedQty == null ? "" : String(line.countedQty);
        if (rawOf(line) === saved) return; // không đổi thì không gọi API
        handleUpdateCountedQty(line);
      }}
      style={{
        width,
        padding: "6px 8px",
        borderRadius: 6,
        border: savingLineId === line.id ? "1px solid #3182ce" : "1px solid #cbd5e0",
        fontSize: 16, // >=16px: iPhone không tự phóng to khi bấm vào ô
        backgroundColor: isReadOnly ? "#f7fafc" : "#fff",
        color: isReadOnly ? "#718096" : "#111827",
        cursor: isReadOnly ? "not-allowed" : "text",
      }}
      title={locked ? lockedMsg || "Phiếu thuộc kỳ đã khoá" : isPosted ? "Phiếu đã ghi sổ" : ""}
    />
  );

  const renderQtyCard = (line: StockCountLine) => (
    <div
      key={line.id}
      className={`rounded-lg border p-3 ${isCounted(line) ? "bg-white" : "border-amber-200 bg-amber-50"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{line.item?.sku || "—"}</div>
          <div className="text-sm text-slate-700">{line.item?.name || ""}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {searching ? `${line.item?.kind === "MACHINE" ? "Máy" : "Linh kiện"} · ` : ""}Tồn sổ <b>{line.bookQty ?? 0}</b>
            {line.item?.unit ? ` ${line.item.unit}` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right text-sm">{isCounted(line) ? renderDiff(line.diff) : <span className="text-xs text-amber-700">chưa đếm</span>}</div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-slate-500">Thực đếm</span>
        {renderQtyInput(line, "100%")}
      </div>
    </div>
  );

  if (!id) {
    return <div style={{ padding: 16 }}>Thiếu ID phiếu kiểm kê.</div>;
  }

  return (
    <div style={{ padding: short ? "8px 16px" : 16, maxWidth: 1200, margin: "0 auto" }}>
      {short && data && (
        <div className="mb-2 flex items-center justify-between gap-2 text-sm">
          <button type="button" onClick={() => navigate(-1)} className="rounded border px-2 py-1">
            ←
          </button>
          <div className="min-w-0 flex-1 truncate">
            <b>{data.refNo || data.id}</b>
            <span className="text-slate-500"> · {isPosted ? "Đã ghi sổ" : "Đang đếm"}</span>
          </div>
          <button type="button" onClick={() => setShowHead((v) => !v)} className="shrink-0 rounded border px-2 py-1 text-xs">
            {showHead ? "Ẩn thông tin ▴" : "Thông tin phiếu ▾"}
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          display: short ? "none" : undefined,
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
              <div>{lockedMsg || "Kỳ sổ đã khoá, không sửa / ghi sổ / xoá được."}</div>
            </div>
          )}

          {/* Header info */}
          <div
            style={{
              display: headOpen ? undefined : "none",
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
                      Đã ghi sổ
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
                      Đang đếm
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
                    disabled={isReadOnly || posting || !isAdmin}
                    onClick={handlePost}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #2f855a",
                      backgroundColor: isReadOnly || posting || !isAdmin ? "#9ae6b4" : "#38a169",
                      color: "#fff",
                      cursor: isReadOnly || posting ? "default" : "pointer",
                      fontSize: 13,
                    }}
                    title={
                      locked
                        ? lockedMsg || "Phiếu thuộc kỳ đã khoá"
                        : isPosted
                        ? "Phiếu đã ghi sổ"
                        : ""
                    }
                  >
                    {posting ? "Đang ghi sổ..." : isAdmin ? "Ghi sổ kiểm kê" : "Chờ quản trị ghi sổ"}
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
                        ? "Phiếu đã ghi sổ"
                        : ""
                    }
                  >
                    {deleting ? "Đang xoá..." : "Xoá phiếu"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ✅ Thanh đếm: tab + tìm mã / tên + lọc — dính trên đầu khi cuộn (điện thoại dọc / ngang đều dùng được) */}
          <div className="sticky top-0 z-20 -mx-4 mb-2 border-b bg-white/95 px-4 py-2 backdrop-blur">
            <div className={short ? "flex items-center gap-2" : ""}>
            <div className={`flex items-center gap-2 ${short ? "shrink-0" : "flex-wrap"}`}>
              {(["PART", "MACHINE"] as TabKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setActiveTab(k)}
                  className={`rounded-full border ${short ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"} ${
                    activeTab === k && !searching ? "border-blue-500 bg-blue-50 font-medium text-blue-800" : "border-slate-300 bg-white"
                  }`}
                >
                  {k === "PART" ? "Linh kiện" : "Máy móc"}
                </button>
              ))}
              <span className="text-xs text-slate-500">
                Đã đếm <b className="text-slate-800">{progress.done}</b>/{progress.total}
                {progress.diff ? (
                  <>
                    {" "}· lệch <b className="text-rose-600">{progress.diff}</b>
                  </>
                ) : null}
              </span>
            </div>

            <div className={`flex items-center gap-2 ${short ? "flex-1" : "mt-2"}`}>
              <div className="relative flex-1">
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter: nhảy vào ô số lượng của kết quả đầu tiên
                    if (e.key === "Enter" && visibleLines[0]) {
                      e.preventDefault();
                      qtyRefs.current[visibleLines[0].id]?.focus();
                      qtyRefs.current[visibleLines[0].id]?.select();
                    }
                  }}
                  type="search"
                  inputMode="search"
                  enterKeyHint="go"
                  placeholder="Tìm mã / tên hàng để nhập số đếm (không cần dấu)"
                  className={`w-full rounded-lg border border-slate-300 px-3 text-base ${short ? "py-1" : "py-2"}`}
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ("");
                      searchRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 text-slate-400 hover:text-slate-700"
                    aria-label="Xoá tìm kiếm"
                  >
                    ✕
                  </button>
                )}
              </div>
              {short && (
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as CountFilter)}
                  className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="ALL">Tất cả</option>
                  <option value="TODO">Chưa đếm</option>
                  <option value="DONE">Đã đếm</option>
                  <option value="DIFF">Lệch</option>
                </select>
              )}
            </div>
            </div>

            <div className={`mt-2 flex-wrap gap-1.5 text-xs ${short ? "hidden" : "flex"}`}>
              {(
                [
                  ["ALL", "Tất cả"],
                  ["TODO", "Chưa đếm"],
                  ["DONE", "Đã đếm"],
                  ["DIFF", "Lệch"],
                ] as [CountFilter, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={`rounded-full border px-2.5 py-1 ${filter === k ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {label}
                </button>
              ))}
              {searching && (
                <span className="self-center text-slate-500">
                  {visibleLines.length} kết quả (tìm cả máy lẫn linh kiện)
                </span>
              )}
            </div>
          </div>

          {/* ✅ đang tìm: hàng có trong danh mục nhưng CHƯA có trong phiếu -> thêm vào để đếm */}
          {searching && !isReadOnly && (extra.length > 0 || extraLoading) && (
            <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50 p-2">
              <div className="mb-1 px-1 text-xs font-medium text-sky-900">
                {extraLoading && !extra.length ? "Đang tìm thêm trên hệ thống…" : "Có trên hệ thống nhưng CHƯA có trong phiếu — thêm vào để đếm:"}
              </div>
              {extra.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-sm">
                  <div className="min-w-0">
                    <b>{it.sku}</b> <span className="text-slate-700">· {it.name}</span>
                    <div className="text-xs text-slate-500">
                      {it.kind === "MACHINE" ? "Máy" : "Linh kiện"} · tồn hệ thống {Number(it.stockQty ?? 0).toLocaleString("vi-VN")}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={addingId === it.id}
                    onClick={() => addToPhieu(it)}
                    className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
                  >
                    {addingId === it.id ? "Đang thêm…" : "Thêm vào phiếu"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {visibleLines.length === 0 && (
            <div className="rounded-lg border bg-white p-6 text-center text-sm text-slate-500">
              {searching
                ? `Không thấy hàng nào trong phiếu khớp "${q}".${
                    !isReadOnly && !extra.length && !extraLoading
                      ? " Hệ thống cũng chưa có mã này — tạo mã trước (form thêm mới ở trang Tồn linh kiện / Tồn máy, hoặc nút + Tạo mã hàng ở trang Đối soát tồn) rồi quay lại tìm để Thêm vào phiếu."
                      : ""
                  }`
                : `Không có dòng nào trong tab ${activeTab === "PART" ? "Linh kiện" : "Máy"}.`}
            </div>
          )}

          {/* Điện thoại dọc: dạng thẻ, ô nhập to */}
          {visibleLines.length > 0 && !wide && (
            <div className="space-y-2">
              {visibleLines.map((line) => renderQtyCard(line))}
            </div>
          )}

          {/* Màn rộng / điện thoại xoay ngang: dạng bảng */}
          {visibleLines.length > 0 && wide && (
            <div className="overflow-auto rounded-md border">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ backgroundColor: "#f7fafc" }}>
                  <tr>
                    <th style={thStyle}>Mã hàng</th>
                    <th style={thStyle}>Tên hàng</th>
                    <th style={thStyle}>ĐVT</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Tồn sổ</th>
                    <th style={thStyle}>Thực đếm</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Chênh lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map((line) => (
                    <tr key={line.id} style={{ borderTop: "1px solid #edf2f7", backgroundColor: isCounted(line) ? "#fff" : "#fffbeb" }}>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap", fontWeight: 600 }}>
                        {line.item?.sku || ""}
                        {searching && <div className="text-[11px] font-normal text-slate-400">{line.item?.kind === "MACHINE" ? "Máy" : "Linh kiện"}</div>}
                      </td>
                      <td style={tdStyle}>{line.item?.name || ""}</td>
                      <td style={tdStyle}>{line.item?.unit || ""}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{line.bookQty ?? ""}</td>
                      <td style={tdStyle}>{renderQtyInput(line, 110)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{isCounted(line) ? renderDiff(line.diff) : <span className="text-xs text-amber-700">chưa đếm</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

      <PinActionDialog
        open={pinOpen}
        tone="danger"
        title="Ghi sổ kiểm kê"
        subtitle="Tồn kho được điều chỉnh theo số thực đếm và phiếu không sửa được nữa."
        confirmLabel="Ghi sổ"
        busyLabel="Đang ghi sổ…"
        onClose={() => setPinOpen(false)}
        onSubmit={doPostWithPin}
      />
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