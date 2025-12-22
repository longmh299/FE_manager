// src/pages/MySalesDashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* =======================
   Types (loose + safe)
======================= */
type Summary = {
  revenue: number; // doanh thu thuần (NET) = subtotal

  // ⚠️ legacy: một số BE trả "collected" theo NET (đã quy đổi)
  collected: number;

  // ✅ tiền thực thu (cash, gross) - ưu tiên field này nếu có
  collectedGross?: number;

  outstanding: number; // legacy

  // optional split (nếu BE có)
  normalOutstanding?: number;
  holdOutstanding?: number;
  totalOutstanding?: number;

  orderCount: number;
};

type TrendRow = { date: string; revenue: number };

type DebtRow = {
  invoiceId: string;
  invoiceCode: string;
  customerName: string;

  // cũ
  date?: string; // dd/MM/yyyy
  totalAmount?: number;
  collected?: number;
  collectedGross?: number;
  outstanding?: number;

  // mới (route split)
  issueDate?: string; // dd/MM/yyyy
  invoiceTotal?: number; // total (VAT)
  paid?: number; // paidAmount (total)
  paidAmount?: number;
  total?: number;

  normalOutstanding?: number;
  holdOutstanding?: number;
  totalOutstanding?: number;

  // extra (route trả)
  subtotal?: number;
};

type TopDebtorRow = { customerName: string; outstanding: number };

type DashboardResp = {
  period?: { month: number; year: number; from?: string; to?: string };
  summary?: Summary;
  trend?: TrendRow[];
  debts?: DebtRow[];
  topDebtors?: TopDebtorRow[];

  customers?: any[];
  invoices?: any[];
};

/** Invoice detail response from GET /invoices/:id */
type InvoiceDetailResp = {
  ok: boolean;
  data: any;
};

/* =======================
   Helpers
======================= */
function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function money(v: any) {
  return num(v).toLocaleString("vi-VN") + " đ";
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function fmtDateVN(raw: any) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function safeStr(v: any) {
  return String(v ?? "");
}

function unwrapData<T = any>(resData: any): T {
  if (resData && typeof resData === "object" && "ok" in resData && "data" in resData) {
    return resData.data as T;
  }
  return resData as T;
}

// pick helpers: ưu tiên field mới/đúng rồi fallback
function pickDate(d: any): string {
  return safeStr(d?.date || d?.issueDate || d?.createdAt || "");
}
function pickTotal(d: any): number {
  // total VAT thật của invoice
  return num(
    d?.invoiceTotal ??
      d?.totalAmount ??
      d?.total ??
      d?.grandTotal ??
      d?.invoiceTotalWithTax ??
      0
  );
}
function pickPaidGross(d: any): number {
  // ✅ TIỀN THỰC THU: ưu tiên paid/paidAmount; ưu tiên collectedGross nếu có; fallback collected (legacy)
  return num(
    d?.paid ??
      d?.paidAmount ??
      d?.paidTotal ??
      d?.collectedGross ??
      d?.collected ??
      0
  );
}
function pickNormalOutstanding(d: any): number {
  return num(
    d?.normalOutstanding ??
      d?.outstandingNormal ??
      d?.outstanding ??
      0
  );
}
function pickHoldOutstanding(d: any): number {
  return num(d?.holdOutstanding ?? d?.warrantyOutstanding ?? 0);
}
function pickTotalOutstanding(d: any): number {
  return num(d?.totalOutstanding ?? d?.outstanding ?? 0);
}

/* =======================
   Dialog (Invoice detail)
======================= */
function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl bg-white rounded-lg shadow-lg border">
          <div className="flex items-start justify-between gap-4 p-4 border-b">
            <div className="min-w-0">
              <div className="font-semibold text-lg truncate">
                {title || "Chi tiết"}
              </div>
            </div>
            <button
              className="px-3 py-2 rounded border hover:bg-gray-50"
              onClick={onClose}
            >
              Đóng
            </button>
          </div>

          <div className="p-4 max-h-[75vh] overflow-auto">{children}</div>

          <div className="p-4 border-t flex justify-end">
            <button
              className="px-3 py-2 rounded border hover:bg-gray-50"
              onClick={onClose}
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  title,
  value,
  highlight,
  subHint,
}: {
  title: string;
  value: string;
  highlight?: boolean;
  subHint?: string;
}) {
  return (
    <div
      className={`bg-white rounded shadow p-4 border ${
        highlight ? "border-red-500" : "border-transparent"
      }`}
    >
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`text-xl font-semibold ${highlight ? "text-red-600" : ""}`}>
        {value}
      </div>
      {subHint ? <div className="text-xs text-gray-500 mt-1">{subHint}</div> : null}
    </div>
  );
}

