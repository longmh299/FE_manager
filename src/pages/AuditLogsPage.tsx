// src/pages/AuditLogsPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getAuditLogById, listAuditLogs } from "../api/auditLogs";
import type { AuditLogRow } from "../api/auditLogs";

type ToastState =
  | {
      type: "success" | "error";
      message: string;
    }
  | null;

const PAGE_SIZE_DEFAULT = 30;

/** ========================= Date helpers ========================= **/

function toDateOnly(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function toTimeOnly(iso: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return "";
  }
}

function safeJsonStringify(v: any) {
  if (v == null) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function clampPage(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 1) return 1;
  return Math.floor(x);
}

function normalizeListResp(resp: any): { total: number; page: number; pageSize: number; rows: AuditLogRow[] } {
  // BE có thể trả:
  // 1) { total, page, pageSize, rows }
  // 2) { ok: true, data: { total, page, pageSize, rows } }
  // 3) { ok: true, total, page, pageSize, rows }
  const root = resp?.data && typeof resp.data === "object" ? resp.data : resp;
  const data = root?.data && typeof root.data === "object" ? root.data : root;

  const total = Number(data?.total ?? root?.total ?? 0) || 0;
  const page = Number(data?.page ?? root?.page ?? 1) || 1;
  const pageSize = Number(data?.pageSize ?? root?.pageSize ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT;

  const rows = (data?.rows ?? root?.rows ?? data?.items ?? root?.items ?? data ?? root ?? []) as AuditLogRow[];
  return { total, page, pageSize, rows: Array.isArray(rows) ? rows : [] };
}

function normalizeDetailResp(resp: any): any | null {
  // BE có thể trả:
  // 1) AuditLogRow + before/after/meta
  // 2) { ok:true, data: {...} }
  const root = resp?.data && typeof resp.data === "object" ? resp.data : resp;
  const row = root?.data && typeof root.data === "object" ? root.data : root;
  if (!row || typeof row !== "object") return null;
  return row;
}

/** ========================= Vietnamese mapping ========================= **/

function roleVi(role: string) {
  const r = String(role || "").toLowerCase();
  if (r === "admin") return "Quản trị";
  if (r === "accountant") return "Kế toán";
  if (r === "staff") return "Nhân viên";
  return role || "";
}

function entityVi(entity: string) {
  const e = String(entity || "");
  const map: Record<string, string> = {
    Invoice: "Hóa đơn",
    Payment: "Phiếu thu/chi",
    PaymentAllocation: "Phân bổ thanh toán",
    WarrantyHold: "Bảo hành treo",
    Movement: "Phiếu kho",
    MovementLine: "Dòng phiếu kho",
    Stock: "Tồn kho",
    StockSnapshot: "Snapshot tồn kho",
    StockCount: "Kiểm kê",
    User: "Người dùng",
    Partner: "Khách hàng/Đối tác",
    Item: "Sản phẩm",
    Location: "Kho",
    PaymentAccount: "Tài khoản thanh toán",
  };
  return map[e] || e;
}

function actionVi(action: string) {
  const a = String(action || "").toUpperCase();

  const map: Record<string, string> = {
    INVOICE_CREATE: "Tạo hóa đơn",
    INVOICE_UPDATE: "Cập nhật hóa đơn",
    INVOICE_SUBMIT: "Gửi duyệt hóa đơn",
    INVOICE_APPROVE: "Duyệt hóa đơn",
    INVOICE_REJECT: "Từ chối hóa đơn",
    INVOICE_CANCEL: "Hủy hóa đơn",

    PAYMENT_CREATE: "Tạo phiếu thu/chi",
    PAYMENT_UPDATE: "Cập nhật phiếu thu/chi",
    PAYMENT_APPLY_ALLOCATIONS: "Áp phân bổ thanh toán",

    WARRANTY_HOLD_UPDATE_FROM_PAYMENT: "Cập nhật bảo hành treo từ thanh toán",

    INVOICE_ORIGIN_APPLY_RETURN: "Gắn phiếu trả hàng vào hóa đơn gốc",
    SALES_RETURN_CREATE: "Tạo phiếu trả hàng (bán)",
    SALES_RETURN_SUBMIT: "Gửi duyệt phiếu trả hàng",
    SALES_RETURN_APPROVE: "Duyệt phiếu trả hàng",
  };

  if (map[a]) return map[a];

  // fallback theo keyword
  if (a.includes("CREATE")) return "Tạo mới";
  if (a.includes("SUBMIT")) return "Gửi duyệt";
  if (a.includes("APPROVE")) return "Duyệt";
  if (a.includes("REJECT")) return "Từ chối";
  if (a.includes("CANCEL")) return "Hủy";
  if (a.includes("DELETE") || a.includes("REMOVE")) return "Xóa";
  if (a.includes("UPDATE") || a.includes("PATCH")) return "Cập nhật";
  if (a.includes("APPLY")) return "Áp dụng";
  return action || "";
}

/** ========================= Chips / UI ========================= **/

const chipBase = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";
function chipColor(kind: "neutral" | "green" | "blue" | "red" | "amber") {
  if (kind === "green") return `${chipBase} bg-green-50 border-green-200 text-green-700`;
  if (kind === "blue") return `${chipBase} bg-blue-50 border-blue-200 text-blue-700`;
  if (kind === "red") return `${chipBase} bg-red-50 border-red-200 text-red-700`;
  if (kind === "amber") return `${chipBase} bg-amber-50 border-amber-200 text-amber-800`;
  return `${chipBase} bg-slate-50 border-slate-200 text-slate-700`;
}

function actionChipKind(action: string) {
  const a = String(action || "").toUpperCase();
  if (a.includes("DELETE") || a.includes("REMOVE") || a.includes("REJECT") || a.includes("CANCEL")) return "red";
  if (a.includes("CREATE") || a.includes("POST") || a.includes("APPROVE") || a.includes("SUBMIT")) return "green";
  if (a.includes("UPDATE") || a.includes("PATCH") || a.includes("APPLY") || a.includes("SYNC")) return "blue";
  return "neutral";
}

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400";
const labelCls = "text-xs font-semibold text-slate-600";
const btnPrimary =
  "inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50";
const btnGhost =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50";
const cardCls = "rounded-xl border border-slate-200 bg-white shadow-sm";

/** ========================= Diff engine ========================= **/

type DiffKind = "ADDED" | "REMOVED" | "CHANGED";

type DiffRow = {
  path: string;
  label: string;
  kind: DiffKind;
  before: any;
  after: any;
  score: number;
};

function isPrimitive(v: any) {
  return v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function stableStringify(v: any): string {
  try {
    if (isPrimitive(v)) return String(v);
    if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
    if (typeof v === "object") {
      const keys = Object.keys(v).sort();
      return `{${keys.map((k) => `${k}:${stableStringify(v[k])}`).join(",")}}`;
    }
    return String(v);
  } catch {
    return String(v);
  }
}

function deepEqual(a: any, b: any) {
  if (a === b) return true;
  if (isPrimitive(a) && isPrimitive(b)) return String(a) === String(b);
  return stableStringify(a) === stableStringify(b);
}

function normalizeArrayForDiff(arr: any[]): any {
  // Nếu là mảng object có id/code -> chuyển thành object để diff dễ đọc hơn
  const allObj = arr.every((x) => x && typeof x === "object" && !Array.isArray(x));
  if (!allObj) return arr;

  const hasIdOrCode = arr.every((x) => typeof x.id === "string" || typeof x.code === "string");
  if (!hasIdOrCode) return arr;

  const out: any = {};
  for (const x of arr) {
    const key = (typeof x.code === "string" && x.code) || (typeof x.id === "string" && x.id) || "unknown";
    out[key] = x;
  }
  return out;
}

function flatten(obj: any, prefix = "", out: Map<string, any> = new Map()) {
  const key = prefix || "(root)";
  if (obj == null) {
    out.set(key, obj);
    return out;
  }

  if (isPrimitive(obj)) {
    out.set(key, obj);
    return out;
  }

  if (Array.isArray(obj)) {
    const norm = normalizeArrayForDiff(obj);

    if (!Array.isArray(norm)) {
      return flatten(norm, prefix, out);
    }

    const allPrim = norm.every((x) => isPrimitive(x));
    if (allPrim && norm.length <= 30) {
      out.set(key, `Danh sách (${norm.length} mục)`);
      norm.forEach((v, i) => out.set(`${prefix}[${i}]`, v));
      return out;
    }

    out.set(key, { __type: "array", length: norm.length });
    return out;
  }

  if (typeof obj === "object") {
    if (!prefix) out.set("(root)", { __type: "object" });

    const keys = Object.keys(obj);
    if (keys.length === 0) {
      out.set(key, {});
      return out;
    }

    for (const k of keys) {
      const next = prefix ? `${prefix}.${k}` : k;
      const v = obj[k];

      if (isPrimitive(v)) {
        out.set(next, v);
      } else if (Array.isArray(v)) {
        flatten(v, next, out);
      } else if (v && typeof v === "object") {
        const depth = next.split(".").length;
        if (depth > 10) out.set(next, { __type: "object", note: "đã giới hạn độ sâu" });
        else flatten(v, next, out);
      } else {
        out.set(next, v);
      }
    }
  }

  return out;
}

function friendlyLabel(path: string) {
  const p = path;

  const rules: Array<[RegExp, string]> = [
    [/invoicePaidAmount/i, "Đã thu trên hóa đơn"],
    [/paidAmount$/i, "Đã thu (thanh toán thường)"],
    [/paymentStatus$/i, "Trạng thái thanh toán"],
    [/status$/i, "Trạng thái chứng từ"],
    [/issueDate/i, "Ngày chứng từ"],
    [/partnerName/i, "Khách hàng"],
    [/partnerId/i, "Mã khách hàng"],
    [/code$/i, "Mã chứng từ"],

    [/total$/i, "Tổng tiền"],
    [/subtotal$/i, "Tạm tính"],
    [/taxPercent$/i, "VAT (%)"],
    [/tax$/i, "VAT (tiền)"],
    [/netTotal/i, "Tổng (chưa VAT / NET)"],
    [/grossTotal/i, "Tổng (đã VAT / GROSS)"],

    [/hasWarrantyHold/i, "Có giữ bảo hành treo"],
    [/warrantyHoldPct/i, "Bảo hành treo (%)"],
    [/warrantyHoldAmount/i, "Bảo hành treo (tiền)"],
    [/holdAmount/i, "Bảo hành treo (tiền)"],
    [/collectible/i, "Cần thu (không gồm BH treo)"],
    [/paidHoldNet/i, "Đã giữ BH treo"],

    [/allocations/i, "Phân bổ thanh toán"],
    [/amount$/i, "Số tiền"],
    [/kind$/i, "Loại"],
  ];

  for (const [re, label] of rules) if (re.test(p)) return label;

  const seg = p.replace(/\(root\)/g, "").split(".").filter(Boolean).pop() || p;
  return seg;
}

function scorePath(path: string) {
  const p = path.toLowerCase();
  let s = 0;
  if (p.includes("paid") || p.includes("amount") || p.includes("total") || p.includes("tax")) s += 5;
  if (p.includes("status")) s += 4;
  if (p.includes("warranty") || p.includes("hold") || p.includes("collectible")) s += 4;
  if (p.includes("partner") || p.includes("code") || p.includes("issue")) s += 2;

  if (p.includes("ip") || p.includes("useragent") || p.includes("headers") || p.includes("params") || p.includes("query")) s -= 3;
  if (p.includes("createdat") || p.includes("updatedat")) s -= 2;
  return s;
}

function formatValueForHuman(v: any) {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString("vi-VN") : String(v);
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `${toTimeOnly(v)} • ${toDateOnly(v)}`;
    return v.length > 160 ? v.slice(0, 160) + "…" : v;
  }
  if (v && typeof v === "object") {
    if (v.__type === "array") return `Danh sách (${v.length} mục)`;
    return "Dữ liệu (object)";
  }
  return String(v);
}

function buildDiff(before: any, after: any): DiffRow[] {
  const a = flatten(before ?? null);
  const b = flatten(after ?? null);

  const keys = new Set<string>();
  for (const k of a.keys()) keys.add(k);
  for (const k of b.keys()) keys.add(k);

  const out: DiffRow[] = [];
  for (const path of keys) {
    const bv = a.has(path) ? a.get(path) : undefined;
    const av = b.has(path) ? b.get(path) : undefined;

    if (path === "(root)") continue;

    if (!a.has(path) && b.has(path)) {
      out.push({ path, label: friendlyLabel(path), kind: "ADDED", before: undefined, after: av, score: scorePath(path) });
      continue;
    }

    if (a.has(path) && !b.has(path)) {
      out.push({ path, label: friendlyLabel(path), kind: "REMOVED", before: bv, after: undefined, score: scorePath(path) });
      continue;
    }

    if (!deepEqual(bv, av)) {
      out.push({ path, label: friendlyLabel(path), kind: "CHANGED", before: bv, after: av, score: scorePath(path) });
    }
  }

  out.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    return x.path.localeCompare(y.path);
  });

  return out;
}

