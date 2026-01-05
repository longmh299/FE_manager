import React, { useEffect, useMemo, useState } from "react";
import api from "../api/client";

/* =======================
   Types (loose + safe)
======================= */
type Summary = {
  revenue: number; // NET = subtotal
  collected: number; // legacy NET
  collectedGross?: number; // gross cash (ưu tiên nếu có)
  outstanding: number; // legacy

  normalOutstanding?: number;
  holdOutstanding?: number;
  totalOutstanding?: number;

  orderCount: number;
};

type DebtRow = {
  invoiceId: string;
  invoiceCode: string;
  customerName: string;

  date?: string;
  issueDate?: string;

  invoiceTotal?: number;
  totalAmount?: number;
  total?: number;

  paid?: number;
  paidAmount?: number;
  collected?: number;
  collectedGross?: number;

  normalOutstanding?: number;
  holdOutstanding?: number;
  totalOutstanding?: number;

  subtotal?: number;
};

type DashboardResp = {
  period?: { from?: string; to?: string; month?: number; year?: number };
  summary?: Summary;
  trend?: any[];
  debts?: DebtRow[];
  invoices?: any[];
  customers?: any[];
};

type InvoiceDetailResp = { ok: boolean; data: any };

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
function hasVal(v: any) {
  return v !== undefined && v !== null;
}

function unwrapData<T = any>(resData: any): T {
  if (resData && typeof resData === "object" && "ok" in resData && "data" in resData) {
    return resData.data as T;
  }
  return resData as T;
}

// pick common helpers
function pickTotal(d: any): number {
  return num(d?.invoiceTotal ?? d?.totalAmount ?? d?.total ?? d?.grandTotal ?? 0);
}
function pickPaidGross(d: any): number {
  // ưu tiên paid/paidAmount; ưu tiên collectedGross nếu có; fallback collected
  return num(d?.paid ?? d?.paidAmount ?? d?.paidTotal ?? d?.collectedGross ?? d?.collected ?? 0);
}

