// src/pages/InvoiceStatusAdminPage.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/client";

type InvoiceRow = {
  id: string;
  code?: string | null;
  type?: string | null; // SALES | PURCHASE | ...
  status?: string | null; // DRAFT | SUBMITTED | APPROVED | ...
  paymentStatus?: string | null; // UNPAID | PARTIAL | PAID
  partnerName?: string | null;
  total?: number | null;
  issueDate?: string | null; // ISO
};

type Toast =
  | { type: "success" | "error" | "warning"; message: string }
  | null;

function getErrMsg(e: any) {
  const msg =
    e?.response?.data?.message ||
    e?.response?.data?.error ||
    e?.message ||
    "Có lỗi xảy ra";
  const code = e?.response?.status;
  return code ? `${code} | ${msg}` : String(msg);
}

function normCode(s: string) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function looksLikeId(s: string) {
  const x = String(s || "").trim();
  // cuid thường dài ~25+ và toàn chữ/số
  return x.length >= 20 && /^[a-z0-9]+$/i.test(x);
}

function fmtMoney(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("vi-VN") + " đ";
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return String(iso);
  }
}

function statusVi(s?: string | null) {
  const x = String(s || "").toUpperCase();
  if (x === "DRAFT") return "Nháp";
  if (x === "SUBMITTED") return "Chờ duyệt";
  if (x === "APPROVED") return "Đã duyệt";
  if (x === "REJECTED") return "Từ chối";
  if (x === "CANCELLED") return "Hủy";
  return s || "—";
}

function typeVi(t?: string | null) {
  const x = String(t || "").toUpperCase();
  if (x === "SALES") return "Bán";
  if (x === "PURCHASE") return "Nhập";
  if (x === "SALES_RETURN") return "Trả hàng (bán)";
  if (x === "PURCHASE_RETURN") return "Trả NCC";
  return t || "—";
}

function payVi(p?: string | null) {
  const x = String(p || "").toUpperCase();
  if (x === "UNPAID") return "Chưa TT";
  if (x === "PAID") return "Đã TT";
  if (x === "PARTIAL") return "TT một phần";
  return p || "—";
}

const chipBase = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold";
function chip(kind: "slate" | "green" | "amber" | "blue" | "red") {
  if (kind === "green") return `${chipBase} bg-green-50 border-green-200 text-green-700`;
  if (kind === "amber") return `${chipBase} bg-amber-50 border-amber-200 text-amber-800`;
  if (kind === "blue") return `${chipBase} bg-blue-50 border-blue-200 text-blue-700`;
  if (kind === "red") return `${chipBase} bg-red-50 border-red-200 text-red-700`;
  return `${chipBase} bg-slate-50 border-slate-200 text-slate-700`;
}

const cardCls = "rounded-xl border border-slate-200 bg-white shadow-sm";
const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400";
const labelCls = "text-xs font-semibold text-slate-600";
const btnPrimary =
  "inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50";

const ALL = "";

