// src/pages/CashbookPage.tsx
// ✅ THU CHI / SỔ QUỸ
// Bố cục: cột trái là danh sách quỹ / tài khoản (như ví), bên phải là tài khoản đang chọn:
//   số dư + đường số dư theo ngày + thao tác, rồi sổ chi tiết gom theo ngày (thu / chi / số dư).
// Màu chỉ dùng cho chiều tiền: thu = teal, chi = rose. Quỹ tiền mặt có dấu hiệu riêng (màu đồng).
// Huỷ phiếu bắt buộc mật khẩu cấp 2 (VoidPaymentDialog, server kiểm tra).
// API: /cashbook/*, PATCH /payments/:id/account, POST /payments/:id/void
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ToastHost, useToast } from "../components/Toast";
import { DialogShell, PinActionDialog, PinSettingsDialog, VoidPaymentDialog, type VoidTarget } from "../components/SecondPassword";

/* ========================= types ========================= */
type AccSum = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  openingBalance: number;
  openingDate: string | null;
  opening: number;
  thu: number;
  chi: number;
  closing: number;
};
type Summary = {
  from: string;
  to: string;
  accounts: AccSum[];
  total: { opening: number; thu: number; chi: number; closing: number };
  unassigned: { count: number; thuInRange: number; chiInRange: number };
};
type LedgerRow = {
  id: string;
  code: string | null;
  date: string;
  type: "RECEIPT" | "PAYMENT";
  category: "INVOICE" | "OTHER" | "TRANSFER" | "CASH_COUNT";
  amount: number;
  account: { id: string; code: string; name: string; type: string } | null;
  partner: { id: string; name: string } | null;
  personName: string | null;
  subject: string | null;
  note: string | null;
  refNo: string | null;
  invoices: Array<{ id: string; code: string }>;
  counterAccount: { id: string; code: string; name: string } | null;
  createdBy: string | null;
  voided: boolean;
  voidReason: string | null;
  voidedBy: string | null;
  balance: number | null;
};
type Ledger = {
  account: { id: string; code: string; name: string; type: string; openingDate: string | null } | null;
  filtered: boolean;
  opening: number | null;
  thu: number;
  chi: number;
  closing: number | null;
  rows: LedgerRow[];
};

/* ========================= helpers ========================= */
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }); // giống cả app: 1,200,000
const money = (n: number) => nf.format(Math.round(n || 0));
const viDate = (ymd?: string | null) => (ymd ? ymd.split("-").reverse().join("/") : "");
const vnToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const WEEKDAY = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
const weekday = (ymd: string) => WEEKDAY[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function shiftMonth(ymd: string, delta: number) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}
function monthEnd(firstYmd: string) {
  const [y, m] = firstYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const errMsg = (e: any, f: string) => e?.response?.data?.message || e?.message || f;
const isCash = (t?: string) => t === "CASH";
const CAT_LABEL: Record<string, string> = {
  INVOICE: "Theo hoá đơn",
  OTHER: "Thu chi khác",
  TRANSFER: "Chuyển quỹ",
  CASH_COUNT: "Kiểm quỹ",
};
const SUBJECTS_THU = ["Thu khác", "Thu thanh lý", "Thu hoàn ứng", "Thu lãi ngân hàng", "Góp vốn"];
const SUBJECTS_CHI = [
  "Chi phí vận chuyển",
  "Điện nước",
  "Lương, thưởng",
  "Tạm ứng",
  "Văn phòng phẩm",
  "Tiếp khách",
  "Sửa chữa, bảo trì",
  "Phí ngân hàng",
  "Thuê mặt bằng",
  "Chi khác",
];

/* ========================= tiny UI ========================= */
const inputBase =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-700 focus:ring-4 focus:ring-slate-200";
const inputCls = `w-full ${inputBase}`;
const labelCls = "mb-1 block text-sm font-medium text-slate-700";
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500";

// ✅ icon nhỏ cho 2 nút thao tác trên từng phiếu
const RowIcon = {
  swap: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
    </svg>
  ),
  void: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M5.7 5.7l12.6 12.6" />
    </svg>
  ),
};
const rowBtnBase = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors";
const rowBtnAcc = `${rowBtnBase} border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50`;
const rowBtnVoid = `${rowBtnBase} border-rose-200 bg-white text-rose-700 hover:border-rose-300 hover:bg-rose-50`;

const Icon = {
  cash: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5v5M18 9.5v5" />
    </svg>
  ),
  bank: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20.5h17" />
    </svg>
  ),
  all: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 14h3" />
    </svg>
  ),
  in: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  ),
  out: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  transfer: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 8h14l-4-4M20 16H6l4 4" />
    </svg>
  ),
  count: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    </svg>
  ),
  lock: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
};

const MoneyInput: React.FC<{ value: number; onChange: (n: number) => void; autoFocus?: boolean; placeholder?: string; large?: boolean }> = ({
  value,
  onChange,
  autoFocus,
  placeholder,
  large,
}) => (
  <div className="relative">
    <input
      className={`${inputCls} pr-8 text-right tabular-nums ${large ? "py-2.5 text-lg font-semibold" : ""}`}
      inputMode="numeric"
      autoFocus={autoFocus}
      placeholder={placeholder || "0"}
      value={value ? money(value) : ""}
      onChange={(e) => onChange(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
    />
    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">đ</span>
  </div>
);

const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "dark" | "in" | "out" | "ghost"; icon?: React.ReactNode }> = ({
  variant = "ghost",
  icon,
  className = "",
  children,
  ...p
}) => {
  const v =
    variant === "dark"
      ? "bg-slate-900 text-white hover:bg-slate-800"
      : variant === "in"
      ? "bg-teal-700 text-white hover:bg-teal-800"
      : variant === "out"
      ? "bg-rose-700 text-white hover:bg-rose-800"
      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${v} ${focusRing} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
};

const AccountSelect: React.FC<{ accounts: AccSum[]; value: string; onChange: (v: string) => void; exclude?: string; onlyCash?: boolean }> = ({
  accounts,
  value,
  onChange,
  exclude,
  onlyCash,
}) => (
  <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">Chọn quỹ hoặc tài khoản</option>
    {accounts
      .filter((a) => a.isActive && a.id !== exclude && (!onlyCash || isCash(a.type)))
      .map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.code}) – số dư {money(a.closing)} đ
        </option>
      ))}
  </select>
);