/* =======================
   Page
======================= */
const MySalesDashboardPage: React.FC = () => {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [search, setSearch] = useState("");

  const [dash, setDash] = useState<DashboardResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // invoice modal states
  const [openInv, setOpenInv] = useState(false);
  const [invId, setInvId] = useState<string | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invErr, setInvErr] = useState<string | null>(null);
  const [inv, setInv] = useState<any | null>(null);

  async function fetchDashboard() {
    setLoading(true);
    setErr(null);

    try {
      const res = await api.get("/me/sales-dashboard", { params: { month, year } });
      const data = unwrapData<DashboardResp>(res.data);
      setDash(data || null);
    } catch (e: any) {
      setDash(null);
      setErr(
        e?.response?.data?.message ||
          e?.message ||
          "Không lấy được dữ liệu doanh thu cá nhân"
      );
    } finally {
      setLoading(false);
    }
  }

  async function fetchInvoiceDetail(id: string) {
    setInvLoading(true);
    setInvErr(null);
    setInv(null);

    try {
      const res = await api.get<InvoiceDetailResp>(`/invoices/${id}`);
      const data = unwrapData<any>(res.data);
      setInv(data);
    } catch (e: any) {
      setInvErr(
        e?.response?.data?.message ||
          e?.message ||
          "Không lấy được chi tiết hoá đơn"
      );
    } finally {
      setInvLoading(false);
    }
  }

  function openInvoice(id: string) {
    setInvId(id);
    setOpenInv(true);
    fetchInvoiceDetail(id);
  }

  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  const view: Required<DashboardResp> = {
    period: dash?.period || { month, year },
    summary:
      dash?.summary || ({
        revenue: 0,
        collected: 0,
        collectedGross: 0,
        outstanding: 0,
        orderCount: 0,
      } as any),
    trend: Array.isArray(dash?.trend) ? dash!.trend! : [],
    debts: Array.isArray(dash?.debts) ? dash!.debts! : [],
    topDebtors: Array.isArray(dash?.topDebtors) ? dash!.topDebtors! : [],
    customers: Array.isArray((dash as any)?.customers) ? (dash as any).customers : [],
    invoices: Array.isArray((dash as any)?.invoices) ? (dash as any).invoices : [],
  };

  // KPI numbers
  const kpiNeedCollect = num((view.summary as any).normalOutstanding ?? view.summary.outstanding);
  const kpiHold = num((view.summary as any).holdOutstanding ?? 0);
  const kpiTotalDebt = num((view.summary as any).totalOutstanding ?? view.summary.outstanding);

  // ✅ "Đã thu (thực tế)" = CASH (gross). Ưu tiên summary.collectedGross nếu BE trả.
  const kpiCollectedCash = num((view.summary as any).collectedGross ?? view.summary.collected);

  // ✅ không hint, không quy đổi, không KPI linh tinh
  const collectedHint = "";

  const filteredDebts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return view.debts;

    return view.debts.filter((d) => {
      const code = safeStr((d as any).invoiceCode).toLowerCase();
      const name = safeStr((d as any).customerName).toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [view.debts, search]);

  // ===== derive customer cards from debts =====
  const customerAgg = useMemo(() => {
    const m = new Map<
      string,
      {
        customerName: string;
        normalOutstanding: number;
        holdOutstanding: number;
        totalOutstanding: number;
        count: number;
      }
    >();

    for (const d of view.debts) {
      const key = safeStr((d as any).customerName || "Khách lẻ");
      const cur =
        m.get(key) || {
          customerName: key,
          normalOutstanding: 0,
          holdOutstanding: 0,
          totalOutstanding: 0,
          count: 0,
        };

      const normalO = pickNormalOutstanding(d);
      const holdO = pickHoldOutstanding(d);
      const totalO = pickTotalOutstanding(d);

      cur.normalOutstanding += normalO;
      cur.holdOutstanding += holdO;
      cur.totalOutstanding += totalO;
      cur.count += 1;

      m.set(key, cur);
    }

    return Array.from(m.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }, [view.debts]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start md:items-center justify-between gap-4 flex-col md:flex-row">
        <div>
          <h1 className="text-2xl font-semibold">Doanh thu của tôi</h1>
          <p className="text-sm text-gray-500">Nhân viên SALE</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="border rounded px-2 py-2 bg-white"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <option key={i + 1} value={i + 1}>
                Tháng {i + 1}
              </option>
            ))}
          </select>

          <select
            className="border rounded px-2 py-2 bg-white"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {Array.from({ length: 6 }).map((_, i) => {
              const y = now.getFullYear() - i;
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </select>

          <button
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
            onClick={fetchDashboard}
            disabled={loading}
          >
            Làm mới
          </button>
        </div>
      </div>

      {/* State */}
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">
          {err}
        </div>
      )}

      {loading && (
        <div className="bg-white border rounded p-6 text-center text-gray-500">
          Đang tải dữ liệu…
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Kpi title="Doanh thu thuần" value={money(view.summary.revenue)} />
        <Kpi title="Đã thu (thực tế)" value={money(kpiCollectedCash)} subHint={collectedHint} />
        <Kpi
          title="Cần thu (nợ thường)"
          value={money(kpiNeedCollect)}
          highlight={kpiNeedCollect > 0}
        />
        <Kpi title="Số đơn" value={String(num(view.summary.orderCount))} />
      </div>

      {/* Chart + Debtors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded shadow border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Xu hướng doanh thu</h2>
            <span className="text-xs text-gray-500">Theo ngày phát hành hoá đơn</span>
          </div>

          <div className="h-72">
            {view.trend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                Không có dữ liệu biểu đồ
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={view.trend}>
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(v: any) => money(v)} />
                  <Line dataKey="revenue" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded shadow border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Công nợ nhanh</h2>
            <div className="text-xs text-gray-500">{customerAgg.length} khách</div>
          </div>

          <div className="mt-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Cần thu (nợ thường)</span>
              <span className="font-semibold text-red-600">{money(kpiNeedCollect)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">BH treo</span>
              <span className="font-semibold text-amber-700">{money(kpiHold)}</span>
            </div>

            <div className="flex justify-between pt-2 border-t mt-2">
              <span className="text-sm text-gray-600">Tổng nợ</span>
              <span className="font-semibold">{money(kpiTotalDebt)}</span>
            </div>
          </div>

          <div className="text-xs text-gray-500 mt-2">
            * BH treo là phần giữ lại bảo hành (thường 5%), không tính vào khoản cần thu ngay.
          </div>

          <div className="mt-3">
            {customerAgg.length === 0 ? (
              <div className="text-sm text-gray-400">Không có khách nợ trong tháng</div>
            ) : (
              <div className="space-y-2">
                {customerAgg.slice(0, 8).map((c) => (
                  <div
                    key={c.customerName}
                    className="flex items-center justify-between text-sm border rounded px-3 py-2 hover:bg-gray-50"
                    title="Bấm vào hoá đơn ở bảng bên dưới để xem chi tiết"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.customerName}</div>
                      <div className="text-xs text-gray-500">{c.count} HĐ nợ</div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div className="font-semibold text-red-600">{money(c.totalOutstanding)}</div>
                      {c.holdOutstanding > 0 && (
                        <div className="text-xs text-amber-700">
                          BH treo: {money(c.holdOutstanding)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <div className="text-xs text-gray-500 mt-2">
                  Gợi ý: Bấm vào từng hoá đơn ở bảng bên dưới để mở hộp thoại chi tiết
                  (dòng hàng + lịch sử thanh toán).
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Debt table */}
      <div className="bg-white rounded shadow border p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-medium">Danh sách hoá đơn còn nợ</h2>
            <div className="text-xs text-gray-500">Bấm vào một hoá đơn để xem chi tiết.</div>
          </div>

          <input
            className="border rounded px-3 py-2 text-sm w-full md:w-72 bg-white"
            placeholder="Tìm mã HĐ / khách hàng"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={view.debts.length === 0}
          />
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="text-left py-2 px-2">Mã HĐ</th>
                <th className="text-left px-2">Khách hàng</th>
                <th className="text-left px-2">Ngày</th>
                <th className="text-right px-2">Tổng tiền</th>
                <th className="text-right px-2">Đã thu</th>
                <th className="text-right px-2 text-red-600">Cần thu</th>
                <th className="text-right px-2">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredDebts.map((d) => {
                const total = pickTotal(d);
                const paidGross = pickPaidGross(d);
                const normalO = pickNormalOutstanding(d);
                const holdO = pickHoldOutstanding(d);

                return (
                  <tr
                    key={safeStr((d as any).invoiceId)}
                    className="border-b last:border-0 hover:bg-gray-50"
                  >
                    <td className="py-2 px-2 font-medium">{safeStr((d as any).invoiceCode)}</td>
                    <td className="px-2">{safeStr((d as any).customerName || "Khách lẻ")}</td>
                    <td className="px-2">{pickDate(d)}</td>

                    <td className="text-right px-2">{money(total)}</td>
                    <td className="text-right px-2">{money(paidGross)}</td>

                    <td className="text-right px-2">
                      <div className="font-semibold text-red-600">{money(normalO)}</div>
                      {holdO > 0 && (
                        <div className="text-xs text-amber-700">BH treo: {money(holdO)}</div>
                      )}
                    </td>

                    <td className="text-right px-2">
                      <button
                        className="px-3 py-1.5 rounded border hover:bg-white bg-gray-50"
                        onClick={() => openInvoice(String((d as any).invoiceId))}
                      >
                        Xem
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredDebts.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-500">
                    {view.debts.length === 0
                      ? "Không có hoá đơn còn nợ 🎉"
                      : "Không tìm thấy kết quả phù hợp"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice modal */}
      <Modal
        open={openInv}
        onClose={() => {
          setOpenInv(false);
          setInvId(null);
          setInv(null);
          setInvErr(null);
        }}
        title={inv ? `Hoá đơn ${safeStr(inv.code || invId || "")}` : "Chi tiết hoá đơn"}
      >
        {invLoading && (
          <div className="bg-white border rounded p-6 text-center text-gray-500">
            Đang tải chi tiết hoá đơn…
          </div>
        )}

        {invErr && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">
            {invErr}
          </div>
        )}

        {!invLoading && !invErr && inv && <InvoiceDetailView inv={inv} />}
      </Modal>
    </div>
  );
};

export default MySalesDashboardPage;

/* =======================
   Invoice Detail View
======================= */
function InvoiceDetailView({ inv }: { inv: any }) {
  const partnerObj = inv.partner || null;

  const partnerName =
    safeStr(partnerObj?.name) ||
    safeStr(inv.partnerName) ||
    safeStr(inv.snapshot?.partnerName) ||
    "Khách lẻ";

  const partnerPhone =
    safeStr(partnerObj?.phone) ||
    safeStr(inv.partnerPhone) ||
    safeStr(inv.snapshot?.partnerPhone) ||
    "";

  const partnerEmail =
    safeStr(partnerObj?.email) ||
    safeStr(inv.partnerEmail) ||
    safeStr(inv.snapshot?.partnerEmail) ||
    "";

  const partnerAddr =
    safeStr(partnerObj?.address) ||
    safeStr(inv.partnerAddr) ||
    safeStr(inv.snapshot?.partnerAddr) ||
    "";

  const issueDate = inv.issueDate || inv.date || inv.createdAt;

  const subtotal = num(inv.subtotal);
  const tax = num(inv.tax);
  const total = num(inv.total);

  const allocations: any[] = Array.isArray(inv.allocations) ? inv.allocations : [];
  const paymentRows = useMemo(() => {
    const map = new Map<string, any>();
    for (const a of allocations) {
      const pay = a.payment || a.paymentId || null;
      const paymentId = safeStr(a.paymentId || pay?.id || "");
      if (!paymentId) continue;

      const row = map.get(paymentId) || {
        paymentId,
        date: pay?.date || a.createdAt || null,
        type: safeStr(pay?.type || ""),
        method: safeStr(pay?.method || ""),
        refNo: safeStr(pay?.refNo || ""),
        account: pay?.account?.name || pay?.account?.code || "",
        amount: num(pay?.amount),
        normal: 0,
        hold: 0,
      };

      const kind = safeStr(a.kind || "NORMAL").toUpperCase();
      const amt = num(a.amount);
      if (kind === "WARRANTY_HOLD") row.hold += amt;
      else row.normal += amt;

      map.set(paymentId, row);
    }

    return Array.from(map.values()).sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
  }, [allocations]);

  const lines: any[] = Array.isArray(inv.lines) ? inv.lines : [];
  const hasLines = lines.length > 0;

  // invoice-level paidAmount = NORMAL paid (đã clamp theo collectible)
  const paidAmount = num(inv.paidAmount);
  const outstanding = Math.max(0, total - paidAmount);

  // warranty display only
  const warrantyHoldAmount = num(inv.warrantyHoldAmount);
  const warrantyHoldPct = num(inv.warrantyHoldPct);
  const hasWarrantyHold = Boolean(inv.hasWarrantyHold);
  const warrantyHold = hasWarrantyHold
    ? warrantyHoldAmount > 0
      ? warrantyHoldAmount
      : (total * warrantyHoldPct) / 100
    : 0;

  const normalOutstanding = Math.max(0, outstanding - Math.max(0, warrantyHold));

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="text-sm text-gray-500">Ngày: {fmtDateVN(issueDate)}</div>
          <div className="text-xs text-gray-400">
            Trạng thái: {safeStr(inv.status || "")} • Thanh toán:{" "}
            {safeStr(inv.paymentStatus || "")}
          </div>
        </div>

        <div className="text-right">
          <div className="text-sm text-gray-500">Tổng tiền</div>
          <div className="text-lg font-semibold">{money(total)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="border rounded p-3">
          <div className="text-xs text-gray-500 mb-1">Khách hàng</div>
          <div className="font-semibold">{partnerName}</div>
          {(partnerPhone || partnerEmail || partnerAddr) && (
            <div className="text-sm text-gray-600 mt-1 space-y-0.5">
              {partnerPhone && <div>📞 {partnerPhone}</div>}
              {partnerEmail && <div>✉️ {partnerEmail}</div>}
              {partnerAddr && <div>📍 {partnerAddr}</div>}
            </div>
          )}
        </div>

        <div className="border rounded p-3">
          <div className="text-xs text-gray-500 mb-1">Giá trị</div>
          <div className="text-sm flex justify-between">
            <span>Tạm tính</span>
            <span className="font-medium">{money(subtotal)}</span>
          </div>
          <div className="text-sm flex justify-between">
            <span>Thuế</span>
            <span className="font-medium">{money(tax)}</span>
          </div>
          <div className="text-sm flex justify-between">
            <span>Tổng</span>
            <span className="font-semibold">{money(total)}</span>
          </div>
        </div>

        <div className="border rounded p-3">
          <div className="text-xs text-gray-500 mb-1">Thanh toán</div>
          <div className="text-sm flex justify-between">
            <span>Đã thu (NORMAL)</span>
            <span className="font-semibold">{money(paidAmount)}</span>
          </div>

          <div className="text-sm flex justify-between">
            <span>Cần thu (nợ thường)</span>
            <span className="font-semibold text-red-600">{money(normalOutstanding)}</span>
          </div>

          {warrantyHold > 0 && (
            <div className="text-sm flex justify-between">
              <span className="text-amber-700">BH treo</span>
              <span className="font-semibold text-amber-700">{money(warrantyHold)}</span>
            </div>
          )}

          <div className="text-sm flex justify-between pt-2 border-t mt-2">
            <span>Tổng nợ</span>
            <span className="font-semibold">{money(outstanding)}</span>
          </div>

          {safeStr(inv.paymentStatus).toUpperCase() === "PARTIAL" && (
            <div className="inline-flex mt-2 text-xs px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700">
              Thu 1 phần
            </div>
          )}
        </div>
      </div>

      <div className="border rounded p-3">
        <div className="font-medium mb-2">Dòng hàng</div>

        {!hasLines ? (
          <div className="text-sm text-gray-500">
            Hoá đơn này chưa có dòng hàng (hoặc API đang không include lines).
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-2">Sản phẩm</th>
                  <th className="text-left px-2">ĐVT</th>
                  <th className="text-right px-2">SL</th>
                  <th className="text-right px-2">Đơn giá</th>
                  <th className="text-right px-2">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const name = safeStr(l.itemName || l.item?.name || "");
                  const unit = safeStr(l.unit || l.item?.unit || "");
                  const qty = num(l.qty);
                  const price = num(l.price);
                  const lineTotal = qty * price;

                  return (
                    <tr key={safeStr(l.id || idx)} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium">{name || "(Không tên)"}</td>
                      <td className="px-2">{unit}</td>
                      <td className="text-right px-2">{qty.toLocaleString("vi-VN")}</td>
                      <td className="text-right px-2">{money(price)}</td>
                      <td className="text-right px-2 font-semibold">{money(lineTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border rounded p-3">
        <div className="font-medium mb-2">Lịch sử thanh toán</div>

        {paymentRows.length === 0 ? (
          <div className="text-sm text-gray-500">Chưa có phiếu thu/chi liên quan hoá đơn.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-2">Ngày</th>
                  <th className="text-left px-2">Loại</th>
                  <th className="text-left px-2">Tài khoản</th>
                  <th className="text-left px-2">Phương thức</th>
                  <th className="text-left px-2">Mã tham chiếu</th>
                  <th className="text-right px-2">Số tiền phiếu</th>
                  <th className="text-right px-2">NORMAL</th>
                  <th className="text-right px-2">HOLD</th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map((p: any) => (
                  <tr key={p.paymentId} className="border-b last:border-0">
                    <td className="py-2 px-2">{fmtDateVN(p.date)}</td>
                    <td className="px-2">{p.type || "-"}</td>
                    <td className="px-2">{p.account || "-"}</td>
                    <td className="px-2">{p.method || "-"}</td>
                    <td className="px-2">{p.refNo || "-"}</td>
                    <td className="text-right px-2 font-semibold">{money(p.amount)}</td>
                    <td className="text-right px-2">{money(p.normal)}</td>
                    <td className="text-right px-2">{money(p.hold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {safeStr(inv.note) && (
        <div className="border rounded p-3">
          <div className="font-medium mb-1">Ghi chú</div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap">{safeStr(inv.note)}</div>
        </div>
      )}
    </div>
  );
}