const InvoiceStatusAdminPage: React.FC = () => {
  const [toast, setToast] = useState<Toast>(null);

  // filters
  const [codeInput, setCodeInput] = useState("");
  const [type, setType] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [paymentStatus, setPaymentStatus] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // data
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<InvoiceRow[]>([]);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);

  // action
  const [toStatus, setToStatus] = useState<string>("DRAFT");
  const [updating, setUpdating] = useState(false);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 2500);
  }, []);

  const reset = () => {
    setCandidates([]);
    setSelected(null);
    setToStatus("DRAFT");
  };

  const resetFilters = () => {
    setCodeInput("");
    setType(ALL);
    setStatus(ALL);
    setPaymentStatus(ALL);
    setFrom("");
    setTo("");
    reset();
  };

  const pickBestMatch = (q: string, list: InvoiceRow[]) => {
    const nq = normCode(q);
    if (!nq) return { best: null as InvoiceRow | null, list: [] as InvoiceRow[] };

    // so code "71" match "0071" / "INV0071"
    const scored = list
      .map((inv) => {
        const c = normCode(inv.code || "");
        let score = 0;
        if (!c) score = 0;
        else {
          if (c === nq) score += 100;
          if (c.endsWith(nq)) score += 70;
          if (c.includes(nq)) score += 40;
          // nếu q là số ngắn, ưu tiên match phần đuôi
          if (/^\d+$/.test(nq) && c.endsWith(nq.padStart(4, "0"))) score += 80;
        }
        return { inv, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const filtered = scored.map((x) => x.inv);
    return { best: filtered[0] || null, list: filtered };
  };

  const search = useCallback(async () => {
    const q = codeInput.trim();
    if (!q) {
      showToast({ type: "warning", message: "Nhập mã hóa đơn hoặc ID để tìm." });
      return;
    }

    setLoading(true);
    setSelected(null);
    setCandidates([]);
    try {
      // Nếu user dán thẳng invoiceId -> gọi GET /invoices/:id luôn cho chắc
      if (looksLikeId(q)) {
        const resp = await api.get(`/invoices/${q}`);
        const inv = resp?.data?.data || resp?.data;
        if (!inv?.id) throw new Error("Không tìm thấy hóa đơn");
        const one: InvoiceRow = {
          id: inv.id,
          code: inv.code,
          type: inv.type,
          status: inv.status,
          paymentStatus: inv.paymentStatus,
          partnerName: inv.partner?.name || inv.partnerName,
          total: inv.total,
          issueDate: inv.issueDate,
        };
        setSelected(one);
        setCandidates([one]);
        setToStatus("DRAFT");
        return;
      }

      const params: any = {
        q,
        page: 1,
        pageSize: 30,
      };
      if (type) params.type = type;
      if (status) params.status = status;
      if (paymentStatus) params.paymentStatus = paymentStatus;
      if (from) params.from = from;
      if (to) params.to = to;

      const resp = await api.get("/invoices", { params });
      const rows = (resp?.data?.data || resp?.data?.rows || resp?.data || []) as any[];

      const list: InvoiceRow[] = Array.isArray(rows)
        ? rows.map((x) => ({
            id: x.id,
            code: x.code,
            type: x.type,
            status: x.status,
            paymentStatus: x.paymentStatus,
            partnerName: x.partner?.name || x.partnerName,
            total: x.total,
            issueDate: x.issueDate,
          }))
        : [];

      const matched = pickBestMatch(q, list);
      if (!matched.list.length) {
        showToast({ type: "error", message: "Không tìm thấy hóa đơn (thử nhập: 71, 0071, INV-0071...)." });
        return;
      }

      setCandidates(matched.list);
      setSelected(matched.best);
      setToStatus("DRAFT");
    } catch (e: any) {
      showToast({ type: "error", message: getErrMsg(e) });
    } finally {
      setLoading(false);
    }
  }, [codeInput, type, status, paymentStatus, from, to, showToast]);

  // Enter để tìm
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter") {
        const el = ev.target as any;
        const tag = String(el?.tagName || "").toLowerCase();
        // đừng bắt enter trong textarea
        if (tag === "textarea") return;
        search();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search]);

  const canUpdate = useMemo(() => {
    return !!selected?.id && !!toStatus && !loading && !updating;
  }, [selected, toStatus, loading, updating]);

  const updateStatus = useCallback(async () => {
    if (!selected?.id) return;

    setUpdating(true);
    try {
      // ✅ route đúng theo audit bạn chụp: PATCH /api/invoices/:id/status
      const resp = await api.patch(`/invoices/${selected.id}/status`, {
        toStatus,
      });

      const inv = resp?.data?.data || resp?.data;
      // cập nhật lại UI sau khi đổi
      const next: InvoiceRow = {
        id: inv?.id || selected.id,
        code: inv?.code ?? selected.code,
        type: inv?.type ?? selected.type,
        status: inv?.status ?? toStatus,
        paymentStatus: inv?.paymentStatus ?? selected.paymentStatus,
        partnerName: inv?.partner?.name || inv?.partnerName || selected.partnerName,
        total: inv?.total ?? selected.total,
        issueDate: inv?.issueDate ?? selected.issueDate,
      };

      setSelected(next);
      setCandidates((prev) => prev.map((x) => (x.id === next.id ? next : x)));

      showToast({ type: "success", message: `Đã đổi trạng thái → ${statusVi(next.status)}` });
    } catch (e: any) {
      showToast({ type: "error", message: getErrMsg(e) });
    } finally {
      setUpdating(false);
    }
  }, [selected, toStatus, showToast]);

  return (
    <div className="w-full">
      <div className="w-full max-w-6xl mx-auto space-y-4">
        {/* TOAST */}
        {toast && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              toast.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : toast.type === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {toast.message}
          </div>
        )}

        {/* HEADER */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-bold text-slate-900">Admin đổi trạng thái hóa đơn</div>
            <div className="text-sm text-slate-600">
              Nhập mã → (lọc tuỳ chọn) → tìm hóa đơn → đổi trạng thái.
            </div>
          </div>

          <button className={btnPrimary} onClick={search} disabled={loading || updating}>
            {loading ? "Đang tìm..." : "Tìm"}
          </button>
        </div>

        {/* FILTER CARD */}
        <div className={cardCls}>
          <div className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <div className="lg:col-span-3">
                <div className={labelCls}>Mã hóa đơn</div>
                <input
                  className={inputCls}
                  placeholder="Nhập mã hóa đơn"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                />
                
              </div>

              <div className="lg:col-span-1">
                <div className={labelCls}>Loại</div>
                <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                  <option value={ALL}>Tất cả</option>
                  <option value="SALES">Bán</option>
                  <option value="PURCHASE">Nhập</option>
                  <option value="SALES_RETURN">Trả hàng (bán)</option>
                  <option value="PURCHASE_RETURN">Trả NCC</option>
                </select>
              </div>

              <div className="lg:col-span-1">
                <div className={labelCls}>Trạng thái</div>
                <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value={ALL}>Tất cả</option>
                  <option value="DRAFT">Nháp</option>
                  <option value="SUBMITTED">Chờ duyệt</option>
                  <option value="APPROVED">Đã duyệt</option>
                  <option value="REJECTED">Từ chối</option>
                  <option value="CANCELLED">Hủy</option>
                </select>
              </div>

              <div className="lg:col-span-1">
                <div className={labelCls}>Thanh toán</div>
                <select className={inputCls} value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
                  <option value={ALL}>Tất cả</option>
                  <option value="UNPAID">Chưa TT</option>
                  <option value="PARTIAL">TT một phần</option>
                  <option value="PAID">Đã TT</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <div className={labelCls}>Từ ngày</div>
                <input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>

              <div className="lg:col-span-2">
                <div className={labelCls}>Đến ngày</div>
                <input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>

              <div className="lg:col-span-2 flex items-end gap-2">
                <button className={btnGhost + " w-full"} onClick={resetFilters} disabled={loading || updating}>
                  Xóa lọc
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CANDIDATES */}
        {candidates.length > 1 && (
          <div className={cardCls}>
            <div className="p-4">
              <div className="text-sm font-semibold text-slate-900">Có {candidates.length} kết quả phù hợp</div>
              <div className="text-xs text-slate-600 mt-1">Chọn đúng hóa đơn rồi mới đổi trạng thái.</div>

              <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2 border-b border-slate-200">Mã</th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-slate-200">Ngày</th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-slate-200">Khách</th>
                      <th className="text-right font-semibold px-3 py-2 border-b border-slate-200">Tổng</th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-slate-200">Trạng thái</th>
                      <th className="text-left font-semibold px-3 py-2 border-b border-slate-200">Thanh toán</th>
                      <th className="text-right font-semibold px-3 py-2 border-b border-slate-200">Chọn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((r) => {
                      const active = selected?.id === r.id;
                      return (
                        <tr key={r.id} className={active ? "bg-slate-50" : "hover:bg-slate-50"}>
                          <td className="px-3 py-2 border-b border-slate-100">
                            <span className="font-semibold">{r.code || "—"}</span>{" "}
                            <span className={chip("blue")}>{typeVi(r.type)}</span>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100">{fmtDate(r.issueDate)}</td>
                          <td className="px-3 py-2 border-b border-slate-100">{r.partnerName || "—"}</td>
                          <td className="px-3 py-2 border-b border-slate-100 text-right font-semibold">{fmtMoney(r.total)}</td>
                          <td className="px-3 py-2 border-b border-slate-100">
                            <span className={chip(r.status === "APPROVED" ? "green" : r.status === "SUBMITTED" ? "amber" : "slate")}>
                              {statusVi(r.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100">
                            <span className={chip(r.paymentStatus === "PAID" ? "green" : r.paymentStatus === "PARTIAL" ? "amber" : "slate")}>
                              {payVi(r.paymentStatus)}
                            </span>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-100 text-right">
                            <button className={btnGhost} onClick={() => setSelected(r)}>
                              {active ? "Đang chọn" : "Chọn"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SELECTED */}
        {selected && (
          <div className={cardCls}>
            <div className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={chip("slate")}>{selected.code || "—"}</span>
                    <span className={chip("blue")}>{typeVi(selected.type)}</span>
                    <span className={chip(selected.status === "APPROVED" ? "green" : selected.status === "SUBMITTED" ? "amber" : "slate")}>
                      {statusVi(selected.status)}
                    </span>
                    <span className={chip(selected.paymentStatus === "PAID" ? "green" : selected.paymentStatus === "PARTIAL" ? "amber" : "slate")}>
                      {payVi(selected.paymentStatus)}
                    </span>
                    <span className="text-xs text-slate-500 ml-2">Ngày: <b className="text-slate-900">{fmtDate(selected.issueDate)}</b></span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Khách</div>
                      <div className="text-sm font-semibold text-slate-900">{selected.partnerName || "—"}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Tổng tiền</div>
                      <div className="text-sm font-semibold text-slate-900">{fmtMoney(selected.total)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">ID</div>
                      <div className="text-xs font-mono text-slate-900 break-all">{selected.id}</div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button className={btnGhost} onClick={reset} disabled={loading || updating}>
                    Bỏ chọn
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200">
                <div className="text-sm font-semibold text-slate-900">Đổi trạng thái</div>
                <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end">
                  <div className="flex-1">
                    <div className={labelCls}>Chuyển sang</div>
                    <select className={inputCls} value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
                      <option value="DRAFT">Nháp (DRAFT)</option>
                      <option value="SUBMITTED">Chờ duyệt (SUBMITTED)</option>
                      <option value="APPROVED">Đã duyệt (APPROVED)</option>
                      <option value="REJECTED">Từ chối (REJECTED)</option>
                      <option value="CANCELLED">Hủy (CANCELLED)</option>
                    </select>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Lưu ý: luồng trạng thái do <b>BE</b> quyết định. Nếu BE chặn (vd có allocations/nghiệp vụ kho), hệ thống sẽ báo lỗi rõ ràng.
                    </div>
                  </div>

                  <button className={btnPrimary} onClick={updateStatus} disabled={!canUpdate}>
                    {updating ? "Đang cập nhật..." : "Cập nhật"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!selected && candidates.length === 0 && (
          <div className="text-sm text-slate-500">
            Nhập mã rồi bấm <b>Tìm</b> (hoặc Enter). Trang này không load list sẵn để khỏi lệch dữ liệu.
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceStatusAdminPage;
