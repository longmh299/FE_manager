// src/pages/MachineStocksPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import api, { extractList, getApiBaseUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";

type MachineStockRow = {
  itemId?: string; // ✅ now provided by BE
  sku: string;
  name: string;

  unit?: string;     // unitCode (pcs, pair, m...)
  unitName?: string; // unitName (Cái, Cặp, Mét...)
  totalQty: number;

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

type ToastState =
  | { type: "success" | "error"; message: string }
  | null;

type EditState =
  | {
      open: true;
      loading: boolean;
      itemId: string; // ✅ must have
      sku: string;

      name: string;
      unitId: string;

      originalName: string;
      originalUnitId: string;
    }
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

  const [rows, setRows] = useState<MachineStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");

  const [page, setPage] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
        unit: r.unit ?? "", // unitCode
        unitName: r.unitName ?? "", // unitName
        totalQty: Number(r.totalQty ?? 0),
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

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

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

  const fmtMoney = (n: number) => (Number(n || 0)).toLocaleString("vi-VN");
  const fmtQty = (n: number) => (Number(n || 0)).toLocaleString("vi-VN");

  const renderUnitCell = (row: MachineStockRow) => {
    // ✅ ưu tiên tiếng Việt
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

    // đoán unitId từ unitCode nếu có
    const code = String(row.unit || "").trim().toLowerCase();
    const guessedUnitId = (code && unitIdByCode.get(code)) || defaultUnitId;

    setEdit({
      open: true,
      loading: false,
      itemId: row.itemId,
      sku: row.sku,
      name: row.name,
      unitId: guessedUnitId,
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

    const name = edit.name.trim();
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
        name,
        unitId: edit.unitId,
      });

      const u = unitById.get(edit.unitId);
      showToast("success", `Đã cập nhật. ĐVT: ${u ? `${u.name} (${u.code})` : "OK"}`);

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
            <span style={{ fontSize: 11, color: "#6b7280" }}>(Chỉ dành cho Admin)</span>
          </div>

          <form
            onSubmit={handleCreateMachine}
            style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}
          >
            <div style={{ minWidth: 140, flex: "0 0 auto" }}>
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

            <div style={{ minWidth: 220, flex: 1 }}>
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

            <div style={{ minWidth: 180, flex: "0 0 auto" }}>
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

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 16,
        }}
      >
        <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Tìm theo mã / tên máy..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              minWidth: 260,
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
          }}
        >
          Xuất Excel tồn máy
        </button>
      </div>

      {error && <div style={{ marginBottom: 8, color: "#b91c1c", fontSize: 14 }}>Lỗi: {error}</div>}

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden",
          backgroundColor: "#fff",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 10px", borderRight: "1px solid #e5e7eb", width: 160 }}>
                Mã
              </th>
              <th style={{ textAlign: "left", padding: "8px 10px", borderRight: "1px solid #e5e7eb" }}>
                Tên máy
              </th>
              <th style={{ textAlign: "center", padding: "8px 10px", borderRight: "1px solid #e5e7eb", width: 110 }}>
                ĐVT
              </th>
               <th style={{ textAlign: "right", padding: "8px 10px", width: 120 }}>Tồn kho</th>
              {isAdmin && (
                <>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderRight: "1px solid #e5e7eb", width: 140 }}>
                    Giá vốn TB
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 10px", borderRight: "1px solid #e5e7eb", width: 160 }}>
                    Giá trị tồn
                  </th>
                  <th style={{ textAlign: "center", padding: "8px 10px", borderRight: "1px solid #e5e7eb", width: 120 }}>
                    Cập nhật
                  </th>
                </>
              )}

             
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 4} style={{ padding: 12, textAlign: "center" }}>
                  Đang tải dữ liệu...
                </td>
              </tr>
            ) : pagedRows.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 4} style={{ padding: 12, textAlign: "center" }}>
                  Không có dòng máy nào thỏa điều kiện.
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.itemId || row.sku || row.name}>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                    {row.sku}
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9" }}>
                    {row.name}
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9", textAlign: "center", whiteSpace: "nowrap" }}>
                    {renderUnitCell(row)}
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid #f1f5f9", textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>
                    {fmtQty(row.totalQty)}
                  </td>
                  {isAdmin && (
                    <>
                      <td style={{ padding: "8px 10px", borderTop: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9", textAlign: "right", whiteSpace: "nowrap" }}>
                        {fmtMoney(row.avgCost || 0)}
                      </td>
                      <td style={{ padding: "8px 10px", borderTop: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9", textAlign: "right", whiteSpace: "nowrap" }}>
                        {fmtMoney(row.stockValue || 0)}
                      </td>
                      <td style={{ padding: "8px 10px", borderTop: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9", textAlign: "center", whiteSpace: "nowrap" }}>
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
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, flexWrap: "wrap", gap: 8 }}>
        <div>
          Trang {page}/{totalPages} – Tổng {totalItems} dòng máy
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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

          {pageNumbers.map((p) => (
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
                  SKU: <b>{edit.sku || "(trống)"}</b>
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
    </div>
  );
};

export default MachineStocksPage;
