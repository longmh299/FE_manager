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

  const total = Number(root?.total ?? 0) || 0;
  const page = Number(root?.page ?? 1) || 1;
  const pageSize = Number(root?.pageSize ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT;

  const rows = (root?.rows ?? root?.data ?? []) as AuditLogRow[];
  return {
    total,
    page,
    pageSize,
    rows: Array.isArray(rows) ? rows : [],
  };
}

function normalizeDetailResp(resp: any): AuditLogRow | null {
  // BE có thể trả:
  // 1) AuditLogRow
  // 2) { ok:true, data: AuditLogRow }
  const row = resp?.data && typeof resp.data === "object" ? resp.data : resp;
  if (!row || typeof row !== "object") return null;
  return row as AuditLogRow;
}

const chipBase =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

function chipColor(kind: "neutral" | "green" | "blue" | "red") {
  if (kind === "green") return `${chipBase} bg-green-50 border-green-200 text-green-700`;
  if (kind === "blue") return `${chipBase} bg-blue-50 border-blue-200 text-blue-700`;
  if (kind === "red") return `${chipBase} bg-red-50 border-red-200 text-red-700`;
  return `${chipBase} bg-slate-50 border-slate-200 text-slate-700`;
}

function actionChipKind(action: string) {
  const a = String(action || "").toUpperCase();
  if (a.includes("DELETE") || a.includes("REMOVE") || a.includes("REJECT")) return "red";
  if (a.includes("CREATE") || a.includes("POST") || a.includes("APPROVE")) return "green";
  if (a.includes("UPDATE") || a.includes("PATCH") || a.includes("APPLY")) return "blue";
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
  const [userKey, setUserKey] = useState(""); // userId hoặc username
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // detail modal
  const [open, setOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  const totalPages = useMemo(() => {
    const pages = Math.ceil((total || 0) / (pageSize || 1));
    return pages < 1 ? 1 : pages;
  }, [total, pageSize]);

  function showToast(t: ToastState) {
    setToast(t);
    if (t) {
      setTimeout(() => setToast(null), 2500);
    }
  }

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const resp = await listAuditLogs({
        q: q.trim() || undefined,
        entity: entity.trim() || undefined,
        action: action.trim() || undefined,
        // backend có thể filter theo userId; bạn đang muốn gõ username -> BE có thể tự xử
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
    // load lần đầu
    load(1, PAGE_SIZE_DEFAULT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilter = async () => {
    await load(1, pageSize);
  };

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
    try {
      const resp = await getAuditLogById(id);
      const row = normalizeDetailResp(resp as any);
      setDetail(row);
    } catch (e: any) {
      showToast({ type: "error", message: e?.message || "Không tải được chi tiết audit." });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setOpen(false);
    setDetail(null);
  };

  // render helpers
  const renderUserLabel = (r: AuditLogRow) => {
    // ưu tiên user.username; fallback userId nếu BE trả
    const u = (r as any)?.user;
    const username = u?.username;
    const uid = (r as any)?.userId;
    return username || uid || "(không rõ)";
  };

  const renderRoleLabel = (r: AuditLogRow) => {
    const u = (r as any)?.user;
    const role = u?.role || (r as any)?.userRole;
    return role || "";
  };

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
            Tra cứu các hành động (duyệt/ghi sổ/cập nhật/xóa...) theo đối tượng và người thao tác.
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
              <input
                className={inputCls}
                placeholder="action/entity/entityId..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div>
              <div className={labelCls}>Đối tượng (Entity)</div>
              <input
                className={inputCls}
                placeholder="Ví dụ: Invoice, Payment..."
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
              />
            </div>

            <div>
              <div className={labelCls}>Hành động (Action)</div>
              <input
                className={inputCls}
                placeholder="Ví dụ: INVOICE_APPROVE..."
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            </div>

            <div>
              <div className={labelCls}>Người thao tác (id/username)</div>
              <input
                className={inputCls}
                placeholder="Nhập userId hoặc username"
                value={userKey}
                onChange={(e) => setUserKey(e.target.value)}
              />
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
              <button
                className={btnGhost}
                disabled={loading || page <= 1}
                onClick={() => load(page - 1, pageSize)}
              >
                Trước
              </button>
              <button
                className={btnGhost}
                disabled={loading || page >= totalPages}
                onClick={() => load(page + 1, pageSize)}
              >
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
                rows.map((r) => {
                  const actionKind = actionChipKind(r.action);
                  const userLabel = renderUserLabel(r);
                  const roleLabel = renderRoleLabel(r);

                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 border-b border-slate-100 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{toTimeOnly(r.createdAt)}</div>
                        <div className="text-xs text-slate-500">{toDateOnly(r.createdAt)}</div>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        <span className={chipColor("neutral")}>{userLabel}</span>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        {roleLabel ? <span className={chipColor("blue")}>{roleLabel}</span> : <span className="text-slate-400">—</span>}
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">
                        <span className={chipColor(actionKind as any)}>{r.action}</span>
                      </td>

                      <td className="px-4 py-3 border-b border-slate-100">{r.entity}</td>

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
            <button
              className={btnGhost}
              disabled={loading || page <= 1}
              onClick={() => load(page - 1, pageSize)}
            >
              Trước
            </button>
            <button
              className={btnGhost}
              disabled={loading || page >= totalPages}
              onClick={() => load(page + 1, pageSize)}
            >
              Sau
            </button>
          </div>
        </div>
      </div>

      {/* DETAIL MODAL */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={closeDetail} />

          <div className="relative w-full max-w-5xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-xl border border-slate-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <div className="text-sm text-slate-600">Chi tiết audit</div>
                <div className="font-mono text-sm font-semibold text-slate-900">
                  {detail?.id || "—"}
                </div>
              </div>
              <button className={btnGhost} onClick={closeDetail}>
                Đóng
              </button>
            </div>

            <div className="p-5 overflow-auto max-h-[calc(85vh-72px)]">
              {detailLoading ? (
                <div className="text-slate-600">Đang tải chi tiết...</div>
              ) : !detail ? (
                <div className="text-slate-600">Không có dữ liệu chi tiết.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className={cardCls + " p-4"}>
                      <div className="flex items-center gap-2">
                        <span className={chipColor("neutral")}>{renderUserLabel(detail)}</span>
                        {renderRoleLabel(detail) ? (
                          <span className={chipColor("blue")}>{renderRoleLabel(detail)}</span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </div>

                      <div className="mt-3 text-sm text-slate-700">
                        <div className="flex gap-2">
                          <div className="w-28 text-slate-500">Thời gian:</div>
                          <div className="font-semibold text-slate-900">
                            {toTimeOnly(detail.createdAt)} • {toDateOnly(detail.createdAt)}
                          </div>
                        </div>

                        <div className="flex gap-2 mt-1">
                          <div className="w-28 text-slate-500">Hành động:</div>
                          <div>
                            <span className={chipColor(actionChipKind(detail.action) as any)}>{detail.action}</span>
                          </div>
                        </div>

                        <div className="flex gap-2 mt-1">
                          <div className="w-28 text-slate-500">Đối tượng:</div>
                          <div className="font-semibold text-slate-900">{detail.entity}</div>
                        </div>

                        <div className="flex gap-2 mt-1">
                          <div className="w-28 text-slate-500">Mã đối tượng:</div>
                          <div className="font-mono text-xs text-slate-800">{detail.entityId || "—"}</div>
                        </div>
                      </div>
                    </div>

                    <div className={cardCls + " p-4"}>
                      <div className="text-sm font-semibold text-slate-900 mb-2">Thông tin kỹ thuật (Meta)</div>
                      {detail.meta == null ? (
                        <div className="text-sm text-slate-500">Không có meta.</div>
                      ) : (
                        <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto">
                          {safeJsonStringify(detail.meta)}
                        </pre>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className={cardCls + " p-4"}>
                      <div className="text-sm font-semibold text-slate-900 mb-2">Trước khi thay đổi (Before)</div>
                      {detail.before == null ? (
                        <div className="text-sm text-slate-500">Không có dữ liệu before.</div>
                      ) : (
                        <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto">
                          {safeJsonStringify(detail.before)}
                        </pre>
                      )}
                    </div>

                    <div className={cardCls + " p-4"}>
                      <div className="text-sm font-semibold text-slate-900 mb-2">Sau khi thay đổi (After)</div>
                      {detail.after == null ? (
                        <div className="text-sm text-slate-500">Không có dữ liệu after.</div>
                      ) : (
                        <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-auto">
                          {safeJsonStringify(detail.after)}
                        </pre>
                      )}
                    </div>
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
