// src/pages/BestSellersReportPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import api, { extractList } from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

/* ======================= Types ======================= */

type ItemKind = "PART" | "MACHINE";
type FilterMode = "month" | "range";

type InvoiceLine = {
  itemId: string;
  qty: number | string;
  item?: {
    id: string;
    sku?: string;
    name?: string;
    kind?: ItemKind | string;
  } | null;
};

type InvoiceRow = {
  id: string;
  code: string;
  issueDate: string;
  lines?: InvoiceLine[];
};

type RankedItem = {
  itemId: string;
  sku: string;
  name: string;
  qty: number;
};

/* ======================= Helpers ======================= */

function num(x: any): number {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstDayOfMonthYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// tháng "YYYY-MM" -> { from, to } ISO (đầu tháng 00:00 -> cuối tháng 23:59:59.999)
function monthToIsoRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const to = new Date(y, m, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ngày "YYYY-MM-DD" -> { from, to } ISO (00:00 -> 23:59:59.999 của chính ngày đó)
function ymdToIsoRange(fromYmd: string, toYmd: string) {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const to = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function fmtInt(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function fmtYmdDisplay(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

/* ======================= Component ======================= */

const BestSellersReportPage: React.FC = () => {
  const { toasts, push, remove } = useToast();

  const [mode, setMode] = useState<FilterMode>("month");

  // ----- chọn theo tháng -----
  const [ym, setYm] = useState(currentYm());

  // ----- chọn theo khoảng ngày tùy ý -----
  const [fromYmd, setFromYmd] = useState(firstDayOfMonthYmd());
  const [toYmd, setToYmd] = useState(todayYmd());

  const [tab, setTab] = useState<ItemKind>("PART");

  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loadedLabel, setLoadedLabel] = useState<string | null>(null);

const dateRangeInvalid = !!(mode === "range" && fromYmd && toYmd && fromYmd > toYmd);
  async function fetchData() {
    if (dateRangeInvalid) {
      push({ type: "error", message: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc." });
      return;
    }

    setLoading(true);
    try {
      const { from, to } =
        mode === "month" ? monthToIsoRange(ym) : ymdToIsoRange(fromYmd, toYmd);

      const res = await api.get("/invoices", {
        params: {
          type: "SALES",
          status: "APPROVED",
          from,
          to,
          page: 1,
          pageSize: 5000,
        },
      });

      const list = extractList<InvoiceRow>(res.data);
      setInvoices(list);

      if (mode === "month") {
        const [y, m] = ym.split("-");
        setLoadedLabel(`Tháng ${parseInt(m, 10)}/${y}`);
      } else {
        setLoadedLabel(`${fmtYmdDisplay(fromYmd)} → ${fmtYmdDisplay(toYmd)}`);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "Không quét được dữ liệu hóa đơn.";
      push({ type: "error", message: msg });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Gộp qty theo item, tách theo kind =====
  const { partRanked, machineRanked, orderCount } = useMemo(() => {
    const partMap = new Map<string, RankedItem>();
    const machineMap = new Map<string, RankedItem>();

    for (const inv of invoices) {
      for (const line of inv.lines || []) {
        const item = line.item;
        if (!item) continue;

        const kind = String(item.kind || "").toUpperCase();
        const map = kind === "MACHINE" ? machineMap : partMap; // mặc định coi là PART nếu thiếu kind

        const key = item.sku || item.id || line.itemId;
        const existing = map.get(key);
        const qty = num(line.qty);

        if (existing) {
          existing.qty += qty;
        } else {
          map.set(key, {
            itemId: item.id || line.itemId,
            sku: item.sku || "",
            name: item.name || "(Không tên)",
            qty,
          });
        }
      }
    }

    const sortFn = (a: RankedItem, b: RankedItem) => b.qty - a.qty;

    return {
      partRanked: Array.from(partMap.values()).sort(sortFn),
      machineRanked: Array.from(machineMap.values()).sort(sortFn),
      orderCount: invoices.length,
    };
  }, [invoices]);

  const activeRanked = tab === "PART" ? partRanked : machineRanked;
  const activeTotalQty = activeRanked.reduce((s, r) => s + r.qty, 0);
  const maxQty = activeRanked[0]?.qty || 1;

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <ToastHost toasts={toasts} onClose={remove} />

      <div style={panelHeader}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Hàng bán chạy</div>
          <div style={{ fontSize: 12.5, opacity: 0.7, marginTop: 2 }}>
            Cộng dồn số lượng bán theo khoảng thời gian, tách riêng Máy và Linh kiện — chỉ tính hóa đơn BÁN đã duyệt.
          </div>
        </div>
      </div>

      {/* ===== Filter bar ===== */}
      <div style={panel}>
        {/* mode switch */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button type="button" onClick={() => setMode("month")} style={tabBtn(mode === "month")}>
            Theo tháng
          </button>
          <button type="button" onClick={() => setMode("range")} style={tabBtn(mode === "range")}>
            Khoảng ngày tùy chọn
          </button>
        </div>

        <div style={filtersRow}>
          {mode === "month" ? (
            <div>
              <label style={fieldLabel}>Chọn tháng</label>
              <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} style={monthInput} />
            </div>
          ) : (
            <>
              <div>
                <label style={fieldLabel}>Từ ngày</label>
                <input
                  type="date"
                  value={fromYmd}
                  max={toYmd || undefined}
                  onChange={(e) => setFromYmd(e.target.value)}
                  style={monthInput}
                />
              </div>
              <div>
                <label style={fieldLabel}>Đến ngày</label>
                <input
                  type="date"
                  value={toYmd}
                  min={fromYmd || undefined}
                  onChange={(e) => setToYmd(e.target.value)}
                  style={monthInput}
                />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={fetchData}
            disabled={loading || dateRangeInvalid}
            style={primaryBtn(loading || dateRangeInvalid)}
          >
            {loading ? "Đang quét..." : "↻ Quét dữ liệu"}
          </button>

          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button type="button" onClick={() => setTab("PART")} style={tabBtn(tab === "PART")}>
              Linh kiện
            </button>
            <button type="button" onClick={() => setTab("MACHINE")} style={tabBtn(tab === "MACHINE")}>
              Máy
            </button>
          </div>
        </div>

        {dateRangeInvalid && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: "#dc2626", fontWeight: 700 }}>
            Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.
          </div>
        )}

        {/* ===== KPI strip ===== */}
        <div style={strip}>
          <div style={stripItem}>
            <div style={stripLabel}>Khoảng đang xem</div>
            <div style={stripValue}>{loadedLabel || "Chưa quét"}</div>
          </div>
          <div style={stripItem}>
            <div style={stripLabel}>Số hóa đơn</div>
            <div style={stripValue}>{fmtInt(orderCount)}</div>
          </div>
          <div style={stripItem}>
            <div style={stripLabel}>Số mặt hàng ({tab === "PART" ? "Linh kiện" : "Máy"})</div>
            <div style={stripValue}>{fmtInt(activeRanked.length)}</div>
          </div>
          <div style={stripItem}>
            <div style={stripLabel}>Tổng số lượng bán</div>
            <div style={stripValue}>{fmtInt(activeTotalQty)}</div>
          </div>
        </div>

        {/* ===== Ranked table ===== */}
        <div style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={thLeft}>#</th>
                <th style={th}>SKU</th>
                <th style={th}>Tên hàng</th>
                <th style={thRight}>Số lượng bán</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} style={{ ...tdBase, textAlign: "center", padding: 24 }}>
                    Đang tải dữ liệu…
                  </td>
                </tr>
              )}

              {!loading && activeRanked.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...tdBase, textAlign: "center", padding: 24, opacity: 0.7 }}>
                    {loadedLabel
                      ? `Không có hàng ${tab === "PART" ? "linh kiện" : "máy"} nào được bán trong khoảng thời gian này.`
                      : 'Bấm "Quét dữ liệu" để xem thống kê.'}
                  </td>
                </tr>
              )}

              {!loading &&
                activeRanked.map((item, i) => (
                  <tr key={item.itemId || item.sku || i}>
                    <td style={tdLeft}>
                      <span style={i === 0 ? rankNumTop : rankNum}>#{i + 1}</span>
                    </td>
                    <td style={td}>{item.sku || "—"}</td>
                    <td style={td}>
                      {item.name}
                      {i === 0 && <span style={stampBadge}>BÁN CHẠY NHẤT</span>}
                      <div style={barWrap}>
                        <div
                          style={{
                            ...barFill,
                            width: `${(item.qty / maxQty) * 100}%`,
                            background: i === 0 ? "#dc2626" : "#0284c7",
                          }}
                        />
                      </div>
                    </td>
                    <td style={tdRightStrong}>{fmtInt(item.qty)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 10, lineHeight: 1.5 }}>
        Ghi chú: đang tính theo hóa đơn loại <b>BÁN (SALES)</b>, trạng thái <b>ĐÃ DUYỆT (APPROVED)</b>, chưa trừ hàng bán trả lại
        (SALES_RETURN). Nếu cần tính số lượng bán ròng (net), báo lại để chỉnh thêm.
      </div>
    </div>
  );
};

/* ======================= Styles (đồng bộ style hệ thống) ======================= */

const panelHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 12,
  flexWrap: "wrap",
};

const panel: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "#fff",
  padding: 14,
  boxShadow: "0 8px 16px rgba(0,0,0,0.04)",
};

const filtersRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 12,
  flexWrap: "wrap",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 800,
  marginBottom: 6,
  opacity: 0.75,
};