/* ========================= đường tồn quỹ ========================= */
type TrendPoint = { d: string; v: number };
const Sparkline: React.FC<{ points: TrendPoint[] }> = ({ points }) => {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  if (points.length < 2) return null;
  const W = 320;
  const H = 72;
  const pad = 4;
  const vals = points.map((p) => p.v);
  const min = Math.min(0, ...vals); // đáy = 0: chiều cao đường thể hiện đúng lượng tiền
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - pad * 2)) / (points.length - 1);
  const y = (v: number) => pad + (H - pad * 2) * (1 - (v - min) / span);
  // đường bậc thang: tồn giữ nguyên tới khi có phiếu ngày sau
  let d = `M ${x(0)} ${y(points[0].v)}`;
  for (let i = 1; i < points.length; i++) d += ` H ${x(i)} V ${y(points[i].v)}`;
  const area = `${d} V ${H - pad} H ${x(0)} Z`;
  const hasNeg = min < 0;
  const hp = hover != null ? points[hover] : null;

  return (
    <div
      ref={boxRef}
      className="relative w-full select-none"
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = boxRef.current?.getBoundingClientRect();
        if (!r) return;
        const rel = ((e.clientX - r.left) / r.width) * W;
        const i = Math.round(((rel - pad) / (W - pad * 2)) * (points.length - 1));
        setHover(Math.max(0, Math.min(points.length - 1, i)));
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[72px] w-full" role="img" aria-label="Số dư cuối ngày trong kỳ">
        <path d={area} fill="#0f172a" opacity="0.05" />
        {hasNeg && <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#be123c" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        <path d={d} fill="none" stroke="#0f172a" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hp && <line x1={x(hover!)} x2={x(hover!)} y1={pad} y2={H - pad} stroke="#94a3b8" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* chấm cuối + chấm hover (HTML để không bị méo theo viewBox) */}
      {[hover ?? points.length - 1].map((i) => (
        <span
          key={i}
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
          style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(points[i].v) / H) * 72}px` }}
        />
      ))}
      {hp && (
        <div
          className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: `${Math.min(85, Math.max(15, (x(hover!) / W) * 100))}%` }}
        >
          {viDate(hp.d)}: <span className="font-semibold tabular-nums">{money(hp.v)} đ</span>
        </div>
      )}
      {hasNeg && <span className="absolute right-0 text-[10px] text-rose-700" style={{ top: `${(y(0) / H) * 72 - 14}px` }}>0</span>}
    </div>
  );
};

function buildTrend(opening: number, rows: LedgerRow[], from: string, to: string): TrendPoint[] {
  const today = vnToday();
  const end = to < today ? to : today;
  if (end < from) return [];
  const net = new Map<string, number>();
  for (const r of rows) {
    if (r.voided) continue;
    net.set(r.date, (net.get(r.date) || 0) + (r.type === "RECEIPT" ? r.amount : -r.amount));
  }
  const pts: TrendPoint[] = [];
  let bal = opening;
  for (let d = from; d <= end; d = addDays(d, 1)) {
    bal += net.get(d) || 0;
    pts.push({ d, v: bal });
    if (pts.length > 400) break;
  }
  return pts;
}

/* ========================= page ========================= */
const CashbookPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "") === "admin";
  const toast = useToast();

  const today = vnToday();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sel, setSel] = useState<string>("");
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [fType, setFType] = useState<"" | "RECEIPT" | "PAYMENT">("");
  const [fCat, setFCat] = useState("");
  const [fQ, setFQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [showVoided, setShowVoided] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(fQ), 350);
    return () => clearTimeout(t);
  }, [fQ]);
  const filtering = !!(fType || fCat || qDebounced.trim());

  const pickedDefault = useRef(false);
  const loadSummary = useCallback(async () => {
    const res = await api.get("/cashbook/summary", { params: { from, to } });
    const s: Summary = res.data;
    setSummary(s);
    if (!pickedDefault.current) {
      pickedDefault.current = true;
      const cash = s.accounts.find((a) => isCash(a.type) && a.isActive);
      if (cash) {
        setSel(cash.id);
        return { switched: true };
      }
    }
    return { switched: false };
  }, [from, to]);

  const loadLedger = useCallback(async () => {
    const base: any = { from, to };
    if (sel) base.accountId = sel;
    const params: any = { ...base };
    if (fType) params.type = fType;
    if (fCat) params.category = fCat;
    if (qDebounced.trim()) params.q = qDebounced.trim();
    if (showVoided) params.voided = 1;
    const res = await api.get("/cashbook/ledger", { params });
    const lg: Ledger = res.data;
    setLedger(lg);
    // đường tồn quỹ cần sổ KHÔNG lọc của 1 tài khoản
    if (sel) {
      const full: Ledger = filtering || showVoided ? (await api.get("/cashbook/ledger", { params: base })).data : lg;
      setTrend(buildTrend(full.opening ?? 0, full.rows, from, to));
    } else setTrend([]);
  }, [from, to, sel, fType, fCat, qDebounced, showVoided, filtering]);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { switched } = await loadSummary();
      if (!switched) await loadLedger();
    } catch (e: any) {
      setErr(errMsg(e, "Không tải được sổ quỹ."));
    } finally {
      setLoading(false);
    }
  }, [loadSummary, loadLedger]);

  useEffect(() => {
    reload();
  }, [reload]);

  const accounts = useMemo(() => {
    const list = summary?.accounts ?? [];
    return [...list].sort((a, b) => (isCash(a.type) === isCash(b.type) ? a.name.localeCompare(b.name) : isCash(a.type) ? -1 : 1));
  }, [summary]);
  const selAcc = accounts.find((a) => a.id === sel) || null;
  const head = selAcc ?? (summary ? { ...summary.total, name: "Tất cả quỹ và tài khoản" } : null);

  /* ---------- modals ---------- */
  type VoucherForm = { type: "RECEIPT" | "PAYMENT"; date: string; accountId: string; amount: number; personName: string; subject: string; note: string; refNo: string };
  const [voucher, setVoucher] = useState<VoucherForm | null>(null);
  const [transfer, setTransfer] = useState<{ date: string; fromAccountId: string; toAccountId: string; amount: number; note: string; refNo: string } | null>(null);
  const [count, setCount] = useState<{ accountId: string; date: string; actual: number; reason: string; book: number | null } | null>(null);
  const [opening, setOpening] = useState<{ acc: AccSum; amount: number; date: string; enabled: boolean } | null>(null);
  const [changeAcc, setChangeAcc] = useState<{ row: LedgerRow; accountId: string } | null>(null);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const defaultCashId = accounts.find((a) => isCash(a.type) && a.isActive)?.id || "";
  const defaultAccId = (selAcc?.isActive ? selAcc.id : "") || defaultCashId;
  const openVoucher = (type: "RECEIPT" | "PAYMENT") => {
    setFormErr(null);
    setVoucher({ type, date: today, accountId: defaultAccId, amount: 0, personName: "", subject: "", note: "", refNo: "" });
  };
  const openTransfer = () => {
    setFormErr(null);
    const fromId = selAcc?.isActive ? selAcc.id : defaultCashId;
    const other = accounts.find((a) => a.isActive && a.id !== fromId && isCash(a.type) !== isCash(accounts.find((x) => x.id === fromId)?.type));
    setTransfer({ date: today, fromAccountId: fromId, toAccountId: other?.id || "", amount: 0, note: "", refNo: "" });
  };
  const openCount = () => {
    setFormErr(null);
    setCount({ accountId: (selAcc && isCash(selAcc.type) ? selAcc.id : "") || defaultCashId, date: today, actual: 0, reason: "", book: null });
  };

  useEffect(() => {
    if (!count?.accountId || !count.date) return;
    let alive = true;
    api
      .get("/cashbook/balance", { params: { accountId: count.accountId, date: count.date } })
      .then((r) => alive && setCount((c) => (c ? { ...c, book: Number(r.data?.balance ?? 0) } : c)))
      .catch(() => alive && setCount((c) => (c ? { ...c, book: null } : c)));
    return () => {
      alive = false;
    };
  }, [count?.accountId, count?.date]);

  async function run(fn: () => Promise<void>, okMsg: string | (() => string), close: () => void) {
    setBusy(true);
    setFormErr(null);
    try {
      await fn();
      close();
      toast.push({ type: "success", title: "Đã lưu", message: typeof okMsg === "function" ? okMsg() : okMsg });
      await reload();
    } catch (e: any) {
      setFormErr(errMsg(e, "Thao tác thất bại."));
    } finally {
      setBusy(false);
    }
  }

  const submitVoucher = () => {
    if (!voucher) return;
    if (!voucher.accountId) return setFormErr("Chọn quỹ hoặc tài khoản.");
    if (!voucher.amount) return setFormErr("Nhập số tiền.");
    if (!voucher.note.trim()) return setFormErr("Ghi nội dung thu chi.");
    let code = "";
    run(
      async () => {
        const r = await api.post("/cashbook/vouchers", voucher);
        code = String(r.data?.code || "");
      },
      () => `${voucher.type === "RECEIPT" ? "Đã lập phiếu thu" : "Đã lập phiếu chi"}${code ? ` ${code}` : ""}.`,
      () => setVoucher(null)
    );
  };
  const submitTransfer = () => {
    if (!transfer) return;
    if (!transfer.fromAccountId || !transfer.toAccountId) return setFormErr("Chọn nơi chuyển đi và nơi nhận.");
    if (transfer.fromAccountId === transfer.toAccountId) return setFormErr("Nơi chuyển đi và nơi nhận phải khác nhau.");
    if (!transfer.amount) return setFormErr("Nhập số tiền.");
    run(async () => void (await api.post("/cashbook/transfers", transfer)), "Đã chuyển quỹ.", () => setTransfer(null));
  };
  const countDiff = count && count.book != null ? count.actual - count.book : null;
  const countMismatch = countDiff != null && Math.abs(countDiff) >= 0.5;
  const submitCount = () => {
    if (!count) return;
    if (!count.accountId) return setFormErr("Chọn quỹ tiền mặt.");
    if (countMismatch && count.reason.trim().length < 3) return setFormErr("Ghi lý do chênh lệch.");
    run(
      async () => void (await api.post("/cashbook/cash-counts", { accountId: count.accountId, date: count.date, actualAmount: count.actual, reason: count.reason })),
      countMismatch ? "Đã ghi phiếu chênh lệch kiểm quỹ." : "Tiền thực tế khớp sổ.",
      () => setCount(null)
    );
  };
  const submitOpening = () => {
    if (!opening) return;
    if (opening.enabled && !opening.date) return setFormErr("Chọn ngày bắt đầu sổ.");
    run(
      async () =>
        void (await api.put(`/cashbook/accounts/${opening.acc.id}/opening`, {
          openingBalance: opening.enabled ? opening.amount : 0,
          openingDate: opening.enabled ? opening.date : null,
        })),
      "Đã lưu số dư đầu kỳ.",
      () => setOpening(null)
    );
  };
  // ✅ chọn xong tài khoản mới -> nhập mật khẩu cấp 2 rồi mới đổi
  const [changeAccPin, setChangeAccPin] = useState(false);
  const submitChangeAcc = () => {
    if (!changeAcc?.accountId) return setFormErr("Chọn tài khoản mới.");
    setFormErr(null);
    setChangeAccPin(true);
  };
  const doChangeAccWithPin = async (pin: string) => {
    if (!changeAcc) return;
    try {
      await api.patch(`/payments/${changeAcc.row.id}/account`, { accountId: changeAcc.accountId, pin });
    } catch (e: any) {
      const code = e?.response?.data?.code;
      if (code && String(code).startsWith("PIN_")) throw e; // hộp mật khẩu tự xử lý
      setChangeAccPin(false);
      setFormErr(errMsg(e, "Không đổi được tài khoản."));
      return;
    }
    setChangeAccPin(false);
    toast.push({ type: "success", title: "Đã lưu", message: `Đã chuyển phiếu ${changeAcc.row.code || ""} sang tài khoản mới.` });
    setChangeAcc(null);
    await reload();
  };

  const presets: Array<{ label: string; from: string; to: string }> = [
    { label: "Hôm nay", from: today, to: today },
    { label: "Tháng này", from: today.slice(0, 8) + "01", to: today },
    { label: "Tháng trước", from: shiftMonth(today, -1), to: monthEnd(shiftMonth(today, -1)) },
    { label: "Năm nay", from: today.slice(0, 4) + "-01-01", to: today },
  ];

  /* ---------- ledger grouped by day ---------- */
  const rows = ledger?.rows ?? [];
  const showBalance = !!ledger?.account && !ledger.filtered;
  const days = useMemo(() => {
    const m = new Map<string, LedgerRow[]>();
    for (const r of rows) {
      const arr = m.get(r.date) || [];
      arr.push(r);
      m.set(r.date, arr);
    }
    return Array.from(m, ([d, list]) => {
      const live = list.filter((r) => !r.voided);
      const thu = live.filter((r) => r.type === "RECEIPT").reduce((s, r) => s + r.amount, 0);
      const chi = live.filter((r) => r.type === "PAYMENT").reduce((s, r) => s + r.amount, 0);
      const last = [...live].reverse().find((r) => r.balance != null);
      return { d, list, thu, chi, end: last?.balance ?? null };
    }).reverse(); // ngày mới nhất lên trên
  }, [rows]);

  const ledgerCols = showBalance
    ? "grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[32px_minmax(0,1fr)_120px_120px_130px_176px]"
    : "grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[32px_minmax(0,1fr)_120px_120px_176px]";

  /* ========================= render ========================= */
  return (
    <div className="mx-auto max-w-[1440px] space-y-4 pb-10">
      {/* page head */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Thu chi</h1>
          <p className="mt-0.5 text-sm text-slate-500">Mọi khoản tiền vào, ra quỹ tiền mặt và tài khoản ngân hàng đều đi qua phiếu.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Chọn nhanh kỳ">
            {presets.map((p) => {
              const on = p.from === from && p.to === to;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setFrom(p.from);
                    setTo(p.to);
                  }}
                  className={`rounded-md px-2.5 py-1.5 text-sm ${on ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"} ${focusRing}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" aria-label="Từ ngày" className={inputBase} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <span className="text-slate-400">–</span>
            <input type="date" aria-label="Đến ngày" className={inputBase} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* ================= rail ================= */}
        <aside className="lg:sticky lg:top-0 lg:self-start">
          <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-col lg:gap-1">
            {[{ id: "", name: "Tất cả", code: "", type: "ALL", closing: summary?.total.closing ?? 0, openingDate: null, isActive: true } as any, ...accounts].map((a: any) => {
              const on = sel === a.id;
              const cash = isCash(a.type);
              const noOpen = cash && !a.openingDate;
              return (
                <button
                  key={a.id || "all"}
                  type="button"
                  onClick={() => setSel(a.id)}
                  aria-pressed={on}
                  className={`group relative min-w-0 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    on ? "bg-white shadow-sm ring-1 ring-slate-200" : "bg-white/50 hover:bg-white/70 lg:bg-transparent"
                  } ${!a.isActive ? "opacity-60" : ""} ${focusRing}`}
                >
                  {on && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-slate-900" aria-hidden="true" />}
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        a.type === "ALL" ? "bg-slate-200 text-slate-700" : cash ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {a.type === "ALL" ? Icon.all : cash ? Icon.cash : Icon.bank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{a.name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {a.type === "ALL" ? `${accounts.length} quỹ và tài khoản` : cash ? `Quỹ tiền mặt, mã ${a.code}` : `Ngân hàng, mã ${a.code}`}
                      </div>
                    </div>
                  </div>
                  <div className={`mt-1.5 text-[15px] font-semibold tabular-nums lg:pl-[42px] ${a.closing < 0 ? "text-rose-700" : "text-slate-900"}`}>
                    {money(a.closing)} đ
                  </div>
                  {noOpen && <div className="mt-0.5 text-xs text-amber-700 lg:pl-[42px]">Chưa khai báo số dư đầu</div>}
                </button>
              );
            })}
          </div>

          <div className="mt-3 hidden space-y-1 border-t border-slate-200 pt-3 lg:block">
            {!!summary?.unassigned.count && (
              <Link
                to="/payments/missing-account"
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm text-amber-900 hover:bg-amber-50 ${focusRing}`}
              >
                <span>Phiếu chưa gán tài khoản</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold">{summary.unassigned.count}</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setPinOpen(true)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-white/70 hover:text-slate-900 ${focusRing}`}
            >
              {Icon.lock}
              Mật khẩu cấp 2
            </button>
          </div>
        </aside>

        {/* ================= main ================= */}
        <section className="min-w-0 space-y-4">
          {/* banner phiếu chưa gán (mobile + khi rail ẩn link) */}
          {!!summary?.unassigned.count && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 lg:hidden">
              <span>{summary.unassigned.count} phiếu cũ chưa gán tài khoản, chưa tính vào số dư.</span>
              <Link to="/payments/missing-account" className="font-medium underline underline-offset-2">
                Gán tài khoản
              </Link>
            </div>
          )}

          {/* account head */}
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(220px,340px)] md:items-end">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-medium text-slate-700">{head?.name ?? "…"}</h2>
                  {selAcc && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isCash(selAcc.type) ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                      {isCash(selAcc.type) ? "Tiền mặt" : "Ngân hàng"}
                    </span>
                  )}
                </div>
                <div className={`mt-1 text-[34px] font-semibold leading-tight tracking-tight tabular-nums ${(head?.closing ?? 0) < 0 ? "text-rose-700" : "text-slate-900"}`}>
                  {money(head?.closing ?? 0)} <span className="text-xl font-medium text-slate-400">đ</span>
                </div>
                <div className="text-sm text-slate-500">Số dư cuối ngày {viDate(to < today ? to : today)}</div>
                <dl className="mt-4 grid max-w-md grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Số dư đầu kỳ</dt>
                    <dd className="font-medium tabular-nums text-slate-900">{money(head?.opening ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Thu vào</dt>
                    <dd className="font-medium tabular-nums text-teal-700">{head?.thu ? "+" : ""}{money(head?.thu ?? 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Chi ra</dt>
                    <dd className="font-medium tabular-nums text-rose-700">{head?.chi ? "−" : ""}{money(head?.chi ?? 0)}</dd>
                  </div>
                </dl>
              </div>
              <div>
                {selAcc && trend.length > 1 ? (
                  <>
                    <Sparkline points={trend} />
                    <div className="mt-1 flex justify-between text-xs text-slate-400">
                      <span>{viDate(trend[0].d)}</span>
                      <span>Số dư cuối mỗi ngày</span>
                      <span>{viDate(trend[trend.length - 1].d)}</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-400 md:text-right">{selAcc ? "" : "Chọn một quỹ để xem số dư theo từng ngày."}</p>
                )}
              </div>
            </div>

            {selAcc && isCash(selAcc.type) && !selAcc.openingDate && (
              <div className="mx-5 mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Quỹ chưa khai báo số dư đầu kỳ nên số dư đang là cộng dồn từ các phiếu cũ, và chưa chặn chi quá số dư.
                {isAdmin ? " Bấm “Số dư đầu kỳ” và nhập số tiền đếm thực tế." : " Nhờ admin khai báo số dư đầu kỳ."}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
              <Btn variant="in" icon={Icon.in} onClick={() => openVoucher("RECEIPT")}>
                Phiếu thu
              </Btn>
              <Btn variant="out" icon={Icon.out} onClick={() => openVoucher("PAYMENT")}>
                Phiếu chi
              </Btn>
              <Btn icon={Icon.transfer} onClick={openTransfer}>
                Chuyển quỹ
              </Btn>
              {(!selAcc || isCash(selAcc.type)) && (
                <Btn icon={Icon.count} onClick={openCount}>
                  Kiểm quỹ
                </Btn>
              )}
              {isAdmin && selAcc && (
                <button
                  type="button"
                  onClick={() => {
                    setFormErr(null);
                    setOpening({ acc: selAcc, amount: selAcc.openingBalance, date: selAcc.openingDate || today.slice(0, 8) + "01", enabled: true });
                  }}
                  className={`ml-auto rounded-lg px-2 py-1.5 text-sm text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline ${focusRing}`}
                >
                  Số dư đầu kỳ{selAcc.openingDate ? ` (từ ${viDate(selAcc.openingDate)})` : ""}
                </button>
              )}
            </div>
          </div>

          {/* ledger */}
          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <h3 className="mr-auto text-base font-semibold text-slate-900">Sổ chi tiết</h3>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Lọc thu chi">
                {(
                  [
                    ["", "Tất cả"],
                    ["RECEIPT", "Thu"],
                    ["PAYMENT", "Chi"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFType(v)}
                    className={`rounded-md px-2.5 py-1 text-sm ${fType === v ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500"} ${focusRing}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <select aria-label="Nghiệp vụ" className={`${inputBase} py-1.5`} value={fCat} onChange={(e) => setFCat(e.target.value)}>
                <option value="">Mọi nghiệp vụ</option>
                {Object.entries(CAT_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input
                aria-label="Tìm phiếu"
                className={`${inputBase} w-full py-1.5 sm:w-60`}
                placeholder="Tìm số phiếu, nội dung, khách, hoá đơn"
                value={fQ}
                onChange={(e) => setFQ(e.target.value)}
              />
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
                Phiếu đã huỷ
              </label>
            </div>

            {/* column head */}
            <div className={`hidden ${ledgerCols} gap-3 border-b border-slate-100 px-4 py-2 text-xs font-medium text-slate-500 md:grid`}>
              <span />
              <span>Nội dung</span>
              <span className="text-right">Thu</span>
              <span className="text-right">Chi</span>
              {showBalance && <span className="text-right">Số dư</span>}
              <span className="text-right">{isAdmin ? "Thao tác" : ""}</span>
            </div>

            {ledger?.filtered && ledger.account && (
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">Đang lọc nên ẩn cột số dư. Bỏ lọc để xem số dư sau từng phiếu.</div>
            )}

            {days.length === 0 && (
              <div className="px-4 py-14 text-center">
                <p className="text-sm text-slate-500">{loading ? "Đang tải sổ…" : "Chưa có phiếu nào trong kỳ này."}</p>
                {!loading && (
                  <div className="mt-3 flex justify-center gap-2">
                    <Btn variant="in" icon={Icon.in} onClick={() => openVoucher("RECEIPT")}>
                      Lập phiếu thu
                    </Btn>
                    <Btn variant="out" icon={Icon.out} onClick={() => openVoucher("PAYMENT")}>
                      Lập phiếu chi
                    </Btn>
                  </div>
                )}
              </div>
            )}

            {days.map((g) => (
              <div key={g.d}>
                <div className="sticky top-0 z-[1] flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50/95 px-4 py-1.5 backdrop-blur">
                  <span className="text-sm font-medium text-slate-800">
                    {weekday(g.d)}, {viDate(g.d)}
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">
                    {g.thu > 0 && <span className="text-teal-700">+{money(g.thu)}</span>}
                    {g.thu > 0 && g.chi > 0 && <span className="px-1.5 text-slate-300">/</span>}
                    {g.chi > 0 && <span className="text-rose-700">−{money(g.chi)}</span>}
                    {showBalance && g.end != null && <span className="ml-3 text-slate-700">Số dư cuối ngày {money(g.end)}</span>}
                  </span>
                </div>
                {g.list
                  .slice()
                  .reverse()
                  .map((r) => {
                    const thu = r.type === "RECEIPT";
                    const who = r.partner?.name || r.personName;
                    const title = r.subject ? `${r.subject}: ${r.note || ""}` : r.note || (r.category === "INVOICE" ? (thu ? "Thu tiền hoá đơn" : "Trả tiền hoá đơn") : "");
                    const muted = r.voided ? "text-slate-400 line-through" : "";
                    return (
                      <div
                        key={r.id}
                        className={`group grid ${ledgerCols} items-start gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3 last:border-b-0 ${r.voided ? "bg-slate-50/70" : "hover:bg-slate-50/60"}`}
                      >
                        <span
                          className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full ${
                            r.voided ? "bg-slate-100 text-slate-400" : thu ? "bg-teal-50 text-teal-700" : "bg-rose-50 text-rose-700"
                          }`}
                          aria-label={thu ? "Thu" : "Chi"}
                        >
                          {r.category === "TRANSFER" ? Icon.transfer : thu ? Icon.in : Icon.out}
                        </span>

                        <div className="min-w-0">
                          <div className={`text-sm text-slate-900 ${muted}`}>{title}</div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                            <span className="font-medium tabular-nums text-slate-600">{r.code || "Chưa có số"}</span>
                            <span>{CAT_LABEL[r.category]}</span>
                            {who && <span>{thu ? "Người nộp" : "Người nhận"} {who}</span>}
                            {r.counterAccount && <span className="text-slate-700">{thu ? "Từ" : "Sang"} {r.counterAccount.name}</span>}
                            {!selAcc && r.account && <span className={isCash(r.account.type) ? "text-amber-800" : ""}>{r.account.name}</span>}
                            {r.invoices.map((i) => (
                              <Link key={i.id} to={`/invoices/${i.id}`} className="text-sky-700 underline-offset-2 hover:underline">
                                HĐ {i.code}
                              </Link>
                            ))}
                            {r.refNo && <span>Tham chiếu {r.refNo}</span>}
                            {r.createdBy && <span>Lập bởi {r.createdBy}</span>}
                          </div>
                          {r.voided && (
                            <div className="mt-1 text-xs text-rose-700">
                              Đã huỷ{r.voidedBy ? ` bởi ${r.voidedBy}` : ""}: {r.voidReason}
                            </div>
                          )}
                          {/* actions on mobile */}
                          {!r.voided && (
                            <div className="mt-2 flex flex-wrap gap-2 md:hidden">
                              {isAdmin && r.category !== "TRANSFER" && ( /* ✅ đổi TK của phiếu: chỉ quản trị + mật khẩu cấp 2 */
                                <button type="button" className={`${rowBtnAcc} !min-h-[34px] px-3 text-[13px]`} onClick={() => (setFormErr(null), setChangeAcc({ row: r, accountId: "" }))}>
                                  {RowIcon.swap}
                                  Đổi tài khoản
                                </button>
                              )}
                              {isAdmin && ( // ✅ huỷ phiếu cần mật khẩu cấp 2 — chỉ quản trị
                              <button
                                type="button"
                                className={`${rowBtnVoid} !min-h-[34px] px-3 text-[13px]`}
                                onClick={() =>
                                  setVoidTarget({
                                    id: r.id,
                                    code: r.code,
                                    type: r.type,
                                    amount: r.amount,
                                    date: r.date,
                                    accountLabel: r.account?.name,
                                    invoiceCodes: r.invoices.map((i) => i.code),
                                    isTransfer: r.category === "TRANSFER",
                                  })
                                }
                              >
                                {RowIcon.void}
                                Huỷ phiếu
                              </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* mobile amount */}
                        <div className={`text-right text-sm font-semibold tabular-nums md:hidden ${r.voided ? "text-slate-400 line-through" : thu ? "text-teal-700" : "text-rose-700"}`}>
                          {thu ? "+" : "−"}
                          {money(r.amount)}
                          {showBalance && r.balance != null && <div className="text-xs font-normal text-slate-500">số dư {money(r.balance)}</div>}
                        </div>

                        {/* desktop columns */}
                        <span className={`hidden pt-0.5 text-right text-sm font-medium tabular-nums md:block ${r.voided ? "text-slate-400 line-through" : "text-teal-700"}`}>
                          {thu ? money(r.amount) : ""}
                        </span>
                        <span className={`hidden pt-0.5 text-right text-sm font-medium tabular-nums md:block ${r.voided ? "text-slate-400 line-through" : "text-rose-700"}`}>
                          {!thu ? money(r.amount) : ""}
                        </span>
                        {showBalance && (
                          <span className={`hidden pt-0.5 text-right text-sm tabular-nums md:block ${r.balance != null && r.balance < 0 ? "text-rose-700" : "text-slate-800"}`}>
                            {r.balance != null ? money(r.balance) : ""}
                          </span>
                        )}
                        <span className="hidden justify-end gap-1 md:flex">
                          {!r.voided && (
                            <span className="flex gap-1.5">
                              {isAdmin && r.category !== "TRANSFER" && ( /* ✅ đổi TK của phiếu: chỉ quản trị + mật khẩu cấp 2 */
                                <button
                                  type="button"
                                  title="Chuyển phiếu sang quỹ / tài khoản khác (cần mật khẩu cấp 2)"
                                  onClick={() => (setFormErr(null), setChangeAcc({ row: r, accountId: "" }))}
                                  className={`${rowBtnAcc} ${focusRing}`}
                                >
                                  {RowIcon.swap}
                                  Đổi TK
                                </button>
                              )}
                              {isAdmin && ( // ✅ huỷ phiếu cần mật khẩu cấp 2 — chỉ quản trị
                              <button
                                type="button"
                                title="Huỷ phiếu (giữ lại để tra, cần mật khẩu cấp 2)"
                                onClick={() =>
                                  setVoidTarget({
                                    id: r.id,
                                    code: r.code,
                                    type: r.type,
                                    amount: r.amount,
                                    date: r.date,
                                    accountLabel: r.account?.name,
                                    invoiceCodes: r.invoices.map((i) => i.code),
                                    isTransfer: r.category === "TRANSFER",
                                  })
                                }
                                className={`${rowBtnVoid} ${focusRing}`}
                              >
                                {RowIcon.void}
                                Huỷ
                              </button>
                              )}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
              </div>
            ))}

            {ledger && rows.length > 0 && (
              <div className={`grid ${ledgerCols} gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm`}>
                <span />
                <span className="font-medium text-slate-700">
                  Cộng trong kỳ
                  {showBalance && ledger.opening != null && (
                    <span className="block font-normal text-slate-500 md:ml-2 md:inline">Số dư đầu kỳ {money(ledger.opening)}</span>
                  )}
                </span>
                <span className="hidden text-right font-semibold tabular-nums text-teal-700 md:block">{money(ledger.thu)}</span>
                <span className="hidden text-right font-semibold tabular-nums text-rose-700 md:block">{money(ledger.chi)}</span>
                {showBalance && <span className="hidden text-right font-semibold tabular-nums text-slate-900 md:block">{money(ledger.closing ?? 0)}</span>}
                <span className="text-right text-sm tabular-nums md:hidden">
                  <span className="text-teal-700">+{money(ledger.thu)}</span> <span className="text-rose-700">−{money(ledger.chi)}</span>
                  {showBalance && <span className="block font-semibold text-slate-900">Số dư cuối {money(ledger.closing ?? 0)}</span>}
                </span>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ---------- lập phiếu ---------- */}
      <DialogShell
        open={!!voucher}
        title={voucher?.type === "RECEIPT" ? "Lập phiếu thu" : "Lập phiếu chi"}
        subtitle={voucher?.type === "RECEIPT" ? "Thu khác, không gắn hoá đơn." : "Chi phí, không gắn hoá đơn."}
        onClose={() => setVoucher(null)}
        width="max-w-lg"
        footer={
          <>
            <Btn onClick={() => setVoucher(null)}>Đóng</Btn>
            <Btn variant={voucher?.type === "RECEIPT" ? "in" : "out"} disabled={busy} onClick={submitVoucher}>
              {busy ? "Đang lưu…" : voucher?.type === "RECEIPT" ? "Lưu phiếu thu" : "Lưu phiếu chi"}
            </Btn>
          </>
        }
      >
        {voucher && (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <label>
                <span className={labelCls}>Số tiền</span>
                <MoneyInput large autoFocus value={voucher.amount} onChange={(n) => setVoucher({ ...voucher, amount: n })} />
              </label>
              <label>
                <span className={labelCls}>Ngày</span>
                <input type="date" className={`${inputBase} py-2.5`} value={voucher.date} onChange={(e) => setVoucher({ ...voucher, date: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>{voucher.type === "RECEIPT" ? "Thu vào" : "Chi từ"}</span>
              <AccountSelect accounts={accounts} value={voucher.accountId} onChange={(v) => setVoucher({ ...voucher, accountId: v })} />
            </label>
            <label className="block">
              <span className={labelCls}>Nội dung</span>
              <input
                className={inputCls}
                value={voucher.note}
                placeholder={voucher.type === "RECEIPT" ? "Ví dụ: bán thùng carton cũ" : "Ví dụ: ship máy cho khách Minh Phát"}
                onChange={(e) => setVoucher({ ...voucher, note: e.target.value })}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelCls}>Khoản mục</span>
                <input className={inputCls} list="cb-subjects" value={voucher.subject} onChange={(e) => setVoucher({ ...voucher, subject: e.target.value })} />
                <datalist id="cb-subjects">
                  {(voucher.type === "RECEIPT" ? SUBJECTS_THU : SUBJECTS_CHI).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <label>
                <span className={labelCls}>{voucher.type === "RECEIPT" ? "Người nộp" : "Người nhận"}</span>
                <input className={inputCls} value={voucher.personName} onChange={(e) => setVoucher({ ...voucher, personName: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>Số tham chiếu</span>
              <input className={inputCls} value={voucher.refNo} placeholder="Mã giao dịch ngân hàng, số hoá đơn đỏ (nếu có)" onChange={(e) => setVoucher({ ...voucher, refNo: e.target.value })} />
            </label>
            <p className="text-xs text-slate-500">Thu tiền khách hoặc trả tiền nhà cung cấp theo hoá đơn thì lập ở hoá đơn hay trang Công nợ để trừ đúng công nợ.</p>
            {formErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formErr}</div>}
          </>
        )}
      </DialogShell>

      {/* ---------- chuyển quỹ ---------- */}
      <DialogShell
        open={!!transfer}
        title="Chuyển quỹ"
        subtitle="Nộp tiền mặt vào ngân hàng, rút về quỹ, hoặc chuyển giữa hai tài khoản. Không tính vào doanh thu hay chi phí."
        onClose={() => setTransfer(null)}
        footer={
          <>
            <Btn onClick={() => setTransfer(null)}>Đóng</Btn>
            <Btn variant="dark" disabled={busy} onClick={submitTransfer}>
              {busy ? "Đang lưu…" : "Chuyển"}
            </Btn>
          </>
        }
      >
        {transfer && (
          <>
            <label className="block">
              <span className={labelCls}>Từ</span>
              <AccountSelect accounts={accounts} value={transfer.fromAccountId} onChange={(v) => setTransfer({ ...transfer, fromAccountId: v })} />
            </label>
            <div className="flex justify-center text-slate-400" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <label className="block">
              <span className={labelCls}>Sang</span>
              <AccountSelect accounts={accounts} value={transfer.toAccountId} exclude={transfer.fromAccountId} onChange={(v) => setTransfer({ ...transfer, toAccountId: v })} />
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <label>
                <span className={labelCls}>Số tiền</span>
                <MoneyInput large value={transfer.amount} onChange={(n) => setTransfer({ ...transfer, amount: n })} />
              </label>
              <label>
                <span className={labelCls}>Ngày</span>
                <input type="date" className={`${inputBase} py-2.5`} value={transfer.date} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>Ghi chú</span>
              <input className={inputCls} value={transfer.note} placeholder="Ví dụ: nộp tiền bán hàng tuần 43" onChange={(e) => setTransfer({ ...transfer, note: e.target.value })} />
            </label>
            {formErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formErr}</div>}
          </>
        )}
      </DialogShell>

      {/* ---------- kiểm quỹ ---------- */}
      <DialogShell
        open={!!count}
        title="Kiểm quỹ tiền mặt"
        subtitle="Đếm tiền trong két, nhập số thực tế. Lệch thì hệ thống lập phiếu chênh lệch."
        onClose={() => setCount(null)}
        footer={
          <>
            <Btn onClick={() => setCount(null)}>Đóng</Btn>
            <Btn variant="dark" disabled={busy || count?.book == null} onClick={submitCount}>
              {busy ? "Đang lưu…" : countMismatch ? "Ghi chênh lệch" : "Xác nhận khớp"}
            </Btn>
          </>
        }
      >
        {count && (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <label>
                <span className={labelCls}>Quỹ</span>
                <AccountSelect accounts={accounts} onlyCash value={count.accountId} onChange={(v) => setCount({ ...count, accountId: v, book: null })} />
              </label>
              <label>
                <span className={labelCls}>Cuối ngày</span>
                <input type="date" className={inputBase} value={count.date} onChange={(e) => setCount({ ...count, date: e.target.value, book: null })} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="text-sm text-slate-500">Theo sổ</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">{count.book == null ? "…" : `${money(count.book)} đ`}</div>
              </div>
              <label>
                <span className="mb-1 block text-sm text-slate-500">Đếm thực tế</span>
                <MoneyInput large autoFocus value={count.actual} onChange={(n) => setCount({ ...count, actual: n })} />
              </label>
            </div>
            {countDiff != null && count.actual > 0 && (
              <div
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  !countMismatch ? "bg-teal-50 text-teal-800" : countDiff > 0 ? "bg-sky-50 text-sky-900" : "bg-rose-50 text-rose-800"
                }`}
              >
                {!countMismatch ? "Khớp sổ." : countDiff > 0 ? `Thừa ${money(countDiff)} đ, sẽ lập phiếu thu chênh lệch.` : `Thiếu ${money(-countDiff)} đ, sẽ lập phiếu chi chênh lệch.`}
              </div>
            )}
            {countMismatch && (
              <label className="block">
                <span className={labelCls}>Lý do chênh lệch</span>
                <input className={inputCls} value={count.reason} placeholder="Ví dụ: thối nhầm tiền khách" onChange={(e) => setCount({ ...count, reason: e.target.value })} />
              </label>
            )}
            {formErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formErr}</div>}
          </>
        )}
      </DialogShell>

      {/* ---------- số dư đầu kỳ ---------- */}
      <DialogShell
        open={!!opening}
        title="Số dư đầu kỳ"
        subtitle={opening ? `${opening.acc.name}. Nhập số tiền thực có ở đầu ngày bắt đầu dùng sổ.` : ""}
        onClose={() => setOpening(null)}
        footer={
          <>
            <Btn onClick={() => setOpening(null)}>Đóng</Btn>
            <Btn variant="dark" disabled={busy} onClick={submitOpening}>
              {busy ? "Đang lưu…" : "Lưu số dư đầu"}
            </Btn>
          </>
        }
      >
        {opening && (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={opening.enabled} onChange={(e) => setOpening({ ...opening, enabled: e.target.checked })} />
              Khai báo số dư đầu kỳ cho tài khoản này
            </label>
            {opening.enabled && (
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <label>
                  <span className={labelCls}>Ngày bắt đầu sổ</span>
                  <input type="date" className={inputBase} value={opening.date} onChange={(e) => setOpening({ ...opening, date: e.target.value })} />
                </label>
                <label>
                  <span className={labelCls}>Số dư đầu ngày</span>
                  <MoneyInput value={opening.amount} onChange={(n) => setOpening({ ...opening, amount: n })} />
                </label>
              </div>
            )}
            <p className="text-sm text-slate-500">
              Phiếu trước ngày này không tính vào số dư.{isCash(opening.acc.type) && " Từ ngày này quỹ tiền mặt không được chi quá số dư."}
            </p>
            {formErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formErr}</div>}
          </>
        )}
      </DialogShell>

      {/* ---------- đổi tài khoản ---------- */}
      <DialogShell
        open={!!changeAcc}
        title="Đổi tài khoản của phiếu"
        subtitle="Dùng khi chọn nhầm nơi nhận hoặc chi tiền. Có kiểm tra khoá kỳ và số dư quỹ."
        onClose={() => setChangeAcc(null)}
        footer={
          <>
            <Btn onClick={() => setChangeAcc(null)}>Đóng</Btn>
            <Btn variant="dark" disabled={busy} onClick={submitChangeAcc}>
              {busy ? "Đang lưu…" : "Đổi tài khoản"}
            </Btn>
          </>
        }
      >
        {changeAcc && (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-slate-600">
                  Phiếu {changeAcc.row.type === "RECEIPT" ? "thu" : "chi"} <span className="font-medium text-slate-900">{changeAcc.row.code}</span>
                </span>
                <span className="font-semibold tabular-nums">{money(changeAcc.row.amount)} đ</span>
              </div>
              <div className="mt-1 text-slate-500">Đang ở {changeAcc.row.account?.name ?? "chưa gán"}</div>
            </div>
            <label className="block">
              <span className={labelCls}>Chuyển sang</span>
              <AccountSelect accounts={accounts} value={changeAcc.accountId} exclude={changeAcc.row.account?.id} onChange={(v) => setChangeAcc({ ...changeAcc, accountId: v })} />
            </label>
            {formErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{formErr}</div>}
          </>
        )}
      </DialogShell>

      <PinActionDialog
        open={changeAccPin}
        title="Xác nhận đổi tài khoản"
        subtitle={changeAcc ? `Phiếu ${changeAcc.row.code || ""}, ${money(changeAcc.row.amount)} đ` : undefined}
        confirmLabel="Đổi tài khoản"
        busyLabel="Đang đổi…"
        onClose={() => setChangeAccPin(false)}
        onSubmit={doChangeAccWithPin}
      />

      <VoidPaymentDialog
        target={voidTarget}
        onClose={() => setVoidTarget(null)}
        onVoided={(t) => {
          setVoidTarget(null);
          toast.push({ type: "success", title: "Đã huỷ phiếu", message: `Phiếu ${t.code || ""} đã huỷ.` });
          reload();
        }}
      />
      <PinSettingsDialog open={pinOpen} onClose={() => setPinOpen(false)} onSaved={() => toast.push({ type: "success", title: "Đã lưu", message: "Đã cập nhật mật khẩu cấp 2." })} />

      <ToastHost toasts={toast.toasts} onClose={toast.remove} />
    </div>
  );
};

export default CashbookPage;
