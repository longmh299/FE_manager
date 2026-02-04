// src/pages/MachineStocksPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import api, { extractList } from "../api/client";
import { useAuth } from "../context/AuthContext";

type MachineStockRow = {
  itemId?: string; // ✅ now provided by BE
  sku: string;
  name: string;

  unit?: string; // unitCode (pcs, pair, m...)
  unitName?: string; // unitName (Cái, Cặp, Mét...)
  totalQty: number;

  // ✅ NEW: note của item (từ BE summary-by-item)
  note?: string | null;

  // ✅ admin-only
  avgCost?: number;
  stockValue?: number;
};

type UnitOption = {
  id: string;
  code: string;
  name: string;
  note?: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type EditState =
  | {
      open: true;
      loading: boolean;
      itemId: string; // ✅ must have

      sku: string;
      name: string;
      unitId: string;

      originalSku: string;
      originalName: string;
      originalUnitId: string;
    }
  | { open: false };

// ✅ NEW: inline note editor state per row
type NoteDraft = {
  editing: boolean;
  value: string;
  original: string;
  saving: boolean;
};

// ✅ NEW: view full note modal
type ViewNoteState =
  | { open: true; sku: string; name: string; note: string }
  | { open: false };

const PAGE_SIZE = 30;

function normalizeForMachineSort(name: string) {
  const s = String(name || "").trim();
  const lower = s.toLowerCase();
  if (lower.startsWith("máy ")) return s.slice(4).trim();
  if (lower.startsWith("may ")) return s.slice(4).trim();
  return s;
}

const MachineStocksPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canEditNote = user?.role === "admin" || user?.role === "accountant";

  const [rows, setRows] = useState<MachineStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");

  const [page, setPage] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ✅ NEW: ref cho vùng scroll dọc của table (để đổi trang auto về đầu bảng)
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const [toast, setToast] = useState<ToastState>(null);

  // ===== Units =====
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);

  // ===== Create machine =====
  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnitId, setNewUnitId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // ===== Edit modal =====
  const [edit, setEdit] = useState<EditState>({ open: false });
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // ✅ NEW: note drafts keyed by itemId
  const [noteDrafts, setNoteDrafts] = useState<Record<string, NoteDraft>>({});

  // ✅ NEW: view note
  const [viewNote, setViewNote] = useState<ViewNoteState>({ open: false });

  const unitById = useMemo(() => {
    const m = new Map<string, UnitOption>();
    units.forEach((u) => m.set(u.id, u));
    return m;
  }, [units]);

  const unitIdByCode = useMemo(() => {
    const m = new Map<string, string>();
    units.forEach((u) => m.set(String(u.code || "").trim().toLowerCase(), u.id));
    return m;
  }, [units]);

  const defaultUnitId = useMemo(() => {
    const pcs = units.find((u) => u.code === "pcs");
    return pcs?.id || (units[0]?.id ?? "");
  }, [units]);

  const scrollToTop = () => {
    // ✅ ưu tiên kéo scroll bên trong bảng về đầu (sticky header + table scroll)
    if (tableScrollRef.current) {
      tableScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // fallback cũ
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  async function fetchStocks(keyword: string) {
    setLoading(true);
    setError(null);

    try {
      const res = await api.get("/stocks/summary-by-item", {
        params: {
          kind: "MACHINE",
          page: 1,
          pageSize: 1000,
          q: keyword.trim() || undefined,
        },
      });

      const list = extractList<any>(res.data) || [];

      const mapped: MachineStockRow[] = list.map((r: any) => ({
        itemId: r.itemId ?? undefined,
        sku: r.sku ?? "",
        name: r.name ?? "",
        unit: r.unit ?? "",
        unitName: r.unitName ?? "",
        totalQty: Number(r.totalQty ?? 0),

        // ✅ NEW: note
        note: r.note ?? null,

        avgCost: r.avgCost != null ? Number(r.avgCost) : 0,
        stockValue: r.stockValue != null ? Number(r.stockValue) : 0,
      }));

      mapped.sort((a, b) => {
        const an = normalizeForMachineSort(a.name);
        const bn = normalizeForMachineSort(b.name);
        const c = an.localeCompare(bn, "vi", { sensitivity: "base" });
        if (c !== 0) return c;
        return (a.sku || "").localeCompare(b.sku || "", "vi", { sensitivity: "base" });
      });

      setRows(mapped);
      setPage(1);
      scrollToTop();

      // ✅ reset note drafts theo dữ liệu mới
      const nextDrafts: Record<string, NoteDraft> = {};
      for (const it of mapped) {
        if (!it.itemId) continue;
        const orig = String(it.note ?? "");
        nextDrafts[it.itemId] = {
          editing: false,
          value: orig,
          original: orig,
          saving: false,
        };
      }
      setNoteDrafts(nextDrafts);
    } catch (e: any) {
      console.error(e);
      const msg = e?.response?.data?.message || e?.message || "Lỗi tải dữ liệu";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUnitsIfAdmin() {
    if (!isAdmin) return;
    try {
      setUnitsLoading(true);
      const res = await api.get("/items/units");
      const list = extractList<UnitOption>(res.data) || res.data?.data || [];
      setUnits(list);

      const pcs = list.find((u) => u.code === "pcs");
      setNewUnitId(pcs?.id || list[0]?.id || "");
    } catch (e: any) {
      console.error("fetch units error", e);
      showToast("error", "Không tải được danh sách ĐVT (Unit).");
    } finally {
      setUnitsLoading(false);
    }
  }

  useEffect(() => {
    fetchStocks(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    fetchUnitsIfAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQ(searchText);
  };

  const handleExport = async () => {
    try {
      // gọi qua axios instance (api) để có Authorization header
      const res = await api.get("/stocks/summary-by-item/export", {
        params: { kind: "MACHINE", q: q?.trim() || undefined },
        responseType: "blob",
      });

      // tạo file name gọn gàng
      const suffix = q?.trim() ? `_${q.trim().replace(/\s+/g, "_")}` : "";
      const filename = `ton-kho-may${suffix}.xlsx`;

      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast("success", "Đã xuất Excel tồn máy.");
    } catch (e: any) {
      console.error("export error", e);
      const msg = e?.response?.data?.message || e?.message || "Xuất Excel thất bại.";
      showToast("error", msg);
    }
  };

  const goToPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);

    // ✅ reset ngay lập tức scroll của bảng (tránh cảm giác “kéo mãi vẫn ở giữa”)
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;

    scrollToTop();
  };

  const fmtMoney = (n: number) => Number(n || 0).toLocaleString("vi-VN");
  const fmtQty = (n: number) => Number(n || 0).toLocaleString("vi-VN");

  const renderUnitCell = (row: MachineStockRow) => {
    const vn = String(row.unitName || "").trim();
    if (vn) return vn;
    const code = String(row.unit || "").trim();
    if (code) return code;
    return "pcs";
  };

  // ========= Edit flow =========
  const openEdit = async (row: MachineStockRow) => {
    if (!isAdmin) return;

    if (!row.itemId) {
      showToast("error", "Dòng này thiếu itemId từ BE. Hãy kiểm tra API summary-by-item.");
      return;
    }

    if (units.length === 0 && !unitsLoading) {
      await fetchUnitsIfAdmin();
    }

    const code = String(row.unit || "").trim().toLowerCase();
    const guessedUnitId = (code && unitIdByCode.get(code)) || defaultUnitId;

    setEdit({
      open: true,
      loading: false,
      itemId: row.itemId,

      sku: row.sku || "",
      name: row.name,
      unitId: guessedUnitId,

      originalSku: row.sku || "",
      originalName: row.name,
      originalUnitId: guessedUnitId,
    });

    setTimeout(() => dialogRef.current?.focus(), 50);
  };

  const closeEdit = () => setEdit({ open: false });

  const saveEdit = async () => {
    if (!isAdmin) return;
    if (!edit.open) return;
    if (edit.loading) return;

    const sku = String(edit.sku || "").trim();
    const name = String(edit.name || "").trim();

    if (!name) {
      showToast("error", "Tên máy không được rỗng.");
      return;
    }
    if (!edit.unitId) {
      showToast("error", "Vui lòng chọn ĐVT.");
      return;
    }

    try {
      setEdit({ ...edit, loading: true });

      await api.patch(`/items/${edit.itemId}/master`, {
        sku: sku || undefined,
        name,
        unitId: edit.unitId,
      });

      const u = unitById.get(edit.unitId);
      showToast(
        "success",
        `Đã cập nhật. SKU: ${sku || "(trống)"} – ĐVT: ${u ? `${u.name} (${u.code})` : "OK"}`
      );

      closeEdit();
      fetchStocks(q);
    } catch (e: any) {
      console.error("update item master error", e);
      const msg = e?.response?.data?.message || e?.message || "Cập nhật thất bại.";
      showToast("error", msg);
      setEdit({ ...edit, loading: false });
    }
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!edit.open) return;
      if (ev.key === "Escape") closeEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit.open]);

  const handleCreateMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    if (!newName.trim()) {
      showToast("error", "Vui lòng nhập TÊN máy.");
      return;
    }
    if (!newUnitId) {
      showToast("error", "Vui lòng chọn ĐVT.");
      return;
    }

    try {
      setCreating(true);

      const payload: any = {
        sku: newSku.trim() || undefined,
        name: newName.trim(),
        unitId: newUnitId,
        kind: "MACHINE",
      };

      await api.post("/items", payload);

      showToast("success", "Đã tạo máy mới.");

      setNewSku("");
      setNewName("");
      setNewUnitId(defaultUnitId);

      fetchStocks(q);
    } catch (err: any) {
      console.error("create machine error", err);
      const msg = err?.response?.data?.message || "Tạo máy mới thất bại.";
      showToast("error", msg);
    } finally {
      setCreating(false);
    }
  };

  // ✅ Pagination (mobile gọn, desktop đầy đủ)
  const isMobile =
    typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false;

  const pageNumbers = useMemo(() => {
    if (!totalPages) return [1];
    if (isMobile) return [page]; // mobile: chỉ show trang hiện tại
    return Array.from({ length: totalPages }, (_, i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages, page, isMobile]);

  // ✅ NEW: maxHeight cho vùng table để sticky header hoạt động đúng khi vuốt xuống
  const tableMaxHeight = isMobile ? "70vh" : "72vh";

  // ===== common borders =====
  const B_HDR = "1px solid #e5e7eb";
  const B_ROW = "1px solid #f1f5f9";

  // ✅ NEW: note column width
  const noteColWidth = 260;

  // ✅ style chung cho sticky header cell (UI-only)
  const stickyTh: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 5,
    backgroundColor: "#f9fafb",
    borderBottom: B_HDR,
  };

  // ========================= NOTE INLINE EDIT (Y HỆT LINH KIỆN) =========================

  const ensureDraft = (itemId: string, currentNote: string) => {
    setNoteDrafts((prev) => {
      if (prev[itemId]) return prev;
      return {
        ...prev,
        [itemId]: { editing: false, value: currentNote, original: currentNote, saving: false },
      };
    });
  };

  const startEditNote = (row: MachineStockRow) => {
    if (!canEditNote) return;
    if (!row.itemId) {
      showToast("error", "Dòng này thiếu itemId từ BE. Không thể lưu ghi chú.");
      return;
    }
    const itemId = row.itemId;
    const current = String(row.note ?? "");
    ensureDraft(itemId, current);

    setNoteDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || { editing: false, value: current, original: current, saving: false }),
        editing: true,
        value: prev[itemId]?.value ?? current,
        original: prev[itemId]?.original ?? current,
      },
    }));
  };

  const cancelEditNote = (itemId: string) => {
    setNoteDrafts((prev) => {
      const d = prev[itemId];
      if (!d) return prev;
      return {
        ...prev,
        [itemId]: { ...d, editing: false, value: d.original, saving: false },
      };
    });
  };

  const changeNoteValue = (itemId: string, value: string) => {
    setNoteDrafts((prev) => {
      const d = prev[itemId];
      if (!d) return prev;
      return { ...prev, [itemId]: { ...d, value } };
    });
  };

  const getNoteUi = (row: MachineStockRow) => {
    const itemId = row.itemId;
    if (!itemId) return null;
    return noteDrafts[itemId];
  };

  const saveNote = async (row: MachineStockRow) => {
    if (!canEditNote) return;
    if (!row.itemId) {
      showToast("error", "Dòng này thiếu itemId từ BE. Không thể lưu ghi chú.");
      return;
    }

    const itemId = row.itemId;
    const draft = noteDrafts[itemId];
    const value = (draft?.value ?? String(row.note ?? "")).trim();
    const original = draft?.original ?? String(row.note ?? "");

    if (value === original.trim()) {
      setNoteDrafts((prev) => {
        const d = prev[itemId];
        if (!d) return prev;
        return { ...prev, [itemId]: { ...d, editing: false, saving: false } };
      });
      return;
    }

    try {
      setNoteDrafts((prev) => {
        const d = prev[itemId];
        if (!d) return prev;
        return { ...prev, [itemId]: { ...d, saving: true } };
      });

      await api.put(`/items/${itemId}`, {
        note: value ? value : null,
      });

      setRows((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, note: value || null } : r)));

      setNoteDrafts((prev) => {
        const d = prev[itemId] || { editing: false, value, original, saving: false };
        return {
          ...prev,
          [itemId]: { ...d, editing: false, saving: false, value, original: value },
        };
      });

      showToast("success", "Đã lưu ghi chú.");
    } catch (e: any) {
      console.error("save note error", e);
      const msg = e?.response?.data?.message || e?.message || "Lưu ghi chú thất bại.";
      showToast("error", msg);

      setNoteDrafts((prev) => {
        const d = prev[itemId];
        if (!d) return prev;
        return { ...prev, [itemId]: { ...d, saving: false } };
      });
    }
  };

  const onNoteKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>, row: MachineStockRow) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      saveNote(row);
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (row.itemId) cancelEditNote(row.itemId);
    }
  };

  // ========================= VIEW NOTE MODAL =========================

  const openViewNote = (row: MachineStockRow) => {
    const note = String(row.note ?? "").trim();
    setViewNote({
      open: true,
      sku: String(row.sku ?? ""),
      name: String(row.name ?? ""),
      note,
    });
  };

  const closeViewNote = () => setViewNote({ open: false });

  const copyNote = async () => {
    if (!viewNote.open) return;
    try {
      await navigator.clipboard.writeText(viewNote.note || "");
      showToast("success", "Đã copy ghi chú.");
    } catch {
      showToast("error", "Không copy được (trình duyệt chặn clipboard).");
    }
  };

  return (
    <div className="page-container" ref={containerRef}>
      <div className="page-subtitle">Tồn kho theo máy</div>

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
            backgroundColor: toast.type === "success" ? "#ecfdf3" : "#fef2f2",
            borderColor: toast.type === "success" ? "#4ade80" : "#fecaca",
            color: toast.type === "success" ? "#166534" : "#b91c1c",
          }}
        >
          <span style={{ fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>
            {toast.type === "success" ? "THÀNH CÔNG" : "LỖI"}
          </span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* ✅ Admin create card (responsive) */}
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
              flexWrap: "wrap",
            }}
          >
            <span>Tạo mới máy nhanh</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>(Chỉ dành cho Admin)</span>
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
            <div style={{ minWidth: 180, flex: "1 1 180px" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
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
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>

            <div style={{ minWidth: 220, flex: "2 1 220px" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
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
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>

            <div style={{ minWidth: 180, flex: "1 1 180px" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                ĐVT
              </label>
              <select
                value={newUnitId}
                onChange={(e) => setNewUnitId(e.target.value)}
                disabled={unitsLoading}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  outline: "none",
                  backgroundColor: unitsLoading ? "#f8fafc" : "#fff",
                }}
              >
                {units.length === 0 ? (
                  <option value="">{unitsLoading ? "Đang tải..." : "Chưa có Unit"}</option>
                ) : (
                  units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.code})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div style={{ flex: "0 0 auto" }}>
              <button
                type="submit"
                disabled={creating}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #16a34a",
                  backgroundColor: creating ? "#bbf7d0" : "#16a34a",
                  color: "#fff",
                  fontSize: 13,
                  cursor: creating ? "default" : "pointer",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {creating ? "Đang tạo..." : "Tạo máy"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ✅ Search + Export responsive */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <form
          onSubmit={handleSearchSubmit}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flex: "1 1 320px",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="Tìm theo mã / tên máy..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              flex: "1 1 220px",
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              fontSize: 14,
              outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid #1d4ed8",
              backgroundColor: "#1d4ed8",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontWeight: 600,
            }}
          >
            Tìm
          </button>
        </form>

        <button
          type="button"
          onClick={handleExport}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: "1px solid #2563eb",
            backgroundColor: "#f9fafb",
            color: "#2563eb",
            fontSize: 14,
            cursor: "pointer",
            whiteSpace: "nowrap",
            fontWeight: 600,
            flex: "0 0 auto",
          }}
        >
          Xuất Excel tồn máy
        </button>
      </div>

      {error && <div style={{ marginBottom: 8, color: "#b91c1c", fontSize: 14 }}>Lỗi: {error}</div>}

      {/* ✅ Table wrapper: scroll ngang + scroll dọc + sticky header (y như tồn linh kiện) */}
      <div style={{ border: B_HDR, borderRadius: 8, overflow: "hidden", backgroundColor: "#fff" }}>
        <div
          ref={tableScrollRef}
          style={{
            overflowX: "auto",
            overflowY: "auto",
            maxHeight: tableMaxHeight,
            WebkitOverflowScrolling: "touch",
          }}
        >
          <table
            style={{
              width: "100%",
              minWidth: isAdmin ? 1120 : 880, // có cột note nên rộng hơn
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 14,
            }}
          >
            <thead style={{ backgroundColor: "#f9fafb" }}>
              <tr>
                <th
                  style={{
                    ...stickyTh,
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRight: B_HDR,
                    width: 160,
                    whiteSpace: "nowrap",
                  }}
                >
                  Mã
                </th>

                <th
                  style={{
                    ...stickyTh,
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRight: B_HDR,
                  }}
                >
                  Tên máy
                </th>

                {/* ✅ NEW: Ghi chú */}
                <th
                  style={{
                    ...stickyTh,
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRight: B_HDR,
                    width: noteColWidth,
                  }}
                >
                  Ghi chú
                </th>

                <th
                  style={{
                    ...stickyTh,
                    textAlign: "center",
                    padding: "8px 10px",
                    borderRight: B_HDR,
                    width: 110,
                    whiteSpace: "nowrap",
                  }}
                >
                  ĐVT
                </th>

                <th
                  style={{
                    ...stickyTh,
                    textAlign: "right",
                    padding: "8px 10px",
                    borderRight: B_HDR,
                    width: 120,
                    whiteSpace: "nowrap",
                  }}
                >
                  Tồn kho
                </th>

                {isAdmin && (
                  <>
                    <th
                      style={{
                        ...stickyTh,
                        textAlign: "right",
                        padding: "8px 10px",
                        borderRight: B_HDR,
                        width: 140,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Giá vốn TB
                    </th>
                    <th
                      style={{
                        ...stickyTh,
                        textAlign: "right",
                        padding: "8px 10px",
                        borderRight: B_HDR,
                        width: 160,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Giá trị tồn
                    </th>
                    <th
                      style={{
                        ...stickyTh,
                        zIndex: 6,
                        textAlign: "center",
                        padding: "8px 10px",
                        width: 120,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Cập nhật
                    </th>
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 5} style={{ padding: 12, textAlign: "center" }}>
                    Đang tải dữ liệu...
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 5} style={{ padding: 12, textAlign: "center" }}>
                    Không có dòng máy nào thỏa điều kiện.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const id = row.itemId || "";
                  const draft = id ? getNoteUi(row) : undefined;
                  const noteText = String(row.note ?? "");
                  const isEditing = !!draft?.editing;
                  const isSaving = !!draft?.saving;
                  const val = draft ? draft.value : noteText;
                  const dirty = draft ? draft.value.trim() !== draft.original.trim() : false;
                  const showEye = noteText.trim().length > 60;

                  return (
                    <tr key={row.itemId || row.sku || row.name}>
                      <td
                        style={{
                          padding: "8px 10px",
                          borderTop: B_ROW,
                          borderRight: B_ROW,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.sku}
                      </td>

                      <td style={{ padding: "8px 10px", borderTop: B_ROW, borderRight: B_ROW }}>
                        {row.name}
                      </td>

                      {/* ✅ NEW: Ghi chú (inline edit y như linh kiện) */}
                      <td style={{ padding: "8px 10px", borderTop: B_ROW, borderRight: B_ROW }}>
                        {!canEditNote || !row.itemId ? (
                          <div
                            style={{
                              color: "#334155",
                              fontSize: 13,
                              lineHeight: 1.35,
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical" as any,
                              overflow: "hidden",
                              wordBreak: "break-word",
                            }}
                            title={noteText || ""}
                          >
                            {noteText ? noteText : <span style={{ color: "#94a3b8" }}>—</span>}
                          </div>
                        ) : isEditing ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              value={val}
                              onChange={(e) => changeNoteValue(row.itemId!, e.target.value)}
                              onKeyDown={(e) => onNoteKeyDown(e, row)}
                              disabled={isSaving}
                              placeholder="Nhập ghi chú..."
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: 6,
                                border: "1px solid #cbd5e1",
                                fontSize: 13,
                                outline: "none",
                              }}
                            />

                            <button
                              type="button"
                              onClick={() => saveNote(row)}
                              disabled={isSaving || !dirty}
                              title="Lưu (Enter)"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #16a34a",
                                backgroundColor: isSaving || !dirty ? "#dcfce7" : "#16a34a",
                                color: isSaving || !dirty ? "#166534" : "#fff",
                                fontSize: 12,
                                fontWeight: 800,
                                cursor: isSaving || !dirty ? "default" : "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isSaving ? "..." : "Lưu"}
                            </button>

                            <button
                              type="button"
                              onClick={() => cancelEditNote(row.itemId!)}
                              disabled={isSaving}
                              title="Hủy (Esc)"
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #e5e7eb",
                                backgroundColor: "#fff",
                                color: "#334155",
                                fontSize: 12,
                                fontWeight: 800,
                                cursor: isSaving ? "default" : "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Hủy
                            </button>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                color: "#334155",
                                fontSize: 13,
                                lineHeight: 1.35,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical" as any,
                                overflow: "hidden",
                                wordBreak: "break-word",
                                flex: 1,
                              }}
                              title={noteText || ""}
                            >
                              {noteText ? noteText : <span style={{ color: "#94a3b8" }}>—</span>}
                            </div>

                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              {showEye && (
                                <button
                                  type="button"
                                  onClick={() => openViewNote(row)}
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 999,
                                    border: "1px solid #cbd5e1",
                                    backgroundColor: "#fff",
                                    color: "#0f172a",
                                    fontSize: 12,
                                    fontWeight: 900,
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  title="Xem đầy đủ"
                                >
                                  👁
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => startEditNote(row)}
                                style={{
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  border: "1px solid #cbd5e1",
                                  backgroundColor: "#fff",
                                  color: "#0f172a",
                                  fontSize: 12,
                                  fontWeight: 900,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                                title="Sửa ghi chú"
                              >
                                ✎
                              </button>
                            </div>
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "8px 10px",
                          borderTop: B_ROW,
                          borderRight: B_ROW,
                          textAlign: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {renderUnitCell(row)}
                      </td>

                      <td
                        style={{
                          padding: "8px 10px",
                          borderTop: B_ROW,
                          borderRight: B_ROW,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          fontWeight: 600,
                        }}
                      >
                        {fmtQty(row.totalQty)}
                      </td>

                      {isAdmin && (
                        <>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderTop: B_ROW,
                              borderRight: B_ROW,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {fmtMoney(row.avgCost || 0)}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderTop: B_ROW,
                              borderRight: B_ROW,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {fmtMoney(row.stockValue || 0)}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderTop: B_ROW,
                              textAlign: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #2563eb",
                                backgroundColor: "#eff6ff",
                                color: "#1d4ed8",
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Sửa
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ✅ Pagination responsive */}
      <div
        style={{
          marginTop: 10,
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

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              backgroundColor: page <= 1 ? "#f9fafb" : "#ffffff",
              color: "#374151",
              cursor: page <= 1 ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            Trước
          </button>

          {!isMobile &&
            pageNumbers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => goToPage(p)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  backgroundColor: p === page ? "#1d4ed8" : "#ffffff",
                  color: p === page ? "#ffffff" : "#374151",
                  cursor: "pointer",
                  minWidth: 36,
                  fontWeight: 700,
                }}
              >
                {p}
              </button>
            ))}

          {isMobile && (
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#fff",
                fontWeight: 700,
                minWidth: 90,
                textAlign: "center",
              }}
            >
              {page}/{totalPages}
            </span>
          )}

          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              backgroundColor: page >= totalPages ? "#f9fafb" : "#ffffff",
              color: "#374151",
              cursor: page >= totalPages ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            Sau
          </button>
        </div>
      </div>

      {/* ========================= EDIT MODAL ========================= */}
      {edit.open && isAdmin && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEdit();
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
            ref={dialogRef}
            tabIndex={-1}
            style={{
              width: "min(720px, 96vw)",
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
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Cập nhật máy</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                  SKU: <b>{(edit.sku || "").trim() || "(trống)"}</b>
                </div>
              </div>

              <button
                type="button"
                onClick={closeEdit}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 14, overflow: "auto", flex: 1 }}>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Mã máy (SKU)
                  </label>
                  <input
                    type="text"
                    value={edit.open ? edit.sku : ""}
                    onChange={(e) => {
                      if (!edit.open) return;
                      setEdit({ ...edit, sku: e.target.value });
                    }}
                    disabled={edit.loading}
                    placeholder="VD: ST-608"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                    Lưu ý: nếu hệ thống đang <b>unique SKU</b> mà trùng thì sẽ báo lỗi.
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Tên máy *
                  </label>
                  <input
                    type="text"
                    value={edit.open ? edit.name : ""}
                    onChange={(e) => {
                      if (!edit.open) return;
                      setEdit({ ...edit, name: e.target.value });
                    }}
                    disabled={edit.loading}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                    Lưu ý: <b>name</b> đang unique. Nếu trùng sẽ báo lỗi.
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Đơn vị tính (Unit) *
                  </label>
                  <select
                    value={edit.open ? edit.unitId : ""}
                    onChange={(e) => {
                      if (!edit.open) return;
                      setEdit({ ...edit, unitId: e.target.value });
                    }}
                    disabled={edit.loading || unitsLoading}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      fontSize: 14,
                      outline: "none",
                      backgroundColor: edit.loading ? "#f8fafc" : "#fff",
                    }}
                  >
                    {units.length === 0 ? (
                      <option value="">{unitsLoading ? "Đang tải..." : "Chưa có Unit"}</option>
                    ) : (
                      units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.code})
                        </option>
                      ))
                    )}
                  </select>

                  {edit.open && edit.unitId && unitById.get(edit.unitId) && (
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                      Đang chọn:{" "}
                      <b>
                        {unitById.get(edit.unitId)!.name} ({unitById.get(edit.unitId)!.code})
                      </b>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              style={{
                padding: 12,
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                backgroundColor: "#fff",
              }}
            >
              <button
                type="button"
                onClick={closeEdit}
                disabled={edit.loading}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#fff",
                  cursor: edit.loading ? "default" : "pointer",
                  fontWeight: 800,
                }}
              >
                Hủy
              </button>

              <button
                type="button"
                onClick={saveEdit}
                disabled={edit.loading}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #16a34a",
                  backgroundColor: edit.loading ? "#bbf7d0" : "#16a34a",
                  color: "#fff",
                  cursor: edit.loading ? "default" : "pointer",
                  fontWeight: 900,
                }}
              >
                {edit.loading ? "Đang lưu..." : "Lưu cập nhật"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ========================= END MODAL ========================= */}

      {/* ========================= VIEW NOTE MODAL ========================= */}
      {viewNote.open && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeViewNote();
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
              width: "min(720px, 96vw)",
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
              <div>
                <div style={{ fontSize: 15, fontWeight: 900 }}>Ghi chú</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                  <b>{viewNote.sku}</b> — {viewNote.name}
                </div>
              </div>

              <button
                type="button"
                onClick={closeViewNote}
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

            <div style={{ padding: 14, overflow: "auto", flex: 1 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  backgroundColor: "#f8fafc",
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {viewNote.note ? viewNote.note : <span style={{ color: "#94a3b8" }}>Không có ghi chú.</span>}
              </div>
            </div>

            <div
              style={{
                padding: 12,
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                backgroundColor: "#fff",
              }}
            >
              <button
                type="button"
                onClick={copyNote}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Copy
              </button>

              <button
                type="button"
                onClick={closeViewNote}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ========================= END VIEW NOTE MODAL ========================= */}
    </div>
  );
};

export default MachineStocksPage;
