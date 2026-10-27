// src/pages/MovementsPage.tsx
// Phiếu điều chỉnh tồn / giá vốn (ADJUST / REVALUE)
// - Danh sách gọn bên trái (lọc trạng thái + loại, tìm tự động)
// - Phiếu nháp: thêm SP bằng ô tìm nhanh, thấy tồn hiện tại / tồn sau, kiểm tra lỗi trước khi lưu
// - Phiếu đã ghi sổ: chỉ xem (không còn ô nhập / nút lưu)
// API giữ nguyên: GET/POST /movements, POST /movements/:id/lines, PUT|DELETE /movements/lines/:id,
//                  POST /movements/:id/post, GET /stocks?itemId=&locationId=
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";

/* ========================= Helpers ========================= */
function unwrap<T = any>(res: any): T {
  const body = res?.data;
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as T;
}
function toNum(v: any) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
}
function safeId(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf3 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const fmtMoney = (n: number) => nf0.format(Math.round(n || 0));
const fmtQty = (n: number) => nf3.format(n || 0);
const fmtSigned = (n: number) => (n > 0 ? `+${fmtQty(n)}` : fmtQty(n));
function parseDigits(s: string) {
  return Number(String(s ?? "").replace(/[^\d]/g, "")) || 0;
}
function normalizeDate(raw?: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const viDate = (ymd: string) => (ymd ? ymd.split("-").reverse().join("/") : "-");
function localToday() {
  return normalizeDate(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
}
async function apiTry(reqs: Array<() => Promise<any>>) {
  let lastErr: any = null;
  for (const fn of reqs) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
function errMsg(e: any, fallback: string) {
  return e?.response?.data?.message || e?.message || fallback;
}
function useDebounce<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
let uidSeq = 0;
const uid = () => `l${Date.now().toString(36)}${(uidSeq++).toString(36)}`;

/* ========================= Types ========================= */
type Location = { id: string; code?: string; name: string };
type Item = { id: string; sku?: string; name: string; unit?: string };
type MovementType = "ADJUST" | "REVALUE";

type Line = {
  k: string; // key nội bộ
  id?: string | null; // id dòng trên server
  itemId: string;
  sku?: string;
  itemName: string;
  unit?: string;
  qty: number; // ADJUST: +/-; REVALUE: 0
  unitCost: number | null; // ADJUST: giá vốn nhập khi tăng (tuỳ chọn); REVALUE: giá vốn mới
  costTotal?: number | null;
  note: string;
};

type Movement = {
  id: string | null;
  refNo: string;
  date: string;
  type: MovementType;
  warehouseId: string | null;
  note: string;
  status: string; // DRAFT | POSTED | CANCELED
  lines: Line[];
};

type StockInfo = { qty: number; avgCost: number } | "loading" | "error";

const statusLabel = (s: string) => {
  const u = String(s || "DRAFT").toUpperCase();
  if (u === "POSTED" || u === "APPROVED") return "Đã ghi sổ";
  if (u === "CANCELED") return "Đã hủy";
  return "Nháp";
};
const TYPE_LABEL: Record<MovementType, string> = { ADJUST: "Chỉnh tồn", REVALUE: "Chỉnh giá vốn" };

/* ========================= Small UI pieces ========================= */
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const u = String(status || "DRAFT").toUpperCase();
  const cls =
    u === "POSTED" || u === "APPROVED"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : u === "CANCELED"
      ? "bg-rose-50 text-rose-700 ring-rose-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${cls}`}>
      {statusLabel(status)}
    </span>
  );
};
const TypeBadge: React.FC<{ type: MovementType }> = ({ type }) => (
  <span
    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
      type === "REVALUE" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-sky-50 text-sky-700 ring-sky-200"
    }`}
  >
    {TYPE_LABEL[type]}
  </span>
);

const Segmented: React.FC<{
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        onClick={() => onChange(o.value)}
        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
          value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const MoneyInput: React.FC<{
  id?: string;
  value: number | null;
  placeholder?: string;
  invalid?: boolean;
  onChange: (v: number | null) => void;
}> = ({ id, value, placeholder, invalid, onChange }) => (
  <input
    id={id}
    className={`w-full rounded-lg border px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 ${
      invalid ? "border-rose-300 focus:ring-rose-200" : "border-slate-300 focus:border-sky-400 focus:ring-sky-100"
    }`}
    inputMode="numeric"
    value={value ? fmtMoney(value) : ""}
    placeholder={placeholder}
    onChange={(e) => {
      const n = parseDigits(e.target.value);
      onChange(n > 0 ? n : null);
    }}
  />
);

const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmText: string;
  cancelText?: string;
  tone?: "primary" | "danger" | "warning";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ open, title, children, confirmText, cancelText = "Huỷ", tone = "primary", busy, onCancel, onConfirm }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel, onConfirm]);
  if (!open) return null;
  const btn =
    tone === "danger"
      ? "bg-rose-600 hover:bg-rose-700"
      : tone === "warning"
      ? "bg-amber-500 hover:bg-amber-600"
      : "bg-emerald-600 hover:bg-emerald-700";
  const icon =
    tone === "danger" ? ["bg-rose-100 text-rose-600", "!"] : tone === "warning" ? ["bg-amber-100 text-amber-600", "!"] : ["bg-emerald-100 text-emerald-600", "✓"];
  return (
    <div
      className="mv-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]"
      onMouseDown={() => !busy && onCancel()}
    >
      <div className="mv-pop w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${icon[0]}`}>
            {icon[1]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-slate-900">{title}</div>
            <div className="mt-2 text-sm text-slate-600">{children}</div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelText}
          </button>
          <button
            type="button"
            autoFocus
            className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${btn}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Đang xử lý..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

const Toast: React.FC<{ msg: { type: "ok" | "err"; text: string; n: number } | null; onClose: () => void }> = ({
  msg,
  onClose,
}) => {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, msg.type === "ok" ? 3000 : 7000);
    return () => clearTimeout(t);
  }, [msg, onClose]);
  if (!msg) return null;
  const ok = msg.type === "ok";
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4 sm:justify-end sm:pr-6">
      <div
        key={msg.n}
        role="status"
        className={`mv-slide pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white p-3 shadow-lg ${
          ok ? "border-emerald-200" : "border-rose-200"
        }`}
      >
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            ok ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
          }`}
        >
          {ok ? "✓" : "!"}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className={`text-sm font-semibold ${ok ? "text-emerald-800" : "text-rose-700"}`}>
            {ok ? "Thành công" : "Có lỗi"}
          </div>
          <div className="mt-0.5 text-sm text-slate-600">{msg.text}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          ✕
        </button>
      </div>
    </div>
  );
};

/* ========================= Item picker (thêm SP nhanh) ========================= */
const ItemPicker: React.FC<{
  items: Item[];
  existingIds: Set<string>;
  onPick: (it: Item) => void;
}> = ({ items, existingIds, onPick }) => {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts: Item[] = [];
    const contains: Item[] = [];
    for (const it of items) {
      const sku = (it.sku || "").toLowerCase();
      const name = (it.name || "").toLowerCase();
      if (sku.startsWith(s) || name.startsWith(s)) starts.push(it);
      else if (sku.includes(s) || name.includes(s)) contains.push(it);
      if (starts.length >= 30) break;
    }
    return [...starts, ...contains].slice(0, 30);
  }, [q, items]);

  useEffect(() => setHi(0), [q]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  function pick(it: Item) {
    onPick(it);
    setQ("");
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[hi]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Thêm sản phẩm: gõ mã hoặc tên rồi Enter…"
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
      />
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-400">Không tìm thấy sản phẩm</div>
          ) : (
            results.map((it, i) => (
              <div
                key={it.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(it);
                }}
                onMouseEnter={() => setHi(i)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${i === hi ? "bg-sky-50" : ""}`}
              >
                {it.sku ? <span className="shrink-0 font-mono text-xs font-semibold text-slate-500">{it.sku}</span> : null}
                <span className="min-w-0 flex-1 truncate">{it.name}</span>
                {existingIds.has(it.id) ? (
                  <span className="shrink-0 text-[11px] font-semibold text-amber-600">đã có trong phiếu</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

/* ========================= Main ========================= */
const MovementsPage: React.FC = () => {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const canSee = role === "admin" || role === "accountant";

  // ---- master data
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // ---- list
  const [fStatus, setFStatus] = useState<"" | "draft" | "posted">("");
  const [fType, setFType] = useState<"" | MovementType>("");
  const [fQ, setFQ] = useState("");
  const debouncedQ = useDebounce(fQ, 350);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const listReqId = useRef(0);

  // ---- detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movement, setMovement] = useState<Movement | null>(null);
  const [snapshot, setSnapshot] = useState<string>(""); // để biết có sửa chưa lưu
  const [removedLineIds, setRemovedLineIds] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msgState, setMsgState] = useState<{ type: "ok" | "err"; text: string; n: number } | null>(null);
  const msgSeq = useRef(0);
  const setMsg = (m: { type: "ok" | "err"; text: string } | null) =>
    setMsgState(m ? { ...m, n: ++msgSeq.current } : null);
  const closeMsg = React.useCallback(() => setMsgState(null), []);
  type AskOpts = { title: string; body: React.ReactNode; confirmText: string; cancelText?: string; tone?: "primary" | "danger" | "warning" };
  const [ask, setAsk] = useState<(AskOpts & { resolve: (v: boolean) => void }) | null>(null);
  function askConfirm(o: AskOpts) {
    return new Promise<boolean>((resolve) => setAsk({ ...o, resolve }));
  }
  const closeAsk = (v: boolean) => {
    ask?.resolve(v);
    setAsk(null);
  };
  const [confirmPost, setConfirmPost] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const detailReqId = useRef(0);

  // ---- stock cache: key = itemId|locationId
  const [stocks, setStocks] = useState<Record<string, StockInfo>>({});

  const locked = !!movement && String(movement.status || "DRAFT").toUpperCase() !== "DRAFT";
  const isRevalue = movement?.type === "REVALUE";
  const effectiveWh = safeId(movement?.warehouseId) ?? locations[0]?.id ?? null;
  const dirty = !!movement && !locked && (JSON.stringify(serialize(movement)) !== snapshot || removedLineIds.length > 0);

  function serialize(m: Movement) {
    return {
      type: m.type,
      date: m.date,
      wh: m.warehouseId,
      note: m.note,
      lines: m.lines.map((l) => [l.id || null, l.itemId, l.qty, l.unitCost, l.note]),
    };
  }

  /* ---------- load master data ---------- */
  useEffect(() => {
    if (!canSee) return;
    (async () => {
      try {
        const res = await api.get("/items", { params: { q: "", page: 1, pageSize: 5000 } });
        const data = unwrap<any>(res);
        const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        setItems(
          arr
            .map((i: any) => ({
              id: String(i.id),
              sku: i.sku || i.code || "",
              name: i.name || "",
              unit: typeof i.unit === "object" ? i.unit?.name || i.unit?.code : i.unit,
            }))
            .filter((x) => safeId(x.id))
        );
      } catch (e) {
        console.error("loadItems error", e);
      }
      try {
        const res = await api.get("/locations");
        const data = unwrap<any>(res);
        const arr: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
        setLocations(
          arr
            .map((l: any) => ({ id: String(l.id), code: l.code, name: l.name || l.code || String(l.id) }))
            .filter((x) => safeId(x.id))
        );
      } catch (e) {
        console.error("loadLocations error", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- list ---------- */
  async function loadList(opts?: { pickFirst?: boolean }) {
    const reqId = ++listReqId.current;
    setListLoading(true);
    setListErr(null);
    try {
      const params: any = { page: 1, pageSize: 100 };
      if (fType) params.type = fType;
      if (fStatus) params.posted = fStatus === "posted" ? "true" : "false";
      if (debouncedQ.trim()) params.q = debouncedQ.trim();
      const res = await api.get("/movements", { params });
      if (reqId !== listReqId.current) return;
      const body = res?.data || {};
      const arr: any[] =
        (Array.isArray(body.rows) && body.rows) ||
        (Array.isArray(body.data) && body.data) ||
        (Array.isArray(body) && body) ||
        [];
      setRows(arr);
      setTotal(toNum(body.total) || arr.length);
      if (opts?.pickFirst && arr[0]?.id) selectVoucher(String(arr[0].id), { force: true });
    } catch (e: any) {
      if (reqId !== listReqId.current) return;
      setRows([]);
      setListErr(errMsg(e, "Không tải được danh sách phiếu."));
    } finally {
      if (reqId === listReqId.current) setListLoading(false);
    }
  }

  const firstLoad = useRef(true);
  useEffect(() => {
    if (!canSee) return;
    loadList({ pickFirst: firstLoad.current && typeof window !== "undefined" && window.innerWidth >= 1024 });
    firstLoad.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fType, fStatus, debouncedQ]);

  /* ---------- detail ---------- */
  function mapDetail(x: any): Movement {
    const linesRaw: any[] = (Array.isArray(x.lines) && x.lines) || (Array.isArray(x.items) && x.items) || [];
    const type: MovementType = String(x.type || "ADJUST").toUpperCase() === "REVALUE" ? "REVALUE" : "ADJUST";
    return {
      id: safeId(x.id),
      refNo: x.refNo ?? x.code ?? "",
      date: normalizeDate(x.occurredAt ?? x.date ?? x.createdAt) || localToday(),
      type,
      warehouseId: safeId(x.warehouseId),
      note: x.note ?? "",
      status: String(x.status ?? (x.posted ? "POSTED" : "DRAFT")).toUpperCase(),
      lines: linesRaw.map((l: any) => ({
        k: uid(),
        id: safeId(l.id),
        itemId: String(l.itemId ?? l.item?.id ?? ""),
        sku: l.item?.sku ?? "",
        itemName: l.item?.name ?? l.itemName ?? "",
        unit: typeof l.item?.unit === "object" ? l.item?.unit?.name : undefined,
        qty: toNum(l.qty),
        unitCost: l.unitCost == null || toNum(l.unitCost) === 0 ? null : toNum(l.unitCost),
        costTotal: l.costTotal == null ? null : toNum(l.costTotal),
        note: l.note ?? "",
      })),
    };
  }

  function setLoaded(mv: Movement | null) {
    setMovement(mv);
    setSnapshot(mv ? JSON.stringify(serialize(mv)) : "");
    setRemovedLineIds([]);
    setShowErrors(false);
  }

  async function loadDetail(id: string) {
    const reqId = ++detailReqId.current;
    setDetailLoading(true);
    try {
      const res = await apiTry([() => api.get(`/movements/${id}`), () => api.get(`/movement/${id}`)]);
      if (reqId !== detailReqId.current) return;
      setLoaded(mapDetail(unwrap<any>(res) || {}));
    } catch (e: any) {
      if (reqId !== detailReqId.current) return;
      setLoaded(null);
      setMsg({ type: "err", text: errMsg(e, "Không tải được chi tiết phiếu.") });
    } finally {
      if (reqId === detailReqId.current) setDetailLoading(false);
    }
  }

  async function confirmLeave() {
    if (!dirty) return true;
    return askConfirm({
      title: "Bỏ thay đổi chưa lưu?",
      body: "Phiếu đang có thay đổi chưa lưu. Nếu rời đi, các thay đổi này sẽ mất.",
      confirmText: "Bỏ thay đổi",
      cancelText: "Ở lại",
      tone: "warning",
    });
  }

  async function selectVoucher(id: string, o?: { force?: boolean }) {
    if (!o?.force && id === selectedId && movement?.id === id) {
      setMobileView("detail");
      return;
    }
    if (!o?.force && !(await confirmLeave())) return;
    setMsg(null);
    setSelectedId(id);
    setMobileView("detail");
    loadDetail(id);
  }

  async function startNew() {
    if (!(await confirmLeave())) return;
    detailReqId.current++;
    setMsg(null);
    setSelectedId(null);
    setLoaded({
      id: null,
      refNo: "",
      date: localToday(),
      type: "ADJUST",
      warehouseId: null,
      note: "",
      status: "DRAFT",
      lines: [],
    });
    setMobileView("detail");
  }

  /* ---------- stock (tồn hiện tại / giá vốn BQ) ---------- */
  const stockKey = (itemId: string) => `${itemId}|${effectiveWh || "*"}`;
  useEffect(() => {
    if (!movement || locked) return;
    const need = Array.from(new Set(movement.lines.map((l) => l.itemId))).filter((id) => id && !stocks[stockKey(id)]);
    if (need.length === 0) return;
    setStocks((s) => {
      const n = { ...s };
      need.forEach((id) => (n[stockKey(id)] = "loading"));
      return n;
    });
    need.forEach(async (itemId) => {
      const key = stockKey(itemId);
      try {
        const params: any = { itemId, pageSize: 50 };
        if (effectiveWh) params.locationId = effectiveWh;
        const res = await api.get("/stocks", { params });
        const arr: any[] = unwrap<any>(res) || [];
        const list = Array.isArray(arr) ? arr : [];
        const qty = list.reduce((s, r) => s + toNum(r.qty), 0);
        const withCost = list.find((r) => toNum(r.avgCost) > 0);
        setStocks((s) => ({ ...s, [key]: { qty, avgCost: withCost ? toNum(withCost.avgCost) : 0 } }));
      } catch {
        setStocks((s) => ({ ...s, [key]: "error" }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movement?.lines, effectiveWh, locked]);

  function stockOf(itemId: string): StockInfo | undefined {
    return stocks[stockKey(itemId)];
  }

  /* ---------- edit ---------- */
  function patchMovement(p: Partial<Movement>) {
    setMovement((m) => (m ? { ...m, ...p } : m));
  }
  function patchLine(k: string, p: Partial<Line>) {
    setMovement((m) => (m ? { ...m, lines: m.lines.map((l) => (l.k === k ? { ...l, ...p } : l)) } : m));
  }
  function removeLine(l: Line) {
    if (l.id) setRemovedLineIds((ids) => [...ids, l.id as string]);
    setMovement((m) => (m ? { ...m, lines: m.lines.filter((x) => x.k !== l.k) } : m));
  }
  const [flashKey, setFlashKey] = useState<string | null>(null);
  function addItem(it: Item) {
    if (!movement) return;
    const existing = movement.lines.find((l) => l.itemId === it.id);
    if (existing) {
      setFlashKey(existing.k);
      setTimeout(() => setFlashKey(null), 1200);
      document.getElementById(`qty-${existing.k}`)?.focus();
      return;
    }
    const k = uid();
    patchMovement({
      lines: [
        ...movement.lines,
        {
          k,
          id: null,
          itemId: it.id,
          sku: it.sku,
          itemName: it.name,
          unit: it.unit,
          qty: movement.type === "REVALUE" ? 0 : 1,
          unitCost: null,
          note: "",
        },
      ],
    });
    setTimeout(() => {
      const el = document.getElementById(movement.type === "REVALUE" ? `cost-${k}` : `qty-${k}`) as HTMLInputElement;
      el?.focus();
      el?.select?.();
    }, 30);
  }

  /* ---------- validation ---------- */
  const lineErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!movement || locked) return errs;
    for (const l of movement.lines) {
      if (!l.itemId) errs[l.k] = "Chưa chọn sản phẩm";
      else if (movement.type === "ADJUST") {
        if (!l.qty) errs[l.k] = "Số lượng phải khác 0";
        else {
          const st = stockOf(l.itemId);
          if (l.qty < 0 && st && typeof st === "object" && st.qty + l.qty < 0)
            errs[l.k] = `Giảm vượt tồn (tồn ${fmtQty(st.qty)})`;
        }
      } else if (!l.unitCost || l.unitCost <= 0) errs[l.k] = "Nhập giá vốn mới";
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movement, locked, stocks]);
  const errorCount = Object.keys(lineErrors).length;

  const summary = useMemo(() => {
    const s = { lines: 0, inc: 0, dec: 0, incValue: 0, valueDiff: 0 };
    if (!movement) return s;
    s.lines = movement.lines.length;
    for (const l of movement.lines) {
      if (movement.type === "ADJUST") {
        if (l.qty > 0) s.inc += l.qty;
        if (l.qty < 0) s.dec += -l.qty;
      } else if (!locked) {
        const st = stockOf(l.itemId);
        if (st && typeof st === "object" && l.unitCost) s.valueDiff += (l.unitCost - st.avgCost) * st.qty;
      }
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movement, stocks, locked]);

  /* ---------- server actions ---------- */
  async function ensureServerMovement(): Promise<string> {
    if (!movement) throw new Error("Không có phiếu.");
    const existing = safeId(movement.id);
    if (existing) return existing;
    const payload = {
      type: movement.type,
      refNo: "",
      note: movement.note ?? "",
      occurredAt: movement.date || localToday(),
      warehouseId: effectiveWh,
    };
    const res = await apiTry([() => api.post("/movements", payload), () => api.post("/movement", payload)]);
    const x = unwrap<any>(res) || {};
    const newId = safeId(x?.id ?? x?.data?.id);
    if (!newId) throw new Error("Tạo phiếu thành công nhưng không nhận được id.");
    // gắn id ngay để nếu lỗi giữa chừng thì lần sau không tạo trùng phiếu
    setMovement((m) => (m ? { ...m, id: newId, refNo: x?.refNo ?? m.refNo } : m));
    setSelectedId(newId);
    return newId;
  }

  async function saveLines(mvId: string) {
    if (!movement) return;
    const orig = snapshot ? JSON.parse(snapshot) : null;
    const origById = new Map<string, any[]>();
    (orig?.lines || []).forEach((l: any[]) => l[0] && origById.set(l[0], l));

    for (const id of removedLineIds) {
      await api.delete(`/movements/lines/${id}`);
    }
    setRemovedLineIds([]);

    for (const l of movement.lines) {
      const payload: any = { itemId: l.itemId, note: l.note ?? "" };
      if (movement.type === "REVALUE") {
        payload.unitCost = toNum(l.unitCost);
      } else {
        payload.qty = l.qty;
        // BE chỉ dùng giá vốn cho dòng TĂNG tồn; dòng giảm luôn theo giá BQ
        payload.unitCost = l.qty > 0 && l.unitCost ? l.unitCost : null;
      }
      if (!l.id) {
        const res = await api.post(`/movements/${mvId}/lines`, payload);
        const created = unwrap<any>(res);
        const newLineId = safeId(created?.id);
        if (newLineId) patchLine(l.k, { id: newLineId });
      } else {
        const o = origById.get(l.id);
        const changed = !o || o[1] !== l.itemId || o[2] !== l.qty || o[3] !== l.unitCost || o[4] !== l.note;
        if (changed) await api.put(`/movements/lines/${l.id}`, payload);
      }
    }
  }

  function validateBeforeSave(forPost: boolean) {
    if (!movement) return false;
    setShowErrors(true);
    if (movement.lines.length === 0) {
      setMsg({ type: "err", text: "Phiếu chưa có sản phẩm nào." });
      return false;
    }
    if (errorCount > 0) {
      setMsg({
        type: "err",
        text: `Còn ${errorCount} dòng chưa hợp lệ (tô đỏ bên dưới). ${forPost ? "Sửa xong mới ghi sổ được." : ""}`,
      });
      return false;
    }
    return true;
  }

  async function handleSaveDraft() {
    if (!movement || locked || !validateBeforeSave(false)) return;
    setBusy(true);
    setMsg(null);
    try {
      const id = await ensureServerMovement();
      await saveLines(id);
      await loadDetail(id);
      await loadList();
      setMsg({ type: "ok", text: "Đã lưu nháp." });
    } catch (e: any) {
      setMsg({ type: "err", text: errMsg(e, "Lưu thất bại.") });
    } finally {
      setBusy(false);
    }
  }

  async function handlePost() {
    if (!movement || locked) return;
    setBusy(true);
    setMsg(null);
    try {
      const id = await ensureServerMovement();
      await saveLines(id);
      await apiTry([() => api.post(`/movements/${id}/post`), () => api.post(`/movement/${id}/post`)]);
      setConfirmPost(false);
      await loadDetail(id);
      await loadList();
      setStocks({}); // tồn đã đổi
      setMsg({ type: "ok", text: "Đã ghi sổ. Tồn kho / giá vốn đã được cập nhật." });
    } catch (e: any) {
      setConfirmPost(false);
      setMsg({ type: "err", text: errMsg(e, "Ghi sổ thất bại.") });
      if (movement.id || selectedId) {
        const id = safeId(movement.id) || selectedId;
        if (id) await loadDetail(id);
      }
    } finally {
      setBusy(false);
    }
  }

  // Ctrl+S = lưu nháp
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (movement && !locked && !busy) handleSaveDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // cảnh báo khi đóng tab lúc chưa lưu
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (!canSee) return <Navigate to="/" replace />;

  const existingIds = new Set((movement?.lines || []).map((l) => l.itemId));
  const whName = (id: string | null) => {
    const l = locations.find((x) => x.id === id) || locations[0];
    return l ? `${l.code ? l.code + " - " : ""}${l.name}` : "Kho mặc định";
  };
  const isNew = !!movement && !movement.id;

  /* ========================= Render ========================= */
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-6.5rem)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Phiếu điều chỉnh tồn / giá vốn</h1>
          <p className="text-xs text-slate-500">Dùng khi kiểm kê lệch, nhập sai mã, hàng hỏng… hoặc cần sửa giá vốn bình quân.</p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700"
        >
          + Tạo phiếu
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* ================= LIST ================= */}
        <section
          className={`flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white ${
            mobileView === "detail" ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="space-y-2 border-b border-slate-100 p-3">
            <input
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              placeholder="Tìm số phiếu hoặc ghi chú…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={fStatus}
                onChange={(v) => setFStatus(v as any)}
                options={[
                  { value: "", label: "Tất cả" },
                  { value: "draft", label: "Nháp" },
                  { value: "posted", label: "Đã ghi sổ" },
                ]}
              />
              <Segmented
                value={fType}
                onChange={(v) => setFType(v as any)}
                options={[
                  { value: "", label: "Mọi loại" },
                  { value: "ADJUST", label: "Tồn" },
                  { value: "REVALUE", label: "Giá vốn" },
                ]}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto max-lg:max-h-[70vh]">
            {listErr ? <div className="m-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{listErr}</div> : null}
            {listLoading && rows.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">Đang tải…</div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">Không có phiếu nào.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r: any) => {
                  const id = safeId(r.id);
                  const active = !!id && id === selectedId;
                  const type: MovementType = String(r.type).toUpperCase() === "REVALUE" ? "REVALUE" : "ADJUST";
                  const st = String(r.status || (r.posted ? "POSTED" : "DRAFT")).toUpperCase();
                  const lines: any[] = Array.isArray(r.lines) ? r.lines : [];
                  const firstName = lines[0]?.item?.name;
                  return (
                    <li key={id || r.refNo}>
                      <button
                        type="button"
                        onClick={() => id && selectVoucher(id)}
                        className={`block w-full border-l-[3px] px-3 py-2.5 text-left transition ${
                          active ? "border-sky-500 bg-sky-50" : "border-transparent hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[13px] font-semibold text-slate-900">
                            {r.refNo || "(chưa có số)"}
                          </span>
                          <StatusBadge status={st} />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                          <span>{viDate(normalizeDate(r.occurredAt ?? r.date ?? r.createdAt))}</span>
                          <TypeBadge type={type} />
                          <span>· {lines.length} dòng</span>
                        </div>
                        {(r.note || firstName) && (
                          <div className="mt-1 truncate text-xs text-slate-600">
                            {r.note || `${firstName}${lines.length > 1 ? ` +${lines.length - 1} SP khác` : ""}`}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
            {listLoading ? "Đang tải…" : `${rows.length}${total > rows.length ? ` / ${total}` : ""} phiếu`}
          </div>
        </section>

        {/* ================= DETAIL ================= */}
        <section
          className={`min-h-0 flex-col rounded-xl border border-slate-200 bg-white ${
            mobileView === "list" ? "hidden lg:flex" : "flex"
          }`}
        >
          {!movement ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center text-sm text-slate-500">
              {detailLoading ? (
                "Đang tải phiếu…"
              ) : (
                <>
                  <div>Chọn một phiếu bên trái để xem, hoặc tạo phiếu mới.</div>
                  <button
                    type="button"
                    onClick={startNew}
                    className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 font-semibold text-sky-700"
                  >
                    + Tạo phiếu
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* ---------- header ---------- */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
                <button
                  type="button"
                  onClick={async () => (await confirmLeave()) && setMobileView("list")}
                  className="rounded-md px-1.5 py-1 text-sm text-slate-500 hover:bg-slate-100 lg:hidden"
                >
                  ← DS
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-bold text-slate-900">
                      {isNew ? "Phiếu mới" : movement.refNo || "(chưa có số)"}
                    </span>
                    <StatusBadge status={movement.status} />
                    {!isNew && <TypeBadge type={movement.type} />}
                    {dirty && <span className="text-xs font-medium text-amber-600">● chưa lưu</span>}
                    {detailLoading && <span className="text-xs text-slate-400">đang tải…</span>}
                  </div>
                </div>
                {!locked && (
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSaveDraft}
                      title="Ctrl+S"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Lưu nháp
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => validateBeforeSave(true) && setConfirmPost(true)}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Ghi sổ
                    </button>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
                {locked && (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    🔒 Phiếu đã ghi sổ — chỉ xem. Nếu cần sửa, tạo phiếu điều chỉnh mới để bù lại.
                  </div>
                )}

                {/* ---------- chọn loại (chỉ khi phiếu mới) ---------- */}
                {isNew && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["ADJUST", "Điều chỉnh tồn", "Tăng / giảm số lượng tồn (kiểm kê lệch, hỏng, nhập sai mã…)"],
                        ["REVALUE", "Điều chỉnh giá vốn", "Giữ nguyên số lượng, đặt lại giá vốn bình quân"],
                      ] as [MovementType, string, string][]
                    ).map(([t, title, desc]) => {
                      const on = movement.type === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={async () => {
                            if (t === movement.type) return;
                            if (
                              movement.lines.length &&
                              !(await askConfirm({
                                title: "Đổi loại phiếu?",
                                body: `Đổi sang "${t === "REVALUE" ? "Điều chỉnh giá vốn" : "Điều chỉnh tồn"}" sẽ xoá ${movement.lines.length} dòng đã nhập.`,
                                confirmText: "Đổi loại",
                                tone: "danger",
                              }))
                            )
                              return;
                            patchMovement({ type: t, lines: [] });
                          }}
                          className={`rounded-xl border-2 p-3 text-left transition ${
                            on ? "border-sky-500 bg-sky-50" : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            <span
                              className={`h-3.5 w-3.5 rounded-full border-2 ${on ? "border-sky-500 bg-sky-500" : "border-slate-300"}`}
                            />
                            {title}
                          </div>
                          <div className="mt-1 pl-5 text-xs text-slate-500">{desc}</div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ---------- thông tin phiếu ---------- */}
                {isNew ? (
                  <div className="grid gap-3 sm:grid-cols-[160px_1fr] lg:grid-cols-[160px_220px_1fr]">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Ngày phát sinh</span>
                      <input
                        type="date"
                        value={movement.date}
                        onChange={(e) => patchMovement({ date: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </label>
                    {locations.length > 1 ? (
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">Kho</span>
                        <select
                          value={movement.warehouseId || locations[0]?.id || ""}
                          onChange={(e) => {
                            if (movement.lines.length) setStocks({});
                            patchMovement({ warehouseId: safeId(e.target.value) });
                          }}
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                        >
                          {locations.map((l) => (
                            <option key={l.id} value={l.id}>
                              {(l.code ? `${l.code} - ` : "") + l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="hidden lg:block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600">Kho</span>
                        <div className="py-1.5 text-sm text-slate-700">{whName(null)}</div>
                      </div>
                    )}
                    <label className="block sm:col-span-1 lg:col-span-1 max-sm:col-span-full">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Lý do / ghi chú</span>
                      <input
                        value={movement.note}
                        onChange={(e) => patchMovement({ note: e.target.value })}
                        placeholder="VD: Kiểm kê tháng 10 lệch, xoá mã tạo nhầm…"
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </label>
                    <p className="col-span-full -mt-1 text-[11px] text-slate-400">
                      Ngày, kho và ghi chú phiếu sẽ cố định sau lần lưu đầu tiên.
                    </p>
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-4 py-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-slate-500">Ngày phát sinh</dt>
                      <dd className="font-semibold text-slate-800">{viDate(movement.date)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Loại</dt>
                      <dd className="font-semibold text-slate-800">{TYPE_LABEL[movement.type]}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Kho</dt>
                      <dd className="truncate font-semibold text-slate-800">{whName(movement.warehouseId)}</dd>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <dt className="text-xs text-slate-500">Ghi chú</dt>
                      <dd className="truncate text-slate-800" title={movement.note}>
                        {movement.note || <span className="text-slate-400">—</span>}
                      </dd>
                    </div>
                  </dl>
                )}

                {/* ---------- dòng sản phẩm ---------- */}
                <div className="rounded-xl border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                    <div className="text-sm font-bold text-slate-900">
                      Sản phẩm <span className="font-normal text-slate-400">({movement.lines.length})</span>
                    </div>
                    {!locked && (
                      <div className="text-[11px] text-slate-500">
                        {isRevalue
                          ? "Nhập giá vốn mới cho từng SP. Số lượng tồn giữ nguyên."
                          : "Chọn Tăng/Giảm rồi nhập số lượng. Giá vốn chỉ áp dụng cho dòng Tăng."}
                      </div>
                    )}
                  </div>

                  {!locked && (
                    <div className="border-b border-slate-100 p-3">
                      <ItemPicker items={items} existingIds={existingIds} onPick={addItem} />
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    {movement.lines.length === 0 ? (
                      <div className="p-6 text-center text-sm text-slate-400">
                        {locked ? "Phiếu không có dòng nào." : "Chưa có sản phẩm. Gõ mã/tên ở ô phía trên để thêm."}
                      </div>
                    ) : (
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                          <tr>
                            <th className="w-8 px-3 py-2">#</th>
                            <th className="px-3 py-2">Sản phẩm</th>
                            {locked ? (
                              <>
                                {!isRevalue && <th className="px-3 py-2 text-right">SL điều chỉnh</th>}
                                <th className="px-3 py-2 text-right">{isRevalue ? "Giá vốn mới" : "Đơn giá vốn"}</th>
                                {!isRevalue && <th className="px-3 py-2 text-right">Giá trị</th>}
                              </>
                            ) : isRevalue ? (
                              <>
                                <th className="px-3 py-2 text-right">Tồn</th>
                                <th className="px-3 py-2 text-right">Giá vốn hiện tại</th>
                                <th className="w-40 px-3 py-2 text-right">Giá vốn mới</th>
                                <th className="px-3 py-2 text-right">Chênh lệch giá trị</th>
                              </>
                            ) : (
                              <>
                                <th className="px-3 py-2 text-right">Tồn hiện tại</th>
                                <th className="w-48 px-3 py-2 text-center">Điều chỉnh</th>
                                <th className="px-3 py-2 text-right">Tồn sau</th>
                                <th className="w-40 px-3 py-2 text-right">Giá vốn nhập</th>
                              </>
                            )}
                            <th className="px-3 py-2">Ghi chú</th>
                            {!locked && <th className="w-10" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {movement.lines.map((l, idx) => {
                            const st = stockOf(l.itemId);
                            const stObj = st && typeof st === "object" ? st : null;
                            const err = showErrors || l.id ? lineErrors[l.k] : undefined;
                            const softErr = lineErrors[l.k];
                            const sign = l.qty < 0 ? -1 : 1;
                            const absQty = Math.abs(l.qty);
                            return (
                              <tr
                                key={l.k}
                                className={`align-top transition-colors ${
                                  flashKey === l.k ? "bg-amber-50" : err ? "bg-rose-50/50" : ""
                                }`}
                              >
                                <td className="px-3 py-2.5 text-xs text-slate-400">{idx + 1}</td>
                                <td className="px-3 py-2.5">
                                  <div className="font-medium text-slate-900">{l.itemName || "—"}</div>
                                  <div className="text-xs text-slate-500">
                                    {l.sku ? <span className="font-mono">{l.sku}</span> : null}
                                    {l.unit ? <span> · {l.unit}</span> : null}
                                  </div>
                                  {softErr && (
                                    <div className={`mt-0.5 text-xs font-medium ${err ? "text-rose-600" : "text-amber-600"}`}>
                                      {softErr}
                                    </div>
                                  )}
                                </td>

                                {locked ? (
                                  <>
                                    {!isRevalue && (
                                      <td
                                        className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                                          l.qty < 0 ? "text-rose-600" : "text-emerald-600"
                                        }`}
                                      >
                                        {fmtSigned(l.qty)}
                                      </td>
                                    )}
                                    <td className="px-3 py-2.5 text-right tabular-nums">
                                      {l.unitCost ? fmtMoney(l.unitCost) : <span className="text-slate-400">BQ</span>}
                                    </td>
                                    {!isRevalue && (
                                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                                        {l.costTotal != null ? fmtMoney(l.costTotal) : "—"}
                                      </td>
                                    )}
                                  </>
                                ) : isRevalue ? (
                                  <>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                                      {st === "loading" ? "…" : stObj ? fmtQty(stObj.qty) : "—"}
                                    </td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                                      {stObj ? fmtMoney(stObj.avgCost) : st === "loading" ? "…" : "—"}
                                    </td>
                                    <td className="px-3 py-2">
                                        <MoneyInput
                                          id={`cost-${l.k}`}
                                          value={l.unitCost}
                                          invalid={!!err}
                                          placeholder="Giá mới"
                                          onChange={(v) => patchLine(l.k, { unitCost: v })}
                                        />
                                    </td>
                                    <td className="px-3 py-2.5 text-right tabular-nums">
                                      {stObj && l.unitCost ? (
                                        <span
                                          className={
                                            (l.unitCost - stObj.avgCost) * stObj.qty < 0 ? "text-rose-600" : "text-emerald-600"
                                          }
                                        >
                                          {(l.unitCost - stObj.avgCost) * stObj.qty > 0 ? "+" : ""}
                                          {fmtMoney((l.unitCost - stObj.avgCost) * stObj.qty)}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                                      {st === "loading" ? "…" : stObj ? fmtQty(stObj.qty) : "—"}
                                    </td>
                                    <td className="px-3 py-2">
                                      <div className="flex items-stretch justify-center">
                                        <div className="inline-flex overflow-hidden rounded-l-lg border border-r-0 border-slate-300">
                                          <button
                                            type="button"
                                            onClick={() => patchLine(l.k, { qty: absQty || 1 })}
                                            className={`px-2.5 text-xs font-bold ${
                                              sign > 0 ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                                            }`}
                                          >
                                            Tăng
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => patchLine(l.k, { qty: -(absQty || 1) })}
                                            className={`px-2.5 text-xs font-bold ${
                                              sign < 0 ? "bg-rose-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
                                            }`}
                                          >
                                            Giảm
                                          </button>
                                        </div>
                                        <input
                                          id={`qty-${l.k}`}
                                          inputMode="decimal"
                                          value={absQty ? String(absQty) : ""}
                                          onChange={(e) => {
                                            const raw = e.target.value.replace(",", ".");
                                            // gõ "-5" cũng hiểu là giảm 5
                                            const neg = raw.trim().startsWith("-");
                                            const n = Math.abs(toNum(raw.replace(/[^\d.]/g, "")));
                                            const s = neg ? -1 : sign;
                                            patchLine(l.k, { qty: s * n });
                                          }}
                                          className={`w-16 rounded-r-lg border px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 ${
                                            err && !l.qty ? "border-rose-300 focus:ring-rose-200" : "border-slate-300 focus:ring-sky-100"
                                          }`}
                                        />
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                                      {stObj ? (
                                        <span className={stObj.qty + l.qty < 0 ? "text-rose-600" : "text-slate-900"}>
                                          {fmtQty(stObj.qty + l.qty)}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2">
                                      {l.qty > 0 ? (
                                        <MoneyInput
                                          value={l.unitCost}
                                          placeholder={stObj?.avgCost ? `BQ ${fmtMoney(stObj.avgCost)}` : "Tuỳ chọn"}
                                          onChange={(v) => patchLine(l.k, { unitCost: v })}
                                        />
                                      ) : (
                                        <div
                                          className="py-1.5 text-right text-xs text-slate-400"
                                          title="Dòng giảm tồn luôn xuất theo giá vốn bình quân hiện tại"
                                        >
                                          Theo giá BQ{stObj?.avgCost ? ` (${fmtMoney(stObj.avgCost)})` : ""}
                                        </div>
                                      )}
                                    </td>
                                  </>
                                )}

                                <td className="px-3 py-2">
                                  {locked ? (
                                    <span className="text-slate-600">{l.note || "—"}</span>
                                  ) : (
                                    <input
                                      value={l.note}
                                      onChange={(e) => patchLine(l.k, { note: e.target.value })}
                                      placeholder="Ghi chú…"
                                      className="w-full min-w-[140px] rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                    />
                                  )}
                                </td>
                                {!locked && (
                                  <td className="px-2 py-2">
                                    <button
                                      type="button"
                                      onClick={() => removeLine(l)}
                                      title="Xoá dòng"
                                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                                      </svg>
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {movement.lines.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
                      <span>
                        <b className="text-slate-900">{summary.lines}</b> sản phẩm
                      </span>
                      {!isRevalue ? (
                        <>
                          {summary.inc > 0 && (
                            <span>
                              Tăng: <b className="text-emerald-600">+{fmtQty(summary.inc)}</b>
                            </span>
                          )}
                          {summary.dec > 0 && (
                            <span>
                              Giảm: <b className="text-rose-600">−{fmtQty(summary.dec)}</b>
                            </span>
                          )}
                        </>
                      ) : !locked ? (
                        <span>
                          Chênh lệch giá trị tồn ước tính:{" "}
                          <b className={summary.valueDiff < 0 ? "text-rose-600" : "text-emerald-600"}>
                            {summary.valueDiff > 0 ? "+" : ""}
                            {fmtMoney(summary.valueDiff)}
                          </b>
                        </span>
                      ) : null}
                      {!locked && errorCount > 0 && (
                        <span className="ml-auto font-semibold text-rose-600">{errorCount} dòng cần sửa</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <Toast msg={msgState} onClose={closeMsg} />

      <ConfirmDialog
        open={!!ask}
        title={ask?.title || ""}
        confirmText={ask?.confirmText || "OK"}
        cancelText={ask?.cancelText}
        tone={ask?.tone}
        onCancel={() => closeAsk(false)}
        onConfirm={() => closeAsk(true)}
      >
        {ask?.body}
      </ConfirmDialog>

      <style>{`
        @keyframes mvFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes mvPop { from { opacity: 0; transform: translateY(6px) scale(.98) } to { opacity: 1; transform: none } }
        @keyframes mvSlide { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: none } }
        .mv-fade { animation: mvFade .15s ease-out }
        .mv-pop { animation: mvPop .18s ease-out }
        .mv-slide { animation: mvSlide .2s ease-out }
      `}</style>

      <ConfirmDialog
        open={confirmPost}
        title="Ghi sổ phiếu điều chỉnh?"
        confirmText="Ghi sổ"
        busy={busy}
        onCancel={() => setConfirmPost(false)}
        onConfirm={handlePost}
      >
        <ul className="space-y-1">
          <li>
            Loại: <b>{movement ? TYPE_LABEL[movement.type] : ""}</b> · {summary.lines} sản phẩm
          </li>
          {!isRevalue ? (
            <li>
              {summary.inc > 0 && (
                <span className="mr-3">
                  Tăng <b className="text-emerald-600">+{fmtQty(summary.inc)}</b>
                </span>
              )}
              {summary.dec > 0 && (
                <span>
                  Giảm <b className="text-rose-600">−{fmtQty(summary.dec)}</b>
                </span>
              )}
            </li>
          ) : (
            <li>
              Chênh lệch giá trị tồn ước tính: <b>{fmtMoney(summary.valueDiff)}</b>
            </li>
          )}
        </ul>
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Sau khi ghi sổ, tồn kho / giá vốn được cập nhật ngay và phiếu không sửa được nữa.
        </p>
      </ConfirmDialog>
    </div>
  );
};

export default MovementsPage;