function kindLabel(k: DiffKind) {
  if (k === "ADDED") return "THÊM";
  if (k === "REMOVED") return "XÓA";
  return "ĐỔI";
}

function kindChip(k: DiffKind) {
  if (k === "ADDED") return chipColor("green");
  if (k === "REMOVED") return chipColor("red");
  return chipColor("blue");
}

/** ========================= Diễn giải nghiệp vụ ========================= **/

function pickNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(n: any) {
  const x = pickNumber(n);
  if (x == null) return "—";
  return x.toLocaleString("vi-VN");
}

function buildBusinessNarrative(detail: any, diffs: DiffRow[]) {
  const action = String(detail?.action || "");
  const entity = String(detail?.entity || "");
  const meta = detail?.meta;

  const lines: string[] = [];

  // 1) Diễn giải theo action quen thuộc
  const A = action.toUpperCase();

  if (A === "PAYMENT_APPLY_ALLOCATIONS") {
    lines.push("Hệ thống đã phân bổ số tiền từ phiếu thu/chi vào các hóa đơn liên quan.");
    const sum = meta?.allocationSummary;
    if (sum) {
      // theo screenshot: holdAbs, normalAbs, holdSigned, normalSigned...
      if (sum.normalAbs != null) lines.push(`• Thanh toán thường (NORMAL): ${money(sum.normalAbs)}`);
      if (sum.holdAbs != null) lines.push(`• Giữ bảo hành treo (WARRANTY HOLD): ${money(sum.holdAbs)}`);
    }
    const pay = meta?.payment;
    if (pay?.amount != null) lines.push(`• Tổng số tiền phiếu: ${money(pay.amount)}`);
  }

  if (A === "INVOICE_APPROVE") {
    lines.push("Hóa đơn đã được DUYỆT (ghi nhận chính thức trong hệ thống).");
  }

  if (A === "INVOICE_SUBMIT") {
    lines.push("Hóa đơn đã được GỬI DUYỆT (chờ kế toán/duyệt).");
  }

  if (A === "INVOICE_CREATE") {
    lines.push("Tạo mới hóa đơn.");
  }

  if (A === "INVOICE_ORIGIN_APPLY_RETURN") {
    lines.push("Hóa đơn gốc đã được cập nhật để ghi nhận việc TRẢ HÀNG (liên kết với phiếu trả).");
  }

  if (A === "WARRANTY_HOLD_UPDATE_FROM_PAYMENT") {
    lines.push("Thông tin bảo hành treo đã được cập nhật theo phiếu thu/chi.");
  }

  // 2) Nếu chưa có diễn giải theo action -> fallback theo “điểm thay đổi chính”
  if (lines.length === 0) {
    lines.push("Tóm tắt thay đổi chính dựa trên dữ liệu Before/After:");
  }

  // 3) add 3-6 thay đổi quan trọng nhất
  const top = diffs.filter((d) => d.score >= 4).slice(0, 6);
  if (top.length > 0) {
    for (const d of top) {
      const before = formatValueForHuman(d.before);
      const after = formatValueForHuman(d.after);
      const verb = d.kind === "ADDED" ? "Thêm" : d.kind === "REMOVED" ? "Xóa" : "Đổi";
      lines.push(`• ${verb} ${d.label}: ${before} → ${after}`);
    }
  }

  // 4) extra: entity name for user
  if (entity) {
    // avoid duplicating too much
  }

  return lines;
}

