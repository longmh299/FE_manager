// src/pages/InvoiceTracePage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ToastHost, useToast } from "../components/Toast";
import {
  traceInvoicesByItemCode,
  type InvoiceTraceRow,
  type InvoiceTraceType,
  type InvoiceTraceStatus,
} from "../api/invoiceTrace";
import { useAuth } from "../context/AuthContext";

function safeNum(v: any) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n: number) {
  return safeNum(n).toLocaleString("vi-VN");
}

function fmtQty(n: number) {
  const v = safeNum(n);
  const isInt = Math.abs(v - Math.round(v)) < 1e-9;
  return isInt ? String(Math.round(v)) : v.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

function fmtDate(v?: string) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const TYPE_VALUES: InvoiceTraceType[] = ["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"];
const STATUS_VALUES: InvoiceTraceStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"];

const TYPE_OPTIONS: { value: InvoiceTraceType; label: string }[] = [
  { value: "SALES", label: "Hóa đơn bán" },
  { value: "PURCHASE", label: "Hóa đơn nhập" },
  { value: "SALES_RETURN", label: "Khách trả hàng" },
  { value: "PURCHASE_RETURN", label: "Xuất trả NCC" },
];

const STATUS_OPTIONS: { value: InvoiceTraceStatus | ""; label: string }[] = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "DRAFT", label: "Nháp" },
  { value: "SUBMITTED", label: "Chờ duyệt" },
  { value: "APPROVED", label: "Đã duyệt" },
  { value: "REJECTED", label: "Từ chối" },
  { value: "CANCELLED", label: "Đã hủy" },
];