// invoice-history helpers
function pickInvId(d: any): string {
  return safeStr(d?.id ?? d?.invoiceId ?? "");
}
function pickInvCode(d: any): string {
  return safeStr(d?.code ?? d?.invoiceCode ?? d?.invoiceNo ?? "");
}
function pickInvCustomer(d: any): string {
  return (
    safeStr(d?.partnerName) ||
    safeStr(d?.customerName) ||
    safeStr(d?.partner?.name) ||
    safeStr(d?.snapshot?.partnerName) ||
    "Khách lẻ"
  );
}
function pickInvDate(d: any): any {
  return d?.issueDate ?? d?.date ?? d?.createdAt ?? d?.approvedAt ?? "";
}
function parseTime(d: any): number {
  const raw = pickInvDate(d);
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function pickInvHoldOutstanding(d: any): number {
  if (hasVal(d?.holdOutstanding) || hasVal(d?.warrantyOutstanding)) {
    return num(d?.holdOutstanding ?? d?.warrantyOutstanding ?? 0);
  }

  // fallback theo invoice warranty fields
  const total = pickTotal(d);
  const hasHold = Boolean(d?.hasWarrantyHold);
  if (!hasHold) return 0;

  const holdAmt = num(d?.warrantyHoldAmount);
  const holdPct = num(d?.warrantyHoldPct);
  const hold = holdAmt > 0 ? holdAmt : holdPct > 0 ? (total * holdPct) / 100 : 0;
  return Math.max(0, hold);
}

function pickInvNormalOutstanding(d: any): number {
  // ✅ nếu BE có field (dù = 0) thì dùng, không fallback
  if (hasVal(d?.normalOutstanding) || hasVal(d?.outstandingNormal)) {
    return num(d?.normalOutstanding ?? d?.outstandingNormal ?? 0);
  }

  // fallback: total - paid - hold
  const total = pickTotal(d);
  const paidGross = pickPaidGross(d);
  const outstanding = Math.max(0, total - paidGross);
  const hold = pickInvHoldOutstanding(d);
  return Math.max(0, outstanding - Math.max(0, hold));
}

function pickInvTotalOutstanding(d: any): number {
  if (hasVal(d?.totalOutstanding)) return num(d?.totalOutstanding);
  if (hasVal(d?.outstanding)) return num(d?.outstanding);

  // fallback: total - paid (gross)
  const total = pickTotal(d);
  const paidGross = pickPaidGross(d);
  return Math.max(0, total - paidGross);
}

function invoiceIsDebt(d: any): boolean {
  const normalO = pickInvNormalOutstanding(d);
  const holdO = pickInvHoldOutstanding(d);
  return normalO > 0.0001 || holdO > 0.0001;
}

/* =======================
   Modal
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl bg-white rounded-lg shadow-lg border">
          <div className="flex items-start justify-between gap-4 p-4 border-b">
            <div className="min-w-0">
              <div className="font-semibold text-lg truncate">{title || "Chi tiết"}</div>
            </div>
            <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={onClose}>
              Đóng
            </button>
          </div>

          <div className="p-4 max-h-[75vh] overflow-auto">{children}</div>

          <div className="p-4 border-t flex justify-end">
            <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={onClose}>
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
      <div className={`text-xl font-semibold ${highlight ? "text-red-600" : ""}`}>{value}</div>
      {subHint ? <div className="text-xs text-gray-500 mt-1">{subHint}</div> : null}
    </div>
  );
}

/* =======================
   Page
======================= */
type HistoryTab = "ALL" | "DEBT" | "PAID";

const MySalesDashboardPage: React.FC = () => {
  // ✅ date range filter
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  // history tabs + search
  const [tab, setTab] = useState<HistoryTab>("ALL");
  const [histSearch, setHistSearch] = useState("");

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
      const params: any = {};
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;

      const res = await api.get("/me/sales-dashboard", { params });
      const data = unwrapData<DashboardResp>(res.data);
      setDash(data || null);
    } catch (e: any) {
      setDash(null);
      setErr(e?.response?.data?.message || e?.message || "Không lấy được dữ liệu doanh thu cá nhân");
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
      setInvErr(e?.response?.data?.message || e?.message || "Không lấy được chi tiết hoá đơn");
    } finally {
      setInvLoading(false);
    }
  }

  function openInvoice(id: string) {
    setInvId(id);
    setOpenInv(true);
    fetchInvoiceDetail(id);
  }

  // ✅ vào trang auto load ALL TIME
  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view: Required<DashboardResp> = {
    period: dash?.period || {},
    summary:
      dash?.summary ||
      ({
        revenue: 0,
        collected: 0,
        collectedGross: 0,
        outstanding: 0,
        orderCount: 0,
      } as any),
    trend: Array.isArray(dash?.trend) ? dash!.trend! : [],
    debts: Array.isArray(dash?.debts) ? dash!.debts! : [],
    invoices: Array.isArray((dash as any)?.invoices) ? (dash as any).invoices : [],
    customers: Array.isArray((dash as any)?.customers) ? (dash as any).customers : [],
  };

  // KPI numbers
  const kpiNeedCollect = num((view.summary as any).normalOutstanding ?? view.summary.outstanding);
  const kpiHold = num((view.summary as any).holdOutstanding ?? 0);
  const kpiTotalDebt = num((view.summary as any).totalOutstanding ?? view.summary.outstanding);
  const kpiCollectedCash = num((view.summary as any).collectedGross ?? view.summary.collected);

  // ===== derive customer cards from debts =====
  const customerAgg = useMemo(() => {
    const m = new Map<
      string,
      { customerName: string; normalOutstanding: number; holdOutstanding: number; totalOutstanding: number; count: number }
    >();

    for (const d of view.debts) {
      const key = safeStr((d as any).customerName || "Khách lẻ");
      const cur = m.get(key) || {
        customerName: key,
        normalOutstanding: 0,
        holdOutstanding: 0,
        totalOutstanding: 0,
        count: 0,
      };

      cur.normalOutstanding += num((d as any).normalOutstanding ?? (d as any).outstanding ?? 0);
      cur.holdOutstanding += num((d as any).holdOutstanding ?? 0);
      cur.totalOutstanding += num((d as any).totalOutstanding ?? (d as any).outstanding ?? 0);
      cur.count += 1;

      m.set(key, cur);
    }

    return Array.from(m.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }, [view.debts]);

  const historyAll = useMemo(() => {
    const rows = Array.isArray(view.invoices) ? [...view.invoices] : [];
    rows.sort((a, b) => parseTime(b) - parseTime(a));
    return rows;
  }, [view.invoices]);

  const historyFiltered = useMemo(() => {
    let rows = historyAll;

    // tab filter
    if (tab === "DEBT") rows = rows.filter((r) => invoiceIsDebt(r));
    if (tab === "PAID") rows = rows.filter((r) => !invoiceIsDebt(r));

    // search filter
    const q = histSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const code = pickInvCode(r).toLowerCase();
        const name = pickInvCustomer(r).toLowerCase();
        return code.includes(q) || name.includes(q);
      });
    }

    return rows;
  }, [historyAll, tab, histSearch]);

  const counts = useMemo(() => {
    const total = historyAll.length;
    const debt = historyAll.filter((r) => invoiceIsDebt(r)).length;
    const paid = total - debt;
    return { total, debt, paid };
  }, [historyAll]);

  const rangeLabel = useMemo(() => {
    if (!fromDate && !toDate) return "Tất cả thời gian";
    const a = fromDate ? fmtDateVN(fromDate) : "…";
    const b = toDate ? fmtDateVN(toDate) : "…";
    return `${a} → ${b}`;
  }, [fromDate, toDate]);

  return (
    <div className="p-6 flex flex-col gap-6 min-h-screen">
      {/* Header */}
      <div className="flex items-start md:items-center justify-between gap-4 flex-col md:flex-row">
        <div>
          <h1 className="text-2xl font-semibold">Doanh thu của tôi</h1>
          <p className="text-sm text-gray-500">Nhân viên SALE</p>
          <p className="text-xs text-gray-500 mt-1">Khoảng thời gian: {rangeLabel}</p>
        </div>

        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">Từ ngày</label>
            <input
              type="date"
              className="border rounded px-2 py-2 bg-white"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">Đến ngày</label>
            <input
              type="date"
              className="border rounded px-2 py-2 bg-white"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <button
            className="px-4 py-2 rounded border bg-white hover:bg-gray-50"
            onClick={() => {
              setFromDate("");
              setToDate("");
              setTimeout(() => fetchDashboard(), 0);
            }}
            disabled={loading}
            title="Bỏ lọc (tất cả thời gian)"
          >
            Toàn bộ
          </button>

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
      {err && <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">{err}</div>}
      {loading && <div className="bg-white border rounded p-6 text-center text-gray-500">Đang tải dữ liệu…</div>}

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Kpi title="Doanh thu thuần" value={money(view.summary.revenue)} />
        <Kpi title="Đã thu (thực tế)" value={money(kpiCollectedCash)} />
        <Kpi title="Nợ cần thu" value={money(kpiNeedCollect)} highlight={kpiNeedCollect > 0} />
        <Kpi title="Số đơn" value={String(num(view.summary.orderCount))} />
      </div>

      {/* ✅ Fill remaining height: History + Quick debt */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        {/* History with tabs */}
        <div className="lg:col-span-2 bg-white rounded shadow border p-4 flex flex-col min-h-0">
          <div className="flex flex-col gap-3 mb-3">
            <div className="flex items-start md:items-center justify-between gap-3 flex-col md:flex-row">
              <div className="min-w-0">
                <h2 className="font-medium">Lịch sử hoá đơn bán</h2>
                <div className="text-xs text-gray-500">
                  Theo ngày phát hành hoá đơn • {historyFiltered.length} dòng
                </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="inline-flex rounded border overflow-hidden bg-white shrink-0">
                  <button
                    className={`px-3 py-2 text-sm ${tab === "ALL" ? "bg-blue-600 text-white" : "hover:bg-gray-50"}`}
                    onClick={() => setTab("ALL")}
                    type="button"
                  >
                    Tất cả
                  </button>
                  <button
                    className={`px-3 py-2 text-sm ${tab === "DEBT" ? "bg-blue-600 text-white" : "hover:bg-gray-50"}`}
                    onClick={() => setTab("DEBT")}
                    type="button"
                  >
                    Còn nợ
                  </button>
                  <button
                    className={`px-3 py-2 text-sm ${tab === "PAID" ? "bg-blue-600 text-white" : "hover:bg-gray-50"}`}
                    onClick={() => setTab("PAID")}
                    type="button"
                  >
                    Đã thu đủ
                  </button>
                </div>

                <input
                  className="border rounded px-3 py-2 text-sm w-full md:w-72 bg-white"
                  placeholder="Tìm mã HĐ / khách hàng"
                  value={histSearch}
                  onChange={(e) => setHistSearch(e.target.value)}
                  disabled={historyAll.length === 0}
                />
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Tổng: <b>{counts.total}</b> • Còn nợ: <b>{counts.debt}</b> • Đã thu đủ: <b>{counts.paid}</b>
            </div>
          </div>

          {/* ✅ Scroll INSIDE table area */}
          <div className="flex-1 min-h-0">
            {historyAll.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm border rounded">
                Không có dữ liệu hoá đơn trong khoảng thời gian
              </div>
            ) : historyFiltered.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm border rounded">
                Không có kết quả phù hợp
              </div>
            ) : (
              <div className="h-full overflow-auto border rounded">
                <table className="w-full text-sm min-w-[980px]">
                  <thead className="bg-gray-50 sticky top-0 z-10 border-b">
                    <tr>
                      <th className="text-left py-2 px-2">Ngày</th>
                      <th className="text-left px-2">Mã HĐ</th>
                      <th className="text-left px-2">Khách hàng</th>
                      <th className="text-right px-2">Tổng tiền</th>
                      <th className="text-right px-2">Đã thu</th>
                      <th className="text-right px-2 text-red-600">Còn thu</th>
                      <th className="text-right px-2">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyFiltered.map((r, idx) => {
                      const id = pickInvId(r) || `${idx}`;
                      const code = pickInvCode(r);
                      const customer = pickInvCustomer(r);
                      const date = pickInvDate(r);

                      const total = pickTotal(r);
                      const paidCash = pickPaidGross(r);

                      const normalO = pickInvNormalOutstanding(r);
                      const holdO = pickInvHoldOutstanding(r);
                      const totalO = pickInvTotalOutstanding(r);

                      return (
                        <tr key={id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 px-2">{fmtDateVN(date)}</td>

                          <td className="px-2">
                            <div className="font-medium">{code || "(Chưa có mã)"}</div>
                            {(r?.paymentStatus || r?.status) && (
                              <div className="text-xs text-gray-500">{safeStr(r?.paymentStatus || r?.status || "")}</div>
                            )}
                          </td>

                          <td className="px-2">{customer}</td>

                          <td className="text-right px-2 font-semibold">{money(total)}</td>
                          <td className="text-right px-2">{money(paidCash)}</td>

                          <td className="text-right px-2">
                            <div className={`font-semibold ${invoiceIsDebt(r) ? "text-red-600" : ""}`}>
                              {money(normalO)}
                            </div>
                            {holdO > 0 && (
                              <div className="text-xs text-amber-700">
                                BH treo: {money(holdO)} (tổng nợ: {money(totalO)})
                              </div>
                            )}
                          </td>

                          <td className="text-right px-2">
                            <button
                              className="px-3 py-1.5 rounded border hover:bg-white bg-gray-50"
                              onClick={() => {
                                const realId = pickInvId(r);
                                if (realId) openInvoice(String(realId));
                              }}
                              disabled={!pickInvId(r)}
                              title={!pickInvId(r) ? "Không có invoiceId để mở chi tiết" : "Xem chi tiết"}
                            >
                              Xem
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Quick debt */}
        <div className="bg-white rounded shadow border p-4 flex flex-col min-h-0">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Công nợ nhanh</h2>
            <div className="text-xs text-gray-500">{customerAgg.length} khách</div>
          </div>

          <div className="mt-3 space-y-1">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Nợ cần thu</span>
              <span className="font-semibold text-red-600">{money(kpiNeedCollect)}</span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Giữ tiền bảo hành</span>
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

          {/* ✅ list scroll inside */}
          <div className="mt-3 flex-1 min-h-0">
            {customerAgg.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-400 border rounded">
                Không có khách nợ trong khoảng thời gian
              </div>
            ) : (
              <div className="h-full overflow-auto border rounded p-2 space-y-2">
                {customerAgg.map((c) => (
                  <div
                    key={c.customerName}
                    className="flex items-center justify-between text-sm border rounded px-3 py-2 hover:bg-gray-50"
                    title="Xem chi tiết bằng cách bấm 'Xem' ở bảng lịch sử"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.customerName}</div>
                      <div className="text-xs text-gray-500">{c.count} HĐ nợ</div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div className="font-semibold text-red-600">{money(c.totalOutstanding)}</div>
                      {c.holdOutstanding > 0 && (
                        <div className="text-xs text-amber-700">BH treo: {money(c.holdOutstanding)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
          <div className="bg-white border rounded p-6 text-center text-gray-500">Đang tải chi tiết hoá đơn…</div>
        )}

        {invErr && <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">{invErr}</div>}

        {!invLoading && !invErr && inv && <InvoiceDetailView inv={inv} />}
      </Modal>
    </div>
  );
};

export default MySalesDashboardPage;

/* =======================
   Invoice Detail View (giữ nguyên)
======================= */
function InvoiceDetailView({ inv }: { inv: any }) {
  const partnerObj = inv.partner || null;

  const partnerName =
    safeStr(partnerObj?.name) || safeStr(inv.partnerName) || safeStr(inv.snapshot?.partnerName) || "Khách lẻ";

  const partnerPhone =
    safeStr(partnerObj?.phone) || safeStr(inv.partnerPhone) || safeStr(inv.snapshot?.partnerPhone) || "";

  const partnerEmail =
    safeStr(partnerObj?.email) || safeStr(inv.partnerEmail) || safeStr(inv.snapshot?.partnerEmail) || "";

  const partnerAddr =
    safeStr(partnerObj?.address) || safeStr(inv.partnerAddr) || safeStr(inv.snapshot?.partnerAddr) || "";

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

  const paidAmount = num(inv.paidAmount);
  const outstanding = Math.max(0, total - paidAmount);

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
            Trạng thái: {safeStr(inv.status || "")} • Thanh toán: {safeStr(inv.paymentStatus || "")}
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
            <span>Đã thu </span>
            <span className="font-semibold">{money(paidAmount)}</span>
          </div>

          <div className="text-sm flex justify-between">
            <span>Nợ cần thu</span>
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
        </div>
      </div>

      <div className="border rounded p-3">
        <div className="font-medium mb-2">Dòng hàng</div>

        {!hasLines ? (
          <div className="text-sm text-gray-500">Hoá đơn này chưa có dòng hàng (hoặc API đang không include lines).</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="text-left py-2 px-2">Sản phẩm</th>
                  
                  <th className="text-right px-2">SL</th>
                  <th className="text-right px-2">Đơn giá</th>
                  <th className="text-right px-2">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const name = safeStr(l.itemName || l.item?.name || "");
                  
                  const qty = num(l.qty);
                  const price = num(l.price);
                  const lineTotal = qty * price;

                  return (
                    <tr key={safeStr(l.id || idx)} className="border-b last:border-0">
                      <td className="py-2 px-2 font-medium">{name || "(Không tên)"}</td>
                      
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
                  <th className="text-right px-2">Đã thu</th>
                  <th className="text-right px-2">Tiền BH</th>
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