/** ========================= Page ========================= **/

const AuditLogsPage: React.FC = () => {
  const [toast, setToast] = useState<ToastState>(null);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);

  // filters
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [userKey, setUserKey] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // detail modal
  const [open, setOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  // detail ui states
  const [showRaw, setShowRaw] = useState(false);
  const [diffQuery, setDiffQuery] = useState("");

  const totalPages = useMemo(() => {
    const pages = Math.ceil((total || 0) / (pageSize || 1));
    return pages < 1 ? 1 : pages;
  }, [total, pageSize]);

  function showToast(t: ToastState) {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 2500);
  }

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const resp = await listAuditLogs({
        q: q.trim() || undefined,
        entity: entity.trim() || undefined,
        action: action.trim() || undefined,
        userId: userKey.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        page: clampPage(nextPage),
        pageSize: Math.max(1, Number(nextPageSize) || PAGE_SIZE_DEFAULT),
      });

      const norm = normalizeListResp(resp as any);
      setTotal(norm.total);
      setRows(norm.rows);
      setPage(clampPage(norm.page));
      setPageSize(Math.max(1, Number(norm.pageSize) || PAGE_SIZE_DEFAULT));
    } catch (e: any) {
      showToast({ type: "error", message: e?.message || "Không tải được lịch sử thao tác." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1, PAGE_SIZE_DEFAULT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = async () => load(1, pageSize);

  const resetFilter = async () => {
    setQ("");
    setEntity("");
    setAction("");
    setUserKey("");
    setFrom("");
    setTo("");
    await load(1, pageSize);
  };

  const openDetail = async (id: string) => {
    setOpen(true);
    setDetail(null);
    setDetailLoading(true);
    setShowRaw(false);
    setDiffQuery("");

    try {
      const resp = await getAuditLogById(id);
      const row = normalizeDetailResp(resp as any);
      setDetail(row);
    } catch (e: any) {
      showToast({ type: "error", message: e?.message || "Không tải được chi tiết thao tác." });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setOpen(false);
    setDetail(null);
  };

  const renderUserLabel = (r: any) => {
    const u = r?.user;
    const username = u?.username || r?.username || r?.userName;
    const uid = r?.userId;
    return username || uid || "(không rõ)";
  };

  const renderRoleLabel = (r: any) => {
    const u = r?.user;
    const role = u?.role || r?.userRole || r?.role;
    return role || "";
  };

  const createdAt = (detail as any)?.createdAt || (detail as any)?.at || "";

  const diffRowsAll = useMemo(() => {
    if (!detail) return [];
    return buildDiff((detail as any)?.before, (detail as any)?.after);
  }, [detail]);

  const highlights = useMemo(() => diffRowsAll.filter((x) => x.score >= 4).slice(0, 8), [diffRowsAll]);

  const diffRowsFiltered = useMemo(() => {
    const qx = diffQuery.trim().toLowerCase();
    if (!qx) return diffRowsAll;
    return diffRowsAll.filter((r) => {
      return (
        r.path.toLowerCase().includes(qx) ||
        r.label.toLowerCase().includes(qx) ||
        String(r.before ?? "").toLowerCase().includes(qx) ||
        String(r.after ?? "").toLowerCase().includes(qx)
      );
    });
  }, [diffRowsAll, diffQuery]);

  const businessNarrative = useMemo(() => {
    if (!detail) return [];
    return buildBusinessNarrative(detail, diffRowsAll);
  }, [detail, diffRowsAll]);

  const headerTitle = useMemo(() => {
    if (!detail) return "";
    const user = renderUserLabel(detail);
    const act = actionVi(detail.action);
    const ent = entityVi(detail.entity);
    return `${user} • ${act} • ${ent}`;
  }, [detail]);

  const metaShort = useMemo(() => {
    const meta = (detail as any)?.meta;
    if (!meta || typeof meta !== "object") return null;
    const ip = meta?.ip;
    const method = meta?.method;
    const path = meta?.path;
    const ua = meta?.userAgent;
    return { ip, method, path, ua };
  }, [detail]);

  return (
    <div className="space-y-4">
      {/* TOAST */}
      {toast && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            toast.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-bold text-slate-900">Lịch sử thao tác</div>
          <div className="text-sm text-slate-600">
            Tra cứu thao tác theo người thực hiện và đối tượng. Bấm <b>Xem</b> để thấy <b>diễn giải</b> + <b>trường nào đổi</b>.
          </div>
        </div>

        <div className="flex gap-2">
          <button className={btnPrimary} onClick={() => load(page, pageSize)} disabled={loading}>
            Tải lại
          </button>
          <button className={btnGhost} onClick={resetFilter} disabled={loading}>
            Xóa bộ lọc
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className={cardCls}>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <div className={labelCls}>Tìm nhanh</div>
              <input className={inputCls} placeholder="Ví dụ: duyệt / hóa đơn / mã..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <div>
              <div className={labelCls}>Đối tượng</div>
              <input className={inputCls} placeholder="Ví dụ: Invoice, Payment..." value={entity} onChange={(e) => setEntity(e.target.value)} />
              <div className="mt-1 text-[11px] text-slate-500">Gợi ý: Invoice=Hóa đơn, Payment=Phiếu thu/chi…</div>
            </div>

            <div>
              <div className={labelCls}>Hành động</div>
              <input className={inputCls} placeholder="Ví dụ: INVOICE_APPROVE..." value={action} onChange={(e) => setAction(e.target.value)} />
              <div className="mt-1 text-[11px] text-slate-500">Có thể gõ mã hoặc từ khóa (approve/submit/create…)</div>
            </div>

            <div>
              <div className={labelCls}>Người thao tác (id/username)</div>
              <input className={inputCls} placeholder="Nhập userId hoặc username" value={userKey} onChange={(e) => setUserKey(e.target.value)} />
            </div>

            <div>
              <div className={labelCls}>Từ ngày</div>
              <input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>

            <div>
              <div className={labelCls}>Đến ngày</div>
              <input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div className="flex items-end gap-2 md:col-span-2">
              <div className="ml-auto flex items-center gap-2">
                <div className="text-sm text-slate-600">Số dòng/trang</div>
                <select
                  className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={pageSize}
                  onChange={(e) => {
                    const v = Math.max(1, Number(e.target.value) || PAGE_SIZE_DEFAULT);
                    setPageSize(v);
                    load(1, v);
                  }}
                  disabled={loading}
                >
                  {[10, 20, 30, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>

                <button className={btnPrimary} onClick={applyFilter} disabled={loading}>
                  Lọc
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <div>
              Tổng: <span className="font-semibold text-slate-900">{total}</span> • Trang{" "}
              <span className="font-semibold text-slate-900">
                {page}/{totalPages}
              </span>
            </div>

            <div className="flex gap-2">
              <button className={btnGhost} disabled={loading || page <= 1} onClick={() => load(page - 1, pageSize)}>
                Trước
              </button>
              <button className={btnGhost} disabled={loading || page >= totalPages} onClick={() => load(page + 1, pageSize)}>
                Sau
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className={cardCls}>
        <div className="overflow-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-700">
                <th className="text-left font-semibold px-4 py-3 border-b border-slate-200">Thời gian</th>
                <th className="text-left font-semibold px-4 py-3 border-b border-slate-200">Người thao tác</th>
                <th className="text-left font-semibold px-4 py-3 border-b border-slate-200">Vai trò</th>
                <th className="text-left font-semibold px-4 py-3 border-b border-slate-200">Hành động</th>
                <th className="text-left font-semibold px-4 py-3 border-b border-slate-200">Đối tượng</th>
                <th className="text-left font-semibold px-4 py-3 border-b border-slate-200">Mã đối tượng</th>
                <th className="text-right font-semibold px-4 py-3 border-b border-slate-200">Thao tác</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-slate-600">
                    Đang tải...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-slate-600">
                    Không có dữ liệu.
                  </td>
                </tr>
              ) : (
                rows.map((r: any) => {
                  const actionKind = actionChipKind(r.action);
                  const userLabel = renderUserLabel(r);
                  const roleLabel = renderRoleLabel(r);
                  const timeIso = String(r.createdAt || r.at || "");

                  const actVi = actionVi(r.action);
                  const entVi = entityVi(r.entity);

                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{toTimeOnly(timeIso)}</div>
                        <div className="text-xs text-slate-500">{toDateOnly(timeIso)}</div>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        <span className={chipColor("neutral")}>{userLabel}</span>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        {roleLabel ? <span className={chipColor("blue")}>{roleVi(roleLabel)}</span> : <span className="text-slate-400">—</span>}
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        <div className="flex flex-col gap-1">
                          <span className={chipColor(actionKind as any)} title={String(r.action || "")}>
                            {actVi}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">{String(r.action || "")}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        <div className="flex flex-col gap-1">
                          <span className={chipColor("amber")} title={String(r.entity || "")}>
                            {entVi}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">{String(r.entity || "")}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        <span className="font-mono text-xs text-slate-700">{r.entityId || "—"}</span>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100 text-right">
                        <button className={btnGhost} onClick={() => openDetail(r.id)}>
                          Xem
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 flex items-center justify-between text-sm text-slate-600">
          <div>
            Trang <span className="font-semibold text-slate-900">{page}</span> /{" "}
            <span className="font-semibold text-slate-900">{totalPages}</span>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} disabled={loading || page <= 1} onClick={() => load(page - 1, pageSize)}>
              Trước
            </button>
            <button className={btnGhost} disabled={loading || page >= totalPages} onClick={() => load(page + 1, pageSize)}>
              Sau
            </button>
          </div>
        </div>
      </div>

      {/* DETAIL MODAL */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeDetail} />

          <div className="relative w-full max-w-6xl max-h-[88vh] overflow-hidden rounded-2xl bg-white shadow-xl border border-slate-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <div className="text-sm text-slate-600">Chi tiết thao tác</div>
                <div className="font-semibold text-slate-900 truncate">{headerTitle || "—"}</div>
                <div className="text-xs text-slate-500">
                  {toTimeOnly(createdAt)} • {toDateOnly(createdAt)}{" "}
                  <span className="ml-2 font-mono">({detail?.id || "—"})</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button className={btnGhost} onClick={() => setShowRaw((v) => !v)} disabled={detailLoading || !detail}>
                  {showRaw ? "Ẩn dữ liệu kỹ thuật" : "Xem dữ liệu kỹ thuật"}
                </button>
                <button className={btnGhost} onClick={closeDetail}>
                  Đóng
                </button>
              </div>
            </div>

            <div className="p-5 overflow-auto max-h-[calc(88vh-72px)]">
              {detailLoading ? (
                <div className="text-slate-600">Đang tải chi tiết...</div>
              ) : !detail ? (
                <div className="text-slate-600">Không có dữ liệu chi tiết.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {/* LEFT */}
                  <div className="space-y-4 lg:col-span-1">
                    <div className={cardCls + " p-4"}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={chipColor("neutral")}>{renderUserLabel(detail)}</span>
                        {renderRoleLabel(detail) ? <span className={chipColor("blue")}>{roleVi(renderRoleLabel(detail))}</span> : null}
                        <span className={chipColor(actionChipKind(detail.action) as any)} title={String(detail.action || "")}>
                          {actionVi(detail.action)}
                        </span>
                        <span className={chipColor("amber")} title={String(detail.entity || "")}>
                          {entityVi(detail.entity)}
                        </span>
                      </div>

                      <div className="mt-3 text-sm text-slate-700 space-y-1">
                        <div className="flex gap-2">
                          <div className="w-28 text-slate-500">Đối tượng:</div>
                          <div className="font-semibold text-slate-900">
                            {entityVi(detail.entity)}{" "}
                            <span className="text-xs text-slate-500 font-mono ml-2">({String(detail.entity || "")})</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <div className="w-28 text-slate-500">Mã đối tượng:</div>
                          <div className="font-mono text-xs text-slate-800 break-all">{detail.entityId || "—"}</div>
                        </div>

                        <div className="flex gap-2">
                          <div className="w-28 text-slate-500">Hành động:</div>
                          <div className="font-semibold text-slate-900">
                            {actionVi(detail.action)}{" "}
                            <span className="text-xs text-slate-500 font-mono ml-2">({String(detail.action || "")})</span>
                          </div>
                        </div>

                        {metaShort ? (
                          <div className="pt-2 mt-2 border-t border-slate-200">
                            <div className="text-xs font-semibold text-slate-600 mb-1">Thông tin kỹ thuật (rút gọn)</div>
                            <div className="text-xs text-slate-600 space-y-1">
                              {metaShort.method || metaShort.path ? (
                                <div>
                                  <span className="text-slate-500">API:</span>{" "}
                                  <span className="font-mono">{String(metaShort.method || "").toUpperCase()}</span>{" "}
                                  <span className="font-mono">{metaShort.path || ""}</span>
                                </div>
                              ) : null}
                              {metaShort.ip ? (
                                <div>
                                  <span className="text-slate-500">IP:</span> <span className="font-mono">{metaShort.ip}</span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className={cardCls + " p-4"}>
                      <div className="text-sm font-semibold text-slate-900 mb-2">Diễn giải (dễ hiểu)</div>
                      <div className="text-sm text-slate-700 space-y-1">
                        {businessNarrative.length === 0 ? (
                          <div className="text-slate-500">Không có dữ liệu diễn giải.</div>
                        ) : (
                          businessNarrative.map((x, i) => (
                            <div key={i} className={x.startsWith("•") ? "" : "font-semibold text-slate-900"}>
                              {x}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className={cardCls + " p-4"}>
                      <div className="text-sm font-semibold text-slate-900 mb-2">Điểm thay đổi chính</div>
                      {highlights.length === 0 ? (
                        <div className="text-sm text-slate-500">Không phát hiện thay đổi rõ ràng (hoặc before/after trống).</div>
                      ) : (
                        <div className="space-y-2">
                          {highlights.map((h) => (
                            <div key={h.path} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-semibold text-slate-900">{h.label}</div>
                                <span className={kindChip(h.kind)}>{kindLabel(h.kind)}</span>
                              </div>
                              <div className="mt-1 text-xs text-slate-600">
                                <div className="flex gap-2">
                                  <div className="w-14 text-slate-500">Trước:</div>
                                  <div className="font-medium text-slate-800 break-all">{formatValueForHuman(h.before)}</div>
                                </div>
                                <div className="flex gap-2 mt-1">
                                  <div className="w-14 text-slate-500">Sau:</div>
                                  <div className="font-medium text-slate-800 break-all">{formatValueForHuman(h.after)}</div>
                                </div>
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500 font-mono break-all">{h.path}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {showRaw ? (
                      <div className={cardCls + " p-4"}>
                        <div className="text-sm font-semibold text-slate-900 mb-2">Dữ liệu kỹ thuật (dành cho dev)</div>
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs font-semibold text-slate-600 mb-1">Meta</div>
                            <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto">
                              {safeJsonStringify(detail.meta)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-600 mb-1">Trước (Before)</div>
                            <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto">
                              {safeJsonStringify(detail.before)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-600 mb-1">Sau (After)</div>
                            <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto">
                              {safeJsonStringify(detail.after)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* RIGHT */}
                  <div className="space-y-4 lg:col-span-2">
                    <div className={cardCls + " p-4"}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Bảng thay đổi chi tiết</div>
                          <div className="text-xs text-slate-600">
                            Tổng số thay đổi: <b className="text-slate-900">{diffRowsAll.length}</b>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            className={inputCls}
                            style={{ width: 320 }}
                            placeholder="Tìm trong thay đổi (vd: paidAmount, status, tax, hold...)"
                            value={diffQuery}
                            onChange={(e) => setDiffQuery(e.target.value)}
                          />
                          <button className={btnGhost} onClick={() => setDiffQuery("")}>
                            Xóa tìm
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
                        <table className="min-w-[900px] w-full text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="text-left font-semibold px-3 py-2 border-b border-slate-200 w-[240px]">Trường</th>
                              <th className="text-left font-semibold px-3 py-2 border-b border-slate-200">Trước</th>
                              <th className="text-left font-semibold px-3 py-2 border-b border-slate-200">Sau</th>
                              <th className="text-center font-semibold px-3 py-2 border-b border-slate-200 w-[90px]">Loại</th>
                            </tr>
                          </thead>

                          <tbody>
                            {diffRowsFiltered.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-4 text-slate-600">
                                  Không có thay đổi phù hợp bộ lọc.
                                </td>
                              </tr>
                            ) : (
                              diffRowsFiltered.map((d) => (
                                <tr key={d.path} className="hover:bg-slate-50">
                                  <td className="px-3 py-2 border-b border-slate-100">
                                    <div className="font-semibold text-slate-900">{d.label}</div>
                                    <div className="text-[11px] text-slate-500 font-mono break-all">{d.path}</div>
                                  </td>
                                  <td className="px-3 py-2 border-b border-slate-100">
                                    <div className="text-slate-800 break-all">{formatValueForHuman(d.before)}</div>
                                  </td>
                                  <td className="px-3 py-2 border-b border-slate-100">
                                    <div className="text-slate-800 break-all">{formatValueForHuman(d.after)}</div>
                                  </td>
                                  <td className="px-3 py-2 border-b border-slate-100 text-center">
                                    <span className={kindChip(d.kind)}>{kindLabel(d.kind)}</span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-3 text-xs text-slate-500">
                        Gợi ý: Nếu thấy “Danh sách (n mục)” nghĩa là thay đổi nằm trong list lớn (phân bổ/lines…).
                        Khi cần soi sâu hơn, bật <b>Dữ liệu kỹ thuật</b>.
                      </div>
                    </div>

                    {!detail.before && !detail.after ? (
                      <div className={cardCls + " p-4"}>
                        <div className="text-sm font-semibold text-slate-900">Lưu ý</div>
                        <div className="text-sm text-slate-600 mt-1">
                          Audit này không có dữ liệu <b>Before/After</b> nên không dựng được bảng thay đổi.
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogsPage;