const monthInput: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontSize: 14,
  outline: "none",
  minWidth: 160,
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 16px",
    borderRadius: 10,
    border: "1px solid #0284c7",
    background: disabled ? "#bae6fd" : "#0284c7",
    color: "#fff",
    fontWeight: 900,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 10,
    border: active ? "1px solid #0284c7" : "1px solid #cbd5e0",
    background: active ? "rgba(2, 132, 199, 0.08)" : "#fff",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 13,
  };
}

const strip: React.CSSProperties = {
  marginTop: 14,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.20)",
  background: "rgba(2, 6, 23, 0.02)",
  display: "flex",
  gap: 20,
  alignItems: "center",
  flexWrap: "wrap",
};

const stripItem: React.CSSProperties = { minWidth: 130 };
const stripLabel: React.CSSProperties = { fontSize: 11, opacity: 0.7, fontWeight: 800 };
const stripValue: React.CSSProperties = { marginTop: 4, fontSize: 16, fontWeight: 900 };

const tableWrap: React.CSSProperties = {
  marginTop: 14,
  maxHeight: "60vh",
  overflow: "auto",
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.18)",
};

const table: React.CSSProperties = { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13.5 };

const thBase: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 900,
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  background: "#fff",
};

const thLeft: React.CSSProperties = { ...thBase, width: 48 };
const th: React.CSSProperties = { ...thBase };
const thRight: React.CSSProperties = { ...thBase, textAlign: "right", width: 140 };

const tdBase: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
  background: "#fff",
  verticalAlign: "middle",
};

const tdLeft: React.CSSProperties = { ...tdBase };
const td: React.CSSProperties = { ...tdBase };
const tdRightStrong: React.CSSProperties = { ...tdBase, textAlign: "right", fontWeight: 900, fontSize: 15 };

const rankNum: React.CSSProperties = { fontWeight: 900, opacity: 0.6 };
const rankNumTop: React.CSSProperties = { fontWeight: 900, color: "#dc2626" };

const stampBadge: React.CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 900,
  color: "#dc2626",
  border: "1.5px solid #dc2626",
  borderRadius: 6,
  padding: "1px 6px",
  marginLeft: 8,
  transform: "rotate(-3deg)",
};

const barWrap: React.CSSProperties = {
  marginTop: 6,
  height: 5,
  background: "#f1f5f9",
  borderRadius: 4,
  overflow: "hidden",
  maxWidth: 260,
};

const barFill: React.CSSProperties = { height: "100%", borderRadius: 4 };

export default BestSellersReportPage;