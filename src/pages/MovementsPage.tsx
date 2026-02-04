// src/pages/MovementsPage.tsx
// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

/** ========================= Helpers ========================= **/
function unwrap<T = any>(res: any): T {
  const body = res?.data;
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as T;
}
function toNum(v: any) {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}
function safeId(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}
function fmtMoneyInput(v: number | string | null | undefined) {
  const n = Number(String(v ?? "").replace(/[^\d\-]/g, "")) || 0;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
function parseMoneyInput(s: string) {
  return Number(String(s ?? "").replace(/[^\d\-]/g, "")) || 0;
}
function normalizeDateForInput(raw?: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split("/");
    return `${y}-${m}-${d}`;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
async function apiTry(reqs: Array<() => Promise<any>>) {
  let lastErr: any = null;
  for (const fn of reqs) {
    try {
      const r = await fn();
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** ========================= Types ========================= **/
type Location = {
  id: string;
  code?: string;
  name: string;
};
type Item = {
  id: string;
  sku?: string;
  code?: string;
  name: string;
  unit?: string;
};
type MovementType = "ADJUST" | "REVALUE";

type MovementLine = {
  id?: string;
  itemId?: string | null;
  itemName: string;
  qty: number; // ADJUST: qtyDelta (+/-). REVALUE: giữ nguyên (UI disable)
  unitCost: number; // REVALUE: giá vốn mới
  note?: string | null;
};

type Movement = {
  id: string | null;
  refNo?: string;
  date?: string;
  type: MovementType;
  warehouseId?: string | null;
  note?: string | null;
  status?: "DRAFT" | "POSTED" | "CANCELED" | string;
  lines: MovementLine[];
};

/** ========================= Styles ========================= **/
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", // ✅ quan trọng: đừng height:100%
    height: "auto",
    display: "flex",
    flexDirection: "column",
    background: "#f3f4f6",
    overflowX: "hidden",
    overflowY: "auto", // ✅ cho scroll dọc
    WebkitOverflowScrolling: "touch",
  },
  header: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb", background: "#fff" },
  headerTitle: { margin: 0, fontSize: 18, fontWeight: 800 },

  // ✅ Desktop: 2 cột, full height để đáy 2 card bằng nhau
  body: {
    flex: 1,
    minHeight: 0,
    padding: 12,
    display: "grid",
    // list rộng hơn ~30% so với bản cũ (420 -> 560)
    gridTemplateColumns: "560px 1fr",
    gap: 12,
    overflow: "hidden",
  },

  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    overflow: "hidden",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  cardHead: {
    padding: 12,
    borderBottom: "1px solid #f3f4f6",
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardBody: {
    padding: 12,
    overflow: "hidden", // ✅ thân card không tự scroll, chia vùng con scroll
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },

  label: { fontSize: 12.5, fontWeight: 700, color: "#111827" },
  input: {
    width: "100%",
    padding: "9px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    fontSize: 13.5,
    boxSizing: "border-box",
    background: "#fff",
  },
  select: {
    width: "100%",
    padding: "9px 10px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    fontSize: 13.5,
    background: "#fff",
    boxSizing: "border-box",
  },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  row3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 },

  btn: {
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 13,
  },
  btnPrimary: {
    padding: "9px 12px",
    borderRadius: 10,
    border: "none",
    background: "#16a34a",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 13,
  },
  btnGhost: {
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px dashed #2563eb",
    background: "#eff6ff",
    color: "#2563eb",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 13,
  },

  notice: { padding: "10px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.35 },
  noticeErr: { background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" },
  noticeOk: { background: "#ecfdf5", border: "1px solid #bbf7d0", color: "#166534" },
  noticeInfo: { background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8" },

  chip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    color: "#111827",
  },
  chipGreen: {
    border: "1px solid #bbf7d0",
    background: "#ecfdf5",
    color: "#166534",
  },
  chipGray: {
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#374151",
  },

  // ✅ autocomplete giống InvoiceDetail
  autoWrapper: { position: "relative" },

  // ✅ NEW: suggestBox render bằng portal -> không bị che bởi overflow
  suggestBoxFixed: {
    position: "fixed",
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    maxHeight: 220,
    overflowY: "auto",
    zIndex: 9999,
    boxShadow: "0 12px 34px rgba(0,0,0,0.12)",
  },
  suggestItem: { padding: "8px 10px", fontSize: 13, cursor: "pointer" },
  suggestItemMuted: { padding: "8px 10px", fontSize: 12.5, color: "#9ca3af" },

  // ✅ list table
  listTableWrap: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    overflow: "hidden",
    background: "#fff",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  listHeaderRow: {
    display: "grid",
    gridTemplateColumns: "110px 140px 1fr 120px", // đủ chỗ status
    gap: 8,
    padding: 10,
    background: "#f9fafb",
    fontWeight: 900,
    fontSize: 12,
    borderBottom: "1px solid #f3f4f6",
  },
  listBodyScroll: {
    overflow: "auto",
    minHeight: 0,
    maxHeight: "100%",
  },

  // ✅ lines table: cho phép scroll ngang khi cần
  linesWrap: {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    overflow: "hidden",
    background: "#fff",
  },
  linesHeaderBar: {
    padding: "10px 12px",
    borderBottom: "1px solid #f3f4f6",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    fontWeight: 900,
  },
  linesTableScroll: {
    overflowX: "auto",
  },
  gridHeader: {
    display: "grid",
    columnGap: 8,
    fontSize: 12,
    fontWeight: 900,
    padding: "8px 10px",
    background: "#f9fafb",
    borderBottom: "1px solid #f3f4f6",
    alignItems: "center",
    minWidth: 720, // ✅ để không bóp nát trên mobile
  },
  gridRow: {
    display: "grid",
    columnGap: 8,
    padding: "8px 10px",
    borderBottom: "1px solid #f3f4f6",
    alignItems: "center",
    minWidth: 720,
  },
  smallInput: {
    width: "100%",
    padding: "7px 9px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    fontSize: 13,
    boxSizing: "border-box",
    background: "#fff",
  },
  smallBtn: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "none",
    background: "#ef4444",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
    width: "100%",
  },
};

/** ✅ ErrorBoundary để khỏi trắng trang */
class ErrorBoundary extends React.Component<{ children: any }, { hasError: boolean; error?: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    console.error("MovementsPage crashed:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4">
          <div className="font-semibold text-red-600">Trang bị lỗi</div>
          <pre className="mt-2 text-xs bg-slate-100 p-3 rounded overflow-auto">
            {String(this.state.error?.stack || this.state.error || "Unknown error")}
          </pre>
          <div className="mt-2 text-sm text-slate-600">Mở DevTools Console để xem log.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** ========================= Money input ========================= **/
const LineCostInput: React.FC<{ value: number; disabled?: boolean; onChange: (v: number) => void }> = ({
  value,
  disabled,
  onChange,
}) => {
  const [text, setText] = useState(fmtMoneyInput(value));
  useEffect(() => setText(fmtMoneyInput(value)), [value]);
  return (
    <input
      style={{ ...styles.smallInput, textAlign: "right" }}
      disabled={disabled}
      value={text}
      inputMode="numeric"
      onChange={(e) => {
        const raw = parseMoneyInput(e.target.value);
        setText(fmtMoneyInput(raw));
        onChange(raw);
      }}
      onBlur={() => setText(fmtMoneyInput(value))}
    />
  );
};

/** ========================= Main ========================= **/
const MovementsPage: React.FC = () => {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const isAdmin = role === "admin";
  const isAccountant = role === "accountant";
  const canSee = isAdmin || isAccountant;
  if (!canSee) return <Navigate to="/" replace />;

  const today = new Date().toISOString().slice(0, 10);

  // filters
  const [fType, setFType] = useState<string>(""); // "" | ADJUST | REVALUE
  const [fRef, setFRef] = useState<string>("");

  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // detail
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [movement, setMovement] = useState<Movement | null>(null);

  const locked = String(movement?.status || "DRAFT").toUpperCase() !== "DRAFT";

  // autocomplete
  const [openItemSuggestIndex, setOpenItemSuggestIndex] = useState<number | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  // ✅ NEW: portal dropdown position + input refs (fix dropdown bị che)
  const itemInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [suggestPos, setSuggestPos] = useState<{ top: number; left: number; width: number } | null>(null);

  function syncSuggestPos(idx: number) {
    const el = itemInputRefs.current[idx];
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSuggestPos({
      top: r.bottom + 4,
      left: r.left,
      width: r.width,
    });
  }

  useEffect(() => {
    const onDown = (e: any) => {
      if (!pageRef.current) return;
      if (!pageRef.current.contains(e.target)) setOpenItemSuggestIndex(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  // ✅ NEW: update vị trí dropdown khi scroll/resize (kể cả scroll trong div)
  useEffect(() => {
    const onReflow = () => {
      if (openItemSuggestIndex == null) return;
      syncSuggestPos(openItemSuggestIndex);
    };
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [openItemSuggestIndex]);

  function createEmpty(): Movement {
    return {
      id: null,
      refNo: "",
      date: today,
      type: "ADJUST",
      warehouseId: null,
      note: "",
      status: "DRAFT",
      lines: [],
    };
  }

  async function loadItems() {
    try {
      const res = await api.get("/items", { params: { q: "", page: 1, pageSize: 1000 } });
      const data = unwrap<any>(res);
      const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const mapped: Item[] = arr.map((i: any) => ({
        id: String(i.id),
        sku: i.sku || i.code,
        code: i.code,
        name: i.name,
        unit: i.unit,
      }));
      setItems(mapped.filter((x) => safeId(x.id)));
    } catch (e) {
      console.error("loadItems error", e);
      setItems([]);
    }
  }

  async function loadLocations() {
    try {
      const res = await api.get("/locations");
      const data = unwrap<any>(res);
      const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      const mapped: Location[] = arr.map((l: any) => ({
        id: String(l.id),
        code: l.code,
        name: l.name || l.code || String(l.id),
      }));
      setLocations(mapped.filter((x) => safeId(x.id)));
    } catch (e) {
      console.error("loadLocations error", e);
      setLocations([]);
    }
  }

  async function loadList() {
    setListLoading(true);
    setListErr(null);

    try {
      const params: any = { page: 1, pageSize: 50 };
      if (fType) params.type = fType;
      if (fRef.trim()) params.q = fRef.trim();

      const res = await apiTry([
        () => api.get("/movements", { params }),
        () => api.get("/movements/list", { params }),
      ]);

      const data = unwrap<any>(res);

      // ✅ normalize response:
      // routes/movements.routes.ts -> { ok, total, page, pageSize, data }
      // service style khác -> { rows } / { items } ...
      const arr: any[] =
        (Array.isArray(data?.data) && data.data) ||
        (Array.isArray(data?.rows) && data.rows) ||
        (Array.isArray(data?.items) && data.items) ||
        (Array.isArray(data) && data) ||
        [];

      setRows(arr);

      if (!selectedId && arr.length) {
        const id = safeId(arr[0]?.id);
        if (id) setSelectedId(id);
      }
    } catch (e: any) {
      console.error("loadList error", e);
      setRows([]);
      setListErr(e?.response?.data?.message || e?.message || "Không tải được danh sách phiếu.");
    } finally {
      setListLoading(false);
    }
  }

  async function loadDetail(id: string) {
    if (!id) return;
    setLoading(true);
    setErr(null);
    setMsg(null);

    try {
      const res = await apiTry([() => api.get(`/movements/${id}`), () => api.get(`/movement/${id}`)]);
      const x = unwrap<any>(res) || {};

      const linesRaw: any[] =
        (Array.isArray(x.lines) && x.lines) ||
        (Array.isArray(x.items) && x.items) ||
        (Array.isArray(x.details) && x.details) ||
        [];

      const lines: MovementLine[] = linesRaw.map((l: any) => ({
        id: l.id,
        itemId: l.itemId ?? l.item?.id ?? null,
        itemName: l.item?.name ?? l.itemName ?? l.name ?? "",
        qty: toNum(l.qty),
        unitCost: toNum(l.unitCost ?? l.cost ?? l.price ?? 0),
        note: l.note ?? l.remark ?? null,
      }));

      const mv: Movement = {
        id: safeId(x.id),
        refNo: x.refNo ?? x.code ?? "",
        date: normalizeDateForInput(x.occurredAt ?? x.date ?? x.issueDate ?? x.createdAt ?? today),
        type: (String(x.type || "ADJUST").toUpperCase() as any) === "REVALUE" ? "REVALUE" : "ADJUST",
        warehouseId: x.warehouseId ?? null,
        note: x.note ?? "",
        status: x.status ?? (x.posted ? "POSTED" : "DRAFT"),
        lines,
      };

      setMovement(mv);
    } catch (e: any) {
      console.error("loadDetail error", e);
      setErr(e?.response?.data?.message || e?.message || "Không tải được chi tiết phiếu.");
      setMovement(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
    loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function updateMovement(partial: Partial<Movement>) {
    setMovement((prev) => {
      if (!prev) return prev;
      return { ...prev, ...(partial || {}) };
    });
  }
  function updateLine(idx: number, field: keyof MovementLine, value: any) {
    setMovement((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l, i) => (i === idx ? { ...l, [field]: value } : l));
      return { ...prev, lines };
    });
  }

  function selectItemForLine(idx: number, it: Item) {
    setMovement((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l, i) =>
        i === idx
          ? {
              ...l,
              itemId: it.id,
              itemName: it.name,
            }
          : l
      );
      return { ...prev, lines };
    });
    setOpenItemSuggestIndex(null);
  }

  function addLineLocal() {
    setMovement((prev) => {
      if (!prev) return prev;
      const lines = [
        ...prev.lines,
        {
          itemId: null,
          itemName: "",
          qty: 1,
          unitCost: 0,
          note: "",
        } as MovementLine,
      ];
      return { ...prev, lines };
    });
  }
  function removeLineLocal(idx: number) {
    setMovement((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.filter((_, i) => i !== idx);
      return { ...prev, lines };
    });
  }

  async function createDraftServer() {
    setMsg(null);
    setErr(null);
    setLoading(true);

    try {
      const payload = {
        type: movement?.type || "ADJUST",
        refNo: "",
        note: movement?.note ?? "",
        occurredAt: movement?.date ? movement.date : today,
        warehouseId: safeId(movement?.warehouseId) ?? locations?.[0]?.id ?? null,
      };

      const res = await apiTry([() => api.post("/movements", payload), () => api.post("/movement", payload)]);
      const x = unwrap<any>(res) || {};
      const newId = safeId(x?.id ?? x?.data?.id);
      await loadList();
      if (newId) setSelectedId(newId);
      setMsg({ type: "ok", text: "Đã tạo phiếu trên hệ thống." });
    } catch (e: any) {
      console.error("createDraftServer error", e);
      setMsg({ type: "err", text: e?.response?.data?.message || e?.message || "Tạo phiếu thất bại." });
    } finally {
      setLoading(false);
    }
  }

  async function saveLines() {
    if (!movement) return;

    setMsg(null);
    setErr(null);
    setLoading(true);

    try {
      const mvId = safeId(movement.id);
      if (!mvId) throw new Error("Chưa tạo phiếu trên hệ thống. Bấm “Đã tạo server” trước.");

      for (const line of movement.lines) {
        const itemId = safeId(line.itemId);
        if (!itemId) continue;

        const payload: any = {
          itemId,
          note: line.note ?? "",
        };

        if (movement.type === "REVALUE") {
          payload.unitCost = toNum(line.unitCost);
          // ❌ không gửi qty
        } else {
          // ✅ ADJUST: qtyDelta phải khác 0 (FE chặn trước cho đỡ khó hiểu)
          const q = toNum(line.qty);
          if (q === 0) throw new Error("ADJUST: SL (+/-) phải khác 0.");
          payload.qty = q;
          payload.unitCost = line.unitCost == null ? null : toNum(line.unitCost);
        }

        const lineId = safeId(line.id);
        if (!lineId) {
          await api.post(`/movements/${mvId}/lines`, payload);
        } else {
          await api.put(`/movements/lines/${lineId}`, payload);
        }
      }

      setMsg({ type: "ok", text: "Đã lưu dòng phiếu." });
      await loadDetail(mvId);
      await loadList();
    } catch (e: any) {
      console.error("saveLines error", e);
      setMsg({ type: "err", text: e?.response?.data?.message || e?.message || "Lưu thất bại." });
    } finally {
      setLoading(false);
    }
  }

  async function postMovement() {
    if (!movement?.id) {
      setMsg({ type: "err", text: "Chưa tạo phiếu trên server." });
      return;
    }
    setMsg(null);
    setErr(null);
    setLoading(true);
    try {
      const id = String(movement.id);
      await apiTry([() => api.post(`/movements/${id}/post`), () => api.post(`/movement/${id}/post`)]);
      setMsg({ type: "ok", text: "Đã ghi sổ / Post phiếu." });
      await loadDetail(id);
      await loadList();
    } catch (e: any) {
      console.error("post error", e);
      setMsg({ type: "err", text: e?.response?.data?.message || e?.message || "Ghi sổ thất bại." });
    } finally {
      setLoading(false);
    }
  }

  const statusText = useMemo(() => {
    const s = String(movement?.status || "DRAFT").toUpperCase();
    if (s === "POSTED" || s === "APPROVED") return "Đã ghi sổ";
    if (s === "CANCELED") return "Đã hủy";
    return "Nháp";
  }, [movement?.status]);

  const statusChipStyle = useMemo(() => {
    const s = String(movement?.status || "DRAFT").toUpperCase();
    if (s === "POSTED" || s === "APPROVED") return { ...styles.chip, ...styles.chipGreen };
    return { ...styles.chip, ...styles.chipGray };
  }, [movement?.status]);

  const guideText = useMemo(() => {
    const t = movement?.type || "ADJUST";
    if (t === "REVALUE") {
      return "Chỉnh giá vốn: mỗi dòng chọn 1 sản phẩm và nhập Giá vốn mới. Số lượng tồn giữ nguyên.";
    }
    return "Chỉnh tồn: nhập SL (+/-). Dương = tăng tồn, Âm = giảm tồn. Giá vốn có thể để trống (tùy nghiệp vụ).";
  }, [movement?.type]);

  // lines columns config
  const gridCols = useMemo(() => {
    if ((movement?.type || "ADJUST") === "REVALUE") {
      // Sản phẩm | SL (disabled) | Giá vốn mới | Ghi chú | Xóa
      return "4fr 1.1fr 1.6fr 2.4fr 84px";
    }
    // ADJUST: Sản phẩm | SL (+/-) | Giá vốn (tuỳ chọn) | Ghi chú | Xóa
    return "4fr 1.1fr 1.6fr 2.4fr 84px";
  }, [movement?.type]);

  return (
    <ErrorBoundary>
      <div ref={pageRef as any} style={styles.page} className="mv-page">
        <div style={styles.header}>
          <h1 style={styles.headerTitle}>Phiếu điều chỉnh tồn / giá vốn</h1>
        </div>

        <div style={styles.body} className="mv-grid">
          {/* LEFT: LIST */}
          <div style={styles.card} className="mv-card mv-list-card">
            <div style={styles.cardHead}>
              <div>Danh sách phiếu</div>
              <button style={styles.btnGhost} onClick={() => setMovement(createEmpty())} disabled={loading || listLoading}>
                + Tạo phiếu mới
              </button>
            </div>

            <div style={styles.cardBody}>
              {/* filters */}
              <div className="mv-filter" style={{ display: "grid", gap: 10 }}>
                <div style={styles.row2}>
                  <div>
                    <div style={styles.label}>Loại</div>
                    <select style={styles.select} value={fType} onChange={(e) => setFType(e.target.value)}>
                      <option value="">Tất cả</option>
                      <option value="ADJUST">Điều chỉnh tồn</option>
                      <option value="REVALUE">Điều chỉnh giá vốn</option>
                    </select>
                  </div>
                  <div>
                    <div style={styles.label}>Tìm (số phiếu / ghi chú)</div>
                    <input
                      style={styles.input}
                      value={fRef}
                      onChange={(e) => setFRef(e.target.value)}
                      placeholder="VD: MV-... hoặc ghi chú"
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button style={styles.btn} onClick={loadList} disabled={listLoading}>
                    {listLoading ? "Đang tải..." : "Tìm"}
                  </button>
                </div>

                {listErr ? <div style={{ ...styles.notice, ...styles.noticeErr }}>{listErr}</div> : null}
              </div>

              {/* table scroll */}
              <div style={styles.listTableWrap} className="mv-list-wrap">
                <div style={styles.listHeaderRow}>
                  <div>Ngày</div>
                  <div>Loại</div>
                  <div>Số phiếu</div>
                  <div>Trạng thái</div>
                </div>

                <div style={styles.listBodyScroll} className="mv-list-scroll">
                  {listLoading ? (
                    <div style={{ padding: 12, color: "#6b7280" }}>Đang tải...</div>
                  ) : rows.length === 0 ? (
                    <div style={{ padding: 12, color: "#6b7280" }}>Chưa có phiếu nào.</div>
                  ) : (
                    rows.map((r: any) => {
                      const id = safeId(r.id);
                      const active = id && id === selectedId;

                      const d = normalizeDateForInput(r.occurredAt ?? r.date ?? r.createdAt);
                      const type = String(r.type || "").toUpperCase();
                      const ref = r.refNo ?? r.code ?? r.no ?? "";
                      const posted = !!r.posted;
                      const st = String(r.status || (posted ? "POSTED" : "DRAFT")).toUpperCase();
                      const stTxt =
                        st === "POSTED" || st === "APPROVED" ? "Đã ghi sổ" : st === "CANCELED" ? "Đã hủy" : "Nháp";

                      return (
                        <button
                          key={id || Math.random()}
                          type="button"
                          onClick={() => id && setSelectedId(id)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: active ? "#eef2ff" : "#fff",
                            padding: 10,
                            cursor: "pointer",
                            borderTop: "1px solid #f3f4f6",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "110px 140px 1fr 120px",
                              gap: 8,
                              alignItems: "center",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ whiteSpace: "nowrap", fontWeight: 800 }}>
                              {d ? `${d.split("-").reverse().join("/")}` : "-"}
                            </div>
                            <div style={{ fontWeight: 900 }}>{type === "REVALUE" ? "Chỉnh giá vốn" : "Chỉnh tồn"}</div>
                            <div style={{ fontWeight: 900 }}>{ref || "(Chưa có số)"}</div>
                            <div style={{ fontWeight: 900, color: stTxt === "Đã ghi sổ" ? "#16a34a" : "#6b7280" }}>
                              {stTxt}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ fontSize: 12.5, color: "#6b7280" }}>* Click 1 phiếu để xem chi tiết bên phải.</div>
            </div>
          </div>

          {/* RIGHT: DETAIL */}
          <div style={styles.card} className="mv-card mv-detail-card">
            <div style={styles.cardHead}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span>Chi tiết phiếu</span>
                <span style={statusChipStyle}>{movement ? statusText : "Chưa chọn"}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={styles.btn} type="button" onClick={() => setMovement(createEmpty())} disabled={loading}>
                  Tạo form mới (local)
                </button>
              </div>
            </div>

            <div style={styles.cardBody} className="mv-detail-body">
              {err ? <div style={{ ...styles.notice, ...styles.noticeErr }}>{err}</div> : null}
              {msg ? <div style={{ ...styles.notice, ...(msg.type === "ok" ? styles.noticeOk : styles.noticeErr) }}>{msg.text}</div> : null}

              {!movement ? (
                <div style={{ ...styles.notice, ...styles.noticeInfo }}>Chọn 1 phiếu bên trái hoặc bấm “+ Tạo phiếu mới”.</div>
              ) : (
                <>
                  <div style={{ ...styles.notice, ...styles.noticeInfo }}>{guideText}</div>

                  {/* Header fields */}
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={styles.row3} className="mv-detail-grid">
                      <div>
                        <div style={styles.label}>Loại phiếu</div>
                        <select
                          style={styles.select}
                          value={movement.type}
                          disabled={!!movement.id || loading} // ✅ đã tạo server thì không đổi type
                          onChange={(e) => updateMovement({ type: e.target.value as any })}
                        >
                          <option value="ADJUST">Điều chỉnh tồn</option>
                          <option value="REVALUE">Điều chỉnh giá vốn</option>
                        </select>
                        {!!movement.id ? (
                          <div style={{ marginTop: 6, fontSize: 12.5, color: "#6b7280" }}>
                            * Đã tạo phiếu trên hệ thống nên <b>không đổi loại</b> (tránh lệch ADJUST/REVALUE).
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <div style={styles.label}>Ngày phát sinh</div>
                        <input
                          style={styles.input}
                          type="date"
                          value={movement.date || ""}
                          disabled={locked || loading || !!movement.id} // chưa có PUT header
                          onChange={(e) => updateMovement({ date: e.target.value })}
                        />
                      </div>

                      <div>
                        <div style={styles.label}>Số phiếu (refNo)</div>
                        <input style={styles.input} value={movement.refNo || ""} disabled={true} placeholder="Số tự nhảy" />
                      </div>
                    </div>

                    <div style={styles.row2} className="mv-detail-grid2">
                      <div>
                        <div style={styles.label}>Kho</div>
                        <select
                          style={styles.select}
                          value={movement.warehouseId || ""}
                          disabled={locked || loading || !!movement.id} // chưa có PUT header
                          onChange={(e) => updateMovement({ warehouseId: safeId(e.target.value) })}
                        >
                          <option value="">-- (Không chọn thì hệ thống tự dùng kho đầu) --</option>
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {(l.code ? `${l.code} - ` : "") + l.name}
                            </option>
                          ))}
                        </select>
                        <div style={{ marginTop: 6, fontSize: 12.5, color: "#6b7280" }}>
                          * Hệ của m chỉ có 1 kho: nếu không chọn, hệ thống tự dùng kho đầu.
                        </div>
                      </div>

                      <div>
                        <div style={styles.label}>Ghi chú</div>
                        <input
                          style={styles.input}
                          value={movement.note || ""}
                          disabled={locked || loading || !!movement.id} // chưa có PUT header
                          onChange={(e) => updateMovement({ note: e.target.value })}
                          placeholder="Ghi chú phiếu..."
                        />
                      </div>
                    </div>
                  </div>

                  {/* Lines */}
                  <div style={styles.linesWrap} className="mv-lines-wrap">
                    <div style={styles.linesHeaderBar}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span>Dòng sản phẩm</span>
                        {movement.type === "REVALUE" ? (
                          <span style={{ ...styles.chip, ...styles.chipGray }}>SL giữ nguyên</span>
                        ) : (
                          <span style={{ ...styles.chip, ...styles.chipGray }}>SL cho phép +/-</span>
                        )}
                      </div>
                      <button style={styles.btnGhost} type="button" disabled={locked || loading} onClick={addLineLocal}>
                        + Thêm dòng
                      </button>
                    </div>

                    <div style={styles.linesTableScroll} className="mv-lines-scrollx">
                      <div style={{ ...styles.gridHeader, gridTemplateColumns: gridCols }}>
                        <div>Sản phẩm</div>
                        <div style={{ textAlign: "center" }}>{movement.type === "REVALUE" ? "SL" : "SL (+/-)"}</div>
                        <div style={{ textAlign: "right" }}>
                          {movement.type === "REVALUE" ? "Giá vốn mới" : "Giá vốn (tuỳ chọn)"}
                        </div>
                        <div>Ghi chú dòng</div>
                        <div />
                      </div>

                      {movement.lines.length === 0 ? (
                        <div style={{ padding: 12, color: "#6b7280" }}>Chưa có dòng nào. Bấm “+ Thêm dòng”.</div>
                      ) : null}

                      {movement.lines.map((line, idx) => {
                        const q = (line.itemName || "").toLowerCase();
                        const itemSuggestions =
                          q.length > 0
                            ? items
                                .filter((it: any) => {
                                  const name = (it.name || "").toLowerCase();
                                  const sku = ((it.sku || it.code || "") as string).toLowerCase();
                                  return name.includes(q) || sku.includes(q);
                                })
                                .slice(0, 50)
                            : [];

                        const isRevalue = movement.type === "REVALUE";

                        return (
                          <div key={line.id ?? `line-${idx}`} style={{ ...styles.gridRow, gridTemplateColumns: gridCols }}>
                            {/* Product */}
                            <div style={styles.autoWrapper}>
                              <input
                                ref={(el) => (itemInputRefs.current[idx] = el)}
                                style={styles.smallInput}
                                value={line.itemName}
                                disabled={locked || loading}
                                onChange={(e) => {
                                  updateLine(idx, "itemName", e.target.value);
                                  requestAnimationFrame(() => syncSuggestPos(idx));
                                }}
                                onFocus={() => {
                                  setOpenItemSuggestIndex(idx);
                                  requestAnimationFrame(() => syncSuggestPos(idx));
                                }}
                                placeholder="Gõ mã hoặc tên sản phẩm..."
                              />

                              {/* ✅ FIX: dropdown render bằng portal (không bị che bởi overflow) */}
                              {openItemSuggestIndex === idx &&
                                !locked &&
                                !loading &&
                                (line.itemName || "").length > 0 &&
                                suggestPos &&
                                ReactDOM.createPortal(
                                  <div
                                    style={{
                                      ...styles.suggestBoxFixed,
                                      top: suggestPos.top,
                                      left: suggestPos.left,
                                      width: suggestPos.width,
                                    }}
                                  >
                                    {itemSuggestions.length > 0 ? (
                                      itemSuggestions.map((it: any) => (
                                        <div
                                          key={it.id}
                                          style={styles.suggestItem}
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            selectItemForLine(idx, it);
                                          }}
                                        >
                                          {it.sku || it.code ? <b style={{ marginRight: 6 }}>{it.sku || it.code}</b> : null}
                                          {it.name}
                                        </div>
                                      ))
                                    ) : (
                                      <div style={styles.suggestItemMuted}>Không tìm thấy sản phẩm</div>
                                    )}
                                  </div>,
                                  document.body
                                )}
                            </div>

                            {/* Qty */}
                            <div>
                              <input
                                style={{ ...styles.smallInput, textAlign: "center", opacity: isRevalue ? 0.7 : 1 }}
                                type="number"
                                value={toNum(line.qty)}
                                disabled={locked || loading || isRevalue} // ✅ REVALUE giữ nguyên qty
                                onChange={(e) => updateLine(idx, "qty", toNum(e.target.value))}
                              />
                            </div>

                            {/* unitCost */}
                            <div>
                              <LineCostInput
                                value={toNum(line.unitCost)}
                                disabled={locked || loading}
                                onChange={(raw) => updateLine(idx, "unitCost", raw)}
                              />
                            </div>

                            {/* note */}
                            <div>
                              <input
                                style={styles.smallInput}
                                value={line.note || ""}
                                disabled={locked || loading}
                                onChange={(e) => updateLine(idx, "note", e.target.value)}
                                placeholder="Ghi chú dòng..."
                              />
                            </div>

                            <div>
                              <button
                                style={styles.smallBtn}
                                type="button"
                                disabled={locked || loading}
                                onClick={() => removeLineLocal(idx)}
                              >
                                Xóa
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ padding: 12, borderTop: "1px solid #f3f4f6", display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button style={styles.btn} type="button" disabled={loading} onClick={createDraftServer}>
                        {movement?.id ? "Đã tạo server" : "Tạo phiếu (server)"}
                      </button>

                      <button style={styles.btn} type="button" disabled={loading || locked} onClick={saveLines}>
                        Lưu dòng
                      </button>

                      <button style={styles.btnPrimary} type="button" disabled={loading || locked} onClick={postMovement}>
                        Ghi sổ / Post
                      </button>
                    </div>

                    <div style={{ padding: "0 12px 12px", fontSize: 12.5, color: "#6b7280" }}>
                      * Flow: Tạo phiếu (local) → chọn loại/kho/ngày → Tạo phiếu (server) → nhập dòng → Lưu dòng → Post.
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ✅ Responsive + Mobile layout theo yêu cầu */}
        <style>{`
          /* Desktop: đảm bảo 2 card cùng cao, sát đáy */
          .mv-grid { align-items: stretch; }
          .mv-card { height: 100%; }

          /* Mobile: list ở trên, scroll trong table; chi tiết ở dưới */
          @media (max-width: 980px) {
            .mv-grid {
              grid-template-columns: 1fr !important;
              overflow: auto !important;
              align-content: start;
            }
            .mv-detail-card {
              height: auto !important;      /* ✅ ADD: đừng khóa chiều cao */
              min-height: unset !important; /* ✅ ADD */
            }

            .mv-detail-body {
              overflow: visible !important; /* ✅ ADD: cho page scroll xuống hết form */
            }

            .mv-grid {
              overflow: auto !important;      /* ✅ đã có */
              min-height: 0;
            }

            .mv-page {
              overflow: auto !important;      /* ✅ ADD */
            }

            /* list cố định ở trên: set chiều cao để table scroll bên trong */
            .mv-list-card {
              height: 44vh;           /* ✅ cố định phần list */
              min-height: 360px;
            }

            .mv-list-wrap {
              flex: 1;
              min-height: 0;
            }

            .mv-list-scroll {
              max-height: 100%;
              -webkit-overflow-scrolling: touch;
            }

            /* detail ở dưới: full phần còn lại, cho page scroll */
            .mv-detail-card {
              min-height: 56vh;
            }

            /* form header stack dọc cho gọn */
            .mv-detail-grid, .mv-detail-grid2 {
              grid-template-columns: 1fr !important;
            }

            /* lines: cho scroll ngang mượt */
            .mv-lines-scrollx {
              -webkit-overflow-scrolling: touch;
            }
          }

          /* iOS momentum scroll fix */
          .mv-list-scroll, .mv-lines-scrollx {
            -webkit-overflow-scrolling: touch;
          }
        `}</style>
      </div>
    </ErrorBoundary>
  );
};

export default MovementsPage;