function typeLabel(t: InvoiceTraceType) {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function statusBadge(status: InvoiceTraceStatus) {
  let label = "";
  let cls =
    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ";
  if (status === "DRAFT") {
    label = "Nháp";
    cls += "bg-gray-100 text-gray-700 border-gray-200";
  } else if (status === "SUBMITTED") {
    label = "Chờ duyệt";
    cls += "bg-orange-100 text-orange-700 border-orange-200";
  } else if (status === "APPROVED") {
    label = "Đã duyệt";
    cls += "bg-green-100 text-green-700 border-green-200";
  } else if (status === "CANCELLED") {
    label = "Đã hủy";
    cls += "bg-slate-200 text-slate-600 border-slate-300";
  } else {
    label = "Từ chối";
    cls += "bg-red-100 text-red-700 border-red-200";
  }
  return <span className={cls}>{label}</span>;
}

const PAGE_SIZE = 20;

type QueryState = {
  code: string;
  type: InvoiceTraceType;
  from: string;
  to: string;
  status: InvoiceTraceStatus | "";
  page: number;
};

const InvoiceTracePage: React.FC = () => {
  const { toasts, push, remove } = useToast();
  const { user } = useAuth();
  const canSeeCost = user?.role === "admin" || user?.role === "accountant";

  const pushRef = useRef(push);
  useEffect(() => {
    pushRef.current = push;
  }, [push]);

  // ✅ đồng bộ filter vào URL query để không mất khi bấm Back từ trang chi tiết hóa đơn
  const location = useLocation();
  const [sp, setSp] = useSearchParams();

  const readQuery = (): QueryState => {
    const codeQ = sp.get("code") ?? "";
    const typeRaw = sp.get("type") ?? "SALES";
    const typeQ = (TYPE_VALUES as string[]).includes(typeRaw) ? (typeRaw as InvoiceTraceType) : "SALES";
    const fromQ = sp.get("from") ?? "";
    const toQ = sp.get("to") ?? "";
    const statusRaw = sp.get("status") ?? "";
    const statusQ = (STATUS_VALUES as string[]).includes(statusRaw) ? (statusRaw as InvoiceTraceStatus) : "";
    const pageQ = Number(sp.get("page")) || 1;
    return { code: codeQ, type: typeQ, from: fromQ, to: toQ, status: statusQ, page: pageQ };
  };

  const writeQuery = (next: QueryState) => {
    const params: any = {};
    if (next.code.trim()) params.code = next.code.trim();
    if (next.type) params.type = next.type;
    if (next.from) params.from = next.from;
    if (next.to) params.to = next.to;
    if (next.status) params.status = next.status;
    if (next.page > 1) params.page = String(next.page);
    setSp(params, { replace: true });
  };

  // ✅ key đổi mỗi lần điều hướng (kể cả bấm Back/Forward) -> đọc lại URL
  const initial = useMemo(() => readQuery(), [location.key]);

  const [code, setCode] = useState(initial.code);
  const [type, setType] = useState<InvoiceTraceType>(initial.type);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [status, setStatus] = useState<InvoiceTraceStatus | "">(initial.status);

  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [rows, setRows] = useState<InvoiceTraceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initial.page);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function runSearch(q: QueryState, opts?: { silent?: boolean }) {
    const trimmed = q.code.trim();
    if (!trimmed) {
      setSearched(false);
      setRows([]);
      setTotal(0);
      return;
    }

    try {
      setLoading(true);
      const result = await traceInvoicesByItemCode({
        code: trimmed,
        type: q.type,
        from: q.from || undefined,
        to: q.to || undefined,
        status: q.status || undefined,
        page: q.page,
        pageSize: PAGE_SIZE,
      });

      setRows(result.data);
      setTotal(result.total);
      setPage(result.page);
      setSearched(true);

      if (!opts?.silent && result.total === 0) {
        pushRef.current({
          type: "info",
          title: "Không tìm thấy",
          message: `Không có ${typeLabel(q.type).toLowerCase()} nào chứa sản phẩm mã "${trimmed}".`,
        });
      }
    } catch (e: any) {
      pushRef.current({
        type: "error",
        title: "Lỗi tra cứu",
        message: e?.response?.data?.message || e?.message || "Không tra cứu được dữ liệu.",
      });
    } finally {
      setLoading(false);
    }
  }

  // ✅ mỗi khi vào trang (kể cả bấm Back từ trang chi tiết hóa đơn), đọc lại URL
  // và tự tra cứu lại nếu trước đó đã có mã sản phẩm -> không còn bị "trắng tinh"
  useEffect(() => {
    const q0 = readQuery();
    setCode(q0.code);
    setType(q0.type);
    setFrom(q0.from);
    setTo(q0.to);
    setStatus(q0.status);
    setPage(q0.page);

    if (q0.code.trim()) {
      runSearch(q0, { silent: true });
    } else {
      setSearched(false);
      setRows([]);
      setTotal(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  function handleSearch(nextPage = 1) {
    const trimmed = code.trim();
    if (!trimmed) {
      pushRef.current({
        type: "warning",
        title: "Thiếu mã sản phẩm",
        message: "Vui lòng nhập mã sản phẩm cần tra cứu.",
      });
      return;
    }
    const q: QueryState = { code: trimmed, type, from, to, status, page: nextPage };
    writeQuery(q);
    runSearch(q);
  }

  return (
    <div className="space-y-4">
      <ToastHost toasts={toasts} onClose={remove} />

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h1 className="text-lg font-semibold text-slate-800 mb-3">Truy xuất hóa đơn theo mã sản phẩm</h1>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <div className="text-xs text-slate-500 mb-1">Mã sản phẩm (SKU) *</div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!loading) handleSearch(1);
                }
              }}
              placeholder="Nhập mã sản phẩm..."
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div className="min-w-[200px]">
            <div className="text-xs text-slate-500 mb-1">Loại hóa đơn *</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as InvoiceTraceType)}
              className="w-full border border-slate-300 rounded px-3 py-2 bg-white"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Từ ngày</div>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div>
            <div className="text-xs text-slate-500 mb-1">Đến ngày</div>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2"
            />
          </div>

          <div className="min-w-[170px]">
            <div className="text-xs text-slate-500 mb-1">Trạng thái</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as InvoiceTraceStatus | "")}
              className="w-full border border-slate-300 rounded px-3 py-2 bg-white"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => handleSearch(1)}
            disabled={loading}
            className={`px-4 py-2 rounded bg-slate-900 text-white hover:bg-slate-800 ${
              loading ? "opacity-60 cursor-not-allowed" : ""
            }`}
          >
            {loading ? "Đang tra cứu..." : "Tra cứu"}
          </button>
        </div>

        {searched ? (
          <div className="mt-3 text-xs text-slate-500">
            Tìm thấy <span className="font-semibold text-slate-700">{total}</span> dòng sản phẩm khớp mã{" "}
            <span className="font-semibold text-slate-700">"{code.trim()}"</span> trong{" "}
            <span className="font-semibold text-slate-700">{typeLabel(type).toLowerCase()}</span>.
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="bg-slate-50 sticky top-0 z-10">
                <th className="px-4 py-3 border-b border-slate-200 text-left">Mã hóa đơn</th>
                <th className="px-4 py-3 border-b border-slate-200 text-left">Loại</th>
                <th className="px-4 py-3 border-b border-slate-200 text-left">Trạng thái</th>
                <th className="px-4 py-3 border-b border-slate-200 text-left">Ngày</th>
                <th className="px-4 py-3 border-b border-slate-200 text-left">Đối tác</th>
                <th className="px-4 py-3 border-b border-slate-200 text-left">Mã SP</th>
                <th className="px-4 py-3 border-b border-slate-200 text-left">Tên SP</th>
                <th className="px-4 py-3 border-b border-slate-200 text-right">SL</th>
                <th className="px-4 py-3 border-b border-slate-200 text-right">Đơn giá</th>
                <th className="px-4 py-3 border-b border-slate-200 text-right">Thành tiền</th>
                {canSeeCost ? (
                  <th className="px-4 py-3 border-b border-slate-200 text-right">Giá vốn</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lineId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">
                    <Link to={`/invoices/${r.invoiceId}`} className="text-blue-600 hover:underline">
                      {r.invoiceCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">
                    {typeLabel(r.invoiceType)}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">
                    {statusBadge(r.status)}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">
                    {fmtDate(r.issueDate)}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100">{r.partnerName || "—"}</td>
                  <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">{r.itemSku || "—"}</td>
                  <td className="px-4 py-3 border-b border-slate-100">{r.itemName || "—"}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right">{fmtQty(r.qty)}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right">{fmtMoney(r.price)}</td>
                  <td className="px-4 py-3 border-b border-slate-100 text-right font-medium">
                    {fmtMoney(r.amount)}
                  </td>
                  {canSeeCost ? (
                    <td className="px-4 py-3 border-b border-slate-100 text-right text-slate-500">
                      {r.unitCost != null ? fmtMoney(r.unitCost) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}

              {!loading && searched && rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-slate-500" colSpan={canSeeCost ? 11 : 10}>
                    Không có dữ liệu khớp.
                  </td>
                </tr>
              ) : null}

              {!loading && !searched ? (
                <tr>
                  <td className="px-4 py-8 text-slate-500" colSpan={canSeeCost ? 11 : 10}>
                    Nhập mã sản phẩm và chọn loại hóa đơn để tra cứu.
                  </td>
                </tr>
              ) : null}

              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-slate-500" colSpan={canSeeCost ? 11 : 10}>
                    Đang tải...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {searched && total > 0 ? (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
            <div className="text-slate-600">
              Trang <b>{page}</b> / <b>{totalPages}</b> — {PAGE_SIZE} dòng / trang — Tổng {total} dòng
            </div>

            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                disabled={page <= 1 || loading}
                onClick={() => handleSearch(page - 1)}
              >
                ← Trước
              </button>

              <button
                className="px-3 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                disabled={page >= totalPages || loading}
                onClick={() => handleSearch(page + 1)}
              >
                Sau →
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default InvoiceTracePage;