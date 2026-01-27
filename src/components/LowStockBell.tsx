import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";

type Kind = "MACHINE" | "PART" | string;

type Row = {
  sku: string;
  name?: string | null;
  kind?: Kind;
  qty: number;

  // ✅ PART: sold 30d
  sold30d?: number;

  // ✅ MACHINE: sold 60d (đã fix BE theo 60 ngày)
  sold60d?: number;

  // (optional) nếu BE còn trả legacy thì giữ cũng được, nhưng UI sẽ ưu tiên sold60d
  sold90d?: number;
};

function getErrMsg(e: any) {
  if (e?.response?.status) return `HTTP ${e.response.status}`;
  if (typeof e?.message === "string") return e.message;
  return "API error";
}

function kindLabel(kind?: Kind) {
  if (kind === "MACHINE") return "Máy";
  if (kind === "PART") return "Linh kiện";
  return "Khác";
}

function qtyTone(qty: number) {
  if (qty <= 2) return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function fmtInt(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return String(Math.round(v));
}

export function LowStockBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number>(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string>("");
  const [tab, setTab] = useState<"MACHINE" | "PART">("MACHINE");
  const [loading, setLoading] = useState(false);

  // ✅ accordion open sku
  const [openSku, setOpenSku] = useState<string | null>(null);

  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setErr("");
      const r = await api.get("/assistant/alerts/low-stock");
      const list: Row[] = r.data?.rows ?? [];
      setRows(list);
      setCount(r.data?.count ?? list.length ?? 0);
    } catch (e: any) {
      setErr(getErrMsg(e));
      setRows([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Click outside: chỉ đóng khi click KHÔNG nằm trong button & KHÔNG nằm trong panel
  useEffect(() => {
    if (!open) return;

    const onPointerDownCapture = (ev: MouseEvent) => {
      const target = ev.target as Node;

      const inBtn = !!btnRef.current && btnRef.current.contains(target);
      const inPanel = !!panelRef.current && panelRef.current.contains(target);

      if (!inBtn && !inPanel) setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDownCapture, true);
    return () =>
      document.removeEventListener("mousedown", onPointerDownCapture, true);
  }, [open]);

  const { machineRows, partRows } = useMemo(() => {
    const machineRows = rows.filter((r) => r.kind === "MACHINE");
    const partRows = rows.filter((r) => r.kind === "PART");
    return { machineRows, partRows };
  }, [rows]);

  const activeRows = tab === "MACHINE" ? machineRows : partRows;

  // ✅ group theo SKU để không spam lặp
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of activeRows) {
      const key = String(r.sku || "").trim();
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), r]);
    }

    const arr = Array.from(map.entries()).map(([sku, list]) => {
      const qtys = list.map((x) => Number(x.qty) || 0);
      const minQty = qtys.length ? Math.min(...qtys) : 0;

      // ✅ tổng đã bán theo tab (để khách quan)
      const soldTotal =
        tab === "PART"
          ? list.reduce((sum, x) => sum + (Number(x.sold30d) || 0), 0)
          : list.reduce((sum, x) => sum + (Number(x.sold60d) || 0), 0);

      // sort chi tiết trong accordion: tồn tăng dần rồi tên
      const sortedList = [...list].sort((a, b) => {
        const qa = Number(a.qty) || 0;
        const qb = Number(b.qty) || 0;
        if (qa !== qb) return qa - qb;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

      return { sku, list: sortedList, minQty, soldTotal };
    });

    // sort nhóm: tồn tăng dần rồi sku
    arr.sort((a, b) => a.minQty - b.minQty || a.sku.localeCompare(b.sku));
    return arr;
  }, [activeRows, tab]);

  const panel = useMemo(() => {
    if (!open) return null;

    const body = (
      <div
        ref={panelRef}
        className="fixed right-4 top-14 w-[420px] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-[99999]"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-semibold text-slate-900">Sắp hết hàng</div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {count} cảnh báo
              </span>
              {loading && (
                <span className="text-xs text-slate-400">đang tải…</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {tab === "PART" ? "Bán 30 ngày • tồn thấp" : "Bán 60 ngày • tồn thấp"}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => fetchData()}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"
              disabled={loading}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-9 h-9 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center"
              title="Đóng"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTab("MACHINE");
                setOpenSku(null);
              }}
              className={`px-3 py-2 rounded-xl text-sm border transition ${
                tab === "MACHINE"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Máy <span className="opacity-80">({machineRows.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab("PART");
                setOpenSku(null);
              }}
              className={`px-3 py-2 rounded-xl text-sm border transition ${
                tab === "PART"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Linh kiện <span className="opacity-80">({partRows.length})</span>
            </button>
          </div>
        </div>

        {/* Content */}
        {err ? (
          <div className="p-4">
            <div className="text-sm text-red-600 font-medium">
              Không tải được cảnh báo
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Lỗi: {err}. Kiểm tra endpoint{" "}
              <b>/assistant/alerts/low-stock</b>.
            </div>
          </div>
        ) : grouped.length === 0 ? (
          <div className="p-4 text-sm text-slate-600">
            {tab === "MACHINE"
              ? "Không có cảnh báo máy."
              : "Không có cảnh báo linh kiện."}
          </div>
        ) : (
          <div className="max-h-[460px] overflow-auto px-4 pt-3 pb-4">
            <div className="space-y-2">
              {grouped.map((g) => {
                const isOpen = openSku === g.sku;
                const firstName = g.list[0]?.name || "(Chưa có tên)";
                const extra = g.list.length > 1 ? g.list.length - 1 : 0;

                return (
                  <div
                    key={g.sku}
                    className="rounded-2xl border border-slate-200 bg-white overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenSku(isOpen ? null : g.sku)}
                      className="w-full p-3 hover:bg-slate-50 transition flex items-start justify-between gap-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-slate-900">
                            {g.sku}
                          </div>
                          <span className="text-xs text-slate-500">
                            {tab === "MACHINE" ? "Máy" : "Linh kiện"} •{" "}
                            {g.list.length} mục
                          </span>
                        </div>

                        <div className="text-sm text-slate-700 mt-1 break-words">
                          {firstName}
                          {extra > 0 ? (
                            <span className="text-slate-500">
                              {" "}
                              (+{extra} tên khác)
                            </span>
                          ) : null}
                        </div>

                        {/* ✅ ĐÃ BÁN */}
                        <div className="text-xs text-slate-500 mt-1">
                          {tab === "PART" ? (
                            <>
                              Đã bán trong 30 ngày: <b>{fmtInt(g.soldTotal)}</b>
                            </>
                          ) : (
                            <>
                              Đã bán trong 60 ngày: <b>{fmtInt(g.soldTotal)}</b>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div className="text-xs text-slate-500">Tồn</div>
                        <div
                          className={`mt-1 inline-flex items-center justify-center min-w-[46px] px-2 py-1 rounded-xl border text-sm font-semibold ${qtyTone(
                            Number(g.minQty)
                          )}`}
                        >
                          {g.minQty}
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-200 bg-white">
                        <div className="p-3">
                          <div className="text-xs text-slate-500 mb-2">
                            Chi tiết ({g.list.length})
                          </div>

                          <div className="space-y-2">
                            {g.list.map((r, idx) => {
                              const sold =
                                tab === "PART"
                                  ? Number(r.sold30d) || 0
                                  : Number(r.sold60d) || 0;

                              return (
                                <div
                                  key={idx}
                                  className="flex items-start justify-between gap-3"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm text-slate-700 break-words">
                                      {r.name ? r.name : "(Chưa có tên)"}{" "}
                                      <span className="text-xs text-slate-500">
                                        • {kindLabel(r.kind)}
                                      </span>
                                    </div>
                                    <div className="text-xs text-slate-500 mt-0.5">
                                      {tab === "PART"
                                        ? `Đã bán 30 ngày: ${fmtInt(sold)}`
                                        : `Đã bán 60 ngày: ${fmtInt(sold)}`}
                                    </div>
                                  </div>

                                  <div className="text-sm font-semibold text-slate-900 shrink-0">
                                    {r.qty}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );

    return createPortal(body, document.body);
  }, [
    open,
    count,
    loading,
    err,
    tab,
    grouped,
    machineRows.length,
    partRows.length,
    openSku,
  ]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={async (e) => {
          e.stopPropagation();
          const next = !open;
          setOpen(next);
          setOpenSku(null);
          if (next) await fetchData();
        }}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 border border-slate-200"
        title="Cảnh báo sắp hết hàng"
      >
        🔔
        <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[11px] px-1.5 rounded-full leading-4">
          {count}
        </span>
      </button>

      {panel}
    </>
  );
}
