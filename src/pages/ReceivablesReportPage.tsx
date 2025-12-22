// src/pages/ReceivablesReportPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

/* ======================= Types ======================= */

type ReceivableInvoiceRow = {
  invoiceId: string;
  code: string;
  issueDate: string; // yyyy-MM-dd
  partnerId: string | null;
  partnerName: string;

  saleUserId?: string | null;
  saleName?: string | null;

  total: number;

  hasWarrantyHold: boolean;
  warrantyHoldAmount: number;
  warrantyDueDate: string | null;

  paidTotal: number;
  paidNormal: number;
  paidWarranty: number;

  normalOutstanding: number;
  warrantyOutstanding: number;

  warrantyHoldNotDue: number;
  warrantyHoldDue: number;

  totalOutstanding: number;
};

type ReceivablesByPartnerRow = {
  partnerId: string | null;
  partnerName: string;

  normalOutstanding: number;
  warrantyHoldNotDue: number;
  warrantyHoldDue: number;

  totalOutstanding: number;
  invoiceCount: number;
};

type ReportResp = {
  ok: boolean;
  data: {
    asOf: string;
    summary: {
      normalOutstanding: number;
      warrantyHoldNotDue: number;
      warrantyHoldDue: number;
      totalOutstanding: number;
      invoiceCount: number;
    };
    byPartner: ReceivablesByPartnerRow[];
    rows: ReceivableInvoiceRow[];
  };
};

type PaymentAccount = { id: string; code: string; name: string; isActive?: boolean };

/* ======================= Helpers ======================= */

function fmtMoney(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clampText(s: string, max = 34) {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientApiError(e: any) {
  const status = e?.response?.status;
  const msg = String(e?.response?.data?.message || e?.message || "").toLowerCase();

  if (status === 503 || status === 504) return true;
  if (msg.includes("p1017") || msg.includes("p1001")) return true;
  if (msg.includes("server has closed the connection")) return true;
  if (msg.includes("can't reach database")) return true;
  if (msg.includes("timeout") || msg.includes("timed out")) return true;

  return false;
}

function num(x: any) {
  const v = Number(x ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function safeFileSlug(s: string) {
  return String(s || "")
    .trim()
    .replace(/[^\p{L}\p{N}\-_\s]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function parseYmdToDate(ymd: string) {
  // yyyy-mm-dd -> Date local (để Excel hiển thị đúng)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return new Date(ymd);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
}

/* ======================= Excel Builder ======================= */

async function buildReceivablesExcel(params: {
  asOf: string;
  tabLabel: string;
  saleLabel: string;
  searchLabel: string;
  includeRows: boolean;
  summary: ReportResp["data"]["summary"] | null;
  totalsInView: { normal: number; hold: number; due: number; total: number; count: number };
  rows: ReceivableInvoiceRow[];
}) {
  const { asOf, tabLabel, saleLabel, searchLabel, includeRows, summary, totalsInView, rows } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Quản lý kho";
  wb.created = new Date();

  const ws = wb.addWorksheet("Công nợ phải thu", {
    views: [{ state: "frozen", ySplit: 12 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  // Columns (A..J)
  ws.columns = [
    { key: "A", width: 6 },   // STT
    { key: "B", width: 16 },  // Mã HĐ
    { key: "C", width: 13 },  // Ngày
    { key: "D", width: 28 },  // Khách
    { key: "E", width: 18 },  // NV sale
    { key: "F", width: 15 },  // Tổng
    { key: "G", width: 15 },  // Nợ thường
    { key: "H", width: 15 },  // BH treo
    { key: "I", width: 15 },  // BH đến hạn
    { key: "J", width: 15 },  // Tổng nợ
    { key: "K", width: 18 },  // BH tổng
    { key: "L", width: 16 },  // Ngày đến hạn
  ];

  const moneyFmt = "#,##0";

  function cell(r: number, c: number) {
    return ws.getCell(r, c);
  }

  function setBorder(r1: number, c1: number, r2: number, c2: number) {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        ws.getCell(r, c).border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };
      }
    }
  }

  // ===== Title =====
  ws.mergeCells("A1:L1");
  const t = ws.getCell("A1");
  t.value = "BÁO CÁO CÔNG NỢ PHẢI THU";
  t.font = { bold: true, size: 16 };
  t.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 28;

  // ===== Meta block (2 columns) =====
  const metaTop = 3;
  const meta = [
    ["Chốt đến", asOf],
    ["Bộ lọc tab", tabLabel],
    ["Lọc NV sale", saleLabel],
    ["Từ khóa tìm kiếm", searchLabel || "(Không)"],
    ["Chi tiết hóa đơn", includeRows ? "Bật" : "Tắt"],
  ];

  for (let i = 0; i < meta.length; i++) {
    const r = metaTop + i;
    cell(r, 1).value = meta[i][0];
    cell(r, 1).font = { bold: true };
    cell(r, 2).value = meta[i][1];
    cell(r, 1).alignment = { vertical: "middle", horizontal: "left" };
    cell(r, 2).alignment = { vertical: "middle", horizontal: "left" };
  }
  setBorder(metaTop, 1, metaTop + meta.length - 1, 4);
  ws.mergeCells(`B${metaTop}:D${metaTop}`);
  ws.mergeCells(`B${metaTop + 1}:D${metaTop + 1}`);
  ws.mergeCells(`B${metaTop + 2}:D${metaTop + 2}`);
  ws.mergeCells(`B${metaTop + 3}:D${metaTop + 3}`);
  ws.mergeCells(`B${metaTop + 4}:D${metaTop + 4}`);

  // ===== KPI cards =====
  const kpiTop = 3;
  const kpiLeft = 6; // col F
  const kpis = [
    { label: "Nợ thường", value: num(summary?.normalOutstanding ?? 0), tone: "normal" },
    { label: "BH treo", value: num(summary?.warrantyHoldNotDue ?? 0), tone: "hold" },
    { label: "BH đến hạn", value: num(summary?.warrantyHoldDue ?? 0), tone: "due" },
    { label: "Tổng phải thu", value: num(summary?.totalOutstanding ?? 0), tone: "total" },
  ];

  for (let i = 0; i < kpis.length; i++) {
    const colStart = kpiLeft + i * 2; // F/H/J/L (2 cols each)
    const colEnd = colStart + 1;

    // merge block (2 columns, 3 rows)
    ws.mergeCells(kpiTop, colStart, kpiTop, colEnd);
    ws.mergeCells(kpiTop + 1, colStart, kpiTop + 1, colEnd);
    ws.mergeCells(kpiTop + 2, colStart, kpiTop + 2, colEnd);

    const labelCell = cell(kpiTop, colStart);
    const valCell = cell(kpiTop + 1, colStart);
    const hintCell = cell(kpiTop + 2, colStart);

    labelCell.value = kpis[i].label;
    labelCell.font = { bold: true, size: 11 };
    labelCell.alignment = { vertical: "middle", horizontal: "left" };

    valCell.value = kpis[i].value;
    valCell.numFmt = moneyFmt;
    valCell.font = { bold: true, size: 14 };
    valCell.alignment = { vertical: "middle", horizontal: "right" };

    hintCell.value =
      kpis[i].tone === "normal" ? "Phải thu ngay" : kpis[i].tone === "hold" ? "Chưa đến hạn" : kpis[i].tone === "due" ? "Đã đến hạn" : "Tổng công nợ";
    hintCell.font = { size: 10, color: { argb: "FF64748B" } };
    hintCell.alignment = { vertical: "middle", horizontal: "left" };

    // background
    const bg =
      kpis[i].tone === "due"
        ? "FFFEE2E2"
        : kpis[i].tone === "hold"
        ? "FFFFF7ED"
        : kpis[i].tone === "total"
        ? "FFF1F5F9"
        : "FFF8FAFC";

    for (let rr = kpiTop; rr <= kpiTop + 2; rr++) {
      for (let cc = colStart; cc <= colEnd; cc++) {
        ws.getCell(rr, cc).fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      }
    }

    setBorder(kpiTop, colStart, kpiTop + 2, colEnd);
  }

  // row heights around header
  ws.getRow(3).height = 18;
  ws.getRow(4).height = 24;
  ws.getRow(5).height = 18;

  // ===== Totals-in-view strip =====
  const stripRow = 9;
  ws.mergeCells(stripRow, 1, stripRow, 12);
  const strip = ws.getCell(stripRow, 1);
  strip.value = `TỔNG TRONG DANH SÁCH HIỆN TẠI (SAU LỌC): ${totalsInView.count} HĐ · Nợ thường ${fmtMoney(
    totalsInView.normal
  )} · BH treo ${fmtMoney(totalsInView.hold)} · BH đến hạn ${fmtMoney(totalsInView.due)} · Tổng ${fmtMoney(totalsInView.total)}`;
  strip.font = { bold: true, size: 11 };
  strip.alignment = { vertical: "middle", horizontal: "left" };
  strip.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  setBorder(stripRow, 1, stripRow, 12);
  ws.getRow(stripRow).height = 20;

  // ===== Table header =====
  const headerRow = 12;
  const headers = [
    "STT",
    "Mã HĐ",
    "Ngày",
    "Khách hàng",
    "NV sale",
    "Tổng (VAT)",
    "Nợ thường",
    "BH treo",
    "BH đến hạn",
    "Tổng nợ",
    "BH tổng",
    "Ngày đến hạn",
  ];

  ws.getRow(headerRow).values = headers as any;
  ws.getRow(headerRow).height = 22;

  for (let c = 1; c <= headers.length; c++) {
    const h = ws.getCell(headerRow, c);
    h.font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
    h.alignment = { vertical: "middle", horizontal: c >= 6 ? "right" : "left", wrapText: true };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    h.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
  }

  // ===== Table rows =====
  let r = headerRow + 1;
  for (let i = 0; i < rows.length; i++) {
    const x = rows[i];
    const dueWarn = (x.warrantyHoldDue || 0) > 0;

    ws.getCell(r, 1).value = i + 1;
    ws.getCell(r, 2).value = x.code || "";
    ws.getCell(r, 3).value = x.issueDate ? parseYmdToDate(x.issueDate) : "";
    ws.getCell(r, 3).numFmt = "yyyy-mm-dd";
    ws.getCell(r, 4).value = x.partnerName || "";
    ws.getCell(r, 5).value = x.saleName || "";

    const moneyCells = [
      { col: 6, val: num(x.total) },
      { col: 7, val: num(x.normalOutstanding || 0) },
      { col: 8, val: num(x.warrantyHoldNotDue || 0) },
      { col: 9, val: num(x.warrantyHoldDue || 0) },
      { col: 10, val: num(x.totalOutstanding || 0) },
      { col: 11, val: x.hasWarrantyHold ? num(x.warrantyHoldAmount || 0) : 0 },
    ];

    for (const m of moneyCells) {
      const c = ws.getCell(r, m.col);
      c.value = m.val;
      c.numFmt = moneyFmt;
      c.alignment = { vertical: "middle", horizontal: "right" };
    }

    ws.getCell(r, 12).value = x.warrantyDueDate ? parseYmdToDate(x.warrantyDueDate) : "";
    ws.getCell(r, 12).numFmt = "yyyy-mm-dd";

    // alignment for text cols
    ws.getCell(r, 1).alignment = { vertical: "middle", horizontal: "right" };
    ws.getCell(r, 2).alignment = { vertical: "middle", horizontal: "left" };
    ws.getCell(r, 4).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    ws.getCell(r, 5).alignment = { vertical: "middle", horizontal: "left" };

    // borders
    for (let c = 1; c <= 12; c++) {
      ws.getCell(r, c).border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    }

    // highlight due column if >0
    if (dueWarn) {
      ws.getCell(r, 9).font = { bold: true, color: { argb: "FFDC2626" } };
    }

    r++;
  }

  // ===== Auto filter =====
  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: 12 },
  };

  return wb;
}

/* ======================= Page ======================= */

const ReceivablesReportPage: React.FC = () => {
  const { toasts, push, remove } = useToast();

  const [asOf, setAsOf] = useState(todayYmd());
  const [includeRows, setIncludeRows] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [summary, setSummary] = useState<ReportResp["data"]["summary"] | null>(null);
  const [rows, setRows] = useState<ReceivableInvoiceRow[]>([]);

  const [tab, setTab] = useState<"ALL" | "NORMAL" | "WARRANTY">("ALL");
  const [search, setSearch] = useState("");
  const [saleKey, setSaleKey] = useState<string>("__ALL__");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [bannerError, setBannerError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  async function fetchData(opts?: { silent?: boolean }) {
    const silent = opts?.silent ?? false;
    const mySeq = ++reqSeq.current;

    try {
      setLoading(true);
      setBannerError(null);

      const tries = 3;
      let lastErr: any = null;

      for (let i = 0; i < tries; i++) {
        try {
          const resp = await api.get<ReportResp>("/receivables_report", {
            params: { asOf, includeRows: includeRows ? 1 : 0 },
          });

          if (mySeq !== reqSeq.current) return;
          if (!resp.data?.ok) throw new Error("API trả về lỗi");

          const data = resp.data.data;
          setSummary(data.summary);
          setRows(data.rows || []);

          if (!silent) push({ type: "success", message: `Đã tải công nợ (chốt ${data.asOf})` });
          return;
        } catch (e: any) {
          lastErr = e;
          if (!isTransientApiError(e) || i === tries - 1) throw e;
          await sleep(i === 0 ? 250 : 700);
        }
      }

      throw lastErr;
    } catch (e: any) {
      if (mySeq !== reqSeq.current) return;

      const msg = e?.response?.data?.message || e?.message || "Lỗi tải báo cáo";
      setBannerError(msg);
      push({ type: "error", message: msg });
    } finally {
      if (mySeq === reqSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    fetchData({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchData({ silent: true }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf, includeRows]);

  const saleOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const id = (r.saleUserId || "").trim();
      const name = (r.saleName || "").trim();
      if (id) map.set(id, name || id);
      else if (name) map.set(`__NAME__:${name}`, name);
    }
    const list = Array.from(map.entries()).map(([key, label]) => ({ key, label }));
    list.sort((a, b) => (a.label || "").localeCompare(b.label || "", "vi"));
    return list;
  }, [rows]);

  const filteredRows = useMemo(() => {
    let list = [...rows];

    list = list.filter((r) => (r.normalOutstanding || 0) > 0 || (r.warrantyOutstanding || 0) > 0);

    if (saleKey !== "__ALL__") {
      if (saleKey.startsWith("__NAME__:")) {
        const name = saleKey.slice("__NAME__:".length);
        list = list.filter((r) => (r.saleName || "") === name);
      } else {
        list = list.filter((r) => (r.saleUserId || "") === saleKey);
      }
    }

    if (tab === "NORMAL") list = list.filter((r) => (r.normalOutstanding || 0) > 0);
    if (tab === "WARRANTY") list = list.filter((r) => (r.warrantyOutstanding || 0) > 0);

    const s = searchDebounced.trim().toLowerCase();
    if (s) {
      list = list.filter(
        (r) =>
          (r.code || "").toLowerCase().includes(s) ||
          (r.partnerName || "").toLowerCase().includes(s) ||
          (r.saleName || "").toLowerCase().includes(s)
      );
    }

    list.sort((a, b) => (b.totalOutstanding || 0) - (a.totalOutstanding || 0));
    return list;
  }, [rows, tab, searchDebounced, saleKey]);

  const totalsInView = useMemo(() => {
    let normal = 0;
    let hold = 0;
    let due = 0;
    let total = 0;
    for (const r of filteredRows) {
      normal += r.normalOutstanding || 0;
      hold += r.warrantyHoldNotDue || 0;
      due += r.warrantyHoldDue || 0;
      total += r.totalOutstanding || 0;
    }
    return { normal, hold, due, total, count: filteredRows.length };
  }, [filteredRows]);

  async function exportExcelPretty() {
    if (exporting) return;

    try {
      setExporting(true);
      push({ type: "info", message: "Đang xuất Excel..." });

      const saleLabel =
        saleKey === "__ALL__" ? "Tất cả NV sale" : saleOptions.find((x) => x.key === saleKey)?.label || "Đã chọn";
      const tabLabel = tab === "ALL" ? "Tất cả" : tab === "NORMAL" ? "Nợ thường" : "Nợ bảo hành";
      const searchLabel = (searchDebounced || "").trim();

      const wb = await buildReceivablesExcel({
        asOf,
        tabLabel,
        saleLabel,
        searchLabel,
        includeRows,
        summary,
        totalsInView,
        rows: filteredRows, // ✅ export theo đúng list đang nhìn
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const filename = `cong-no-phai-thu_${asOf}_${safeFileSlug(tabLabel)}.xlsx`;
      saveAs(blob, filename);

      push({ type: "success", message: `Đã xuất Excel: ${filename}` });
    } catch (e: any) {
      push({ type: "error", message: e?.message || "Xuất Excel thất bại" });
    } finally {
      setExporting(false);
    }
  }

  /* ======================= Warranty Collect Modal (giữ nguyên) ======================= */

  const [whOpen, setWhOpen] = useState(false);
  const [whRow, setWhRow] = useState<ReceivableInvoiceRow | null>(null);

  const [whPayDate, setWhPayDate] = useState(todayYmd());
  const [whAmount, setWhAmount] = useState<number>(0);
  const [whNote, setWhNote] = useState<string>("");

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [loadingPay, setLoadingPay] = useState(false);
  const accountsLoadedRef = useRef(false);

  async function loadAccountsOnce() {
    if (accountsLoadedRef.current) return;
    accountsLoadedRef.current = true;

    try {
      const resp = await api.get<any>("/payment_accounts");
      const list: PaymentAccount[] = resp?.data?.data || resp?.data?.rows || resp?.data || resp?.data?.items || [];
      if (Array.isArray(list)) {
        setAccounts(
          list
            .map((x: any) => ({
              id: String(x.id),
              code: String(x.code || ""),
              name: String(x.name || x.code || x.id),
              isActive: x.isActive ?? true,
            }))
            .filter((x) => x.id && (x.isActive ?? true))
        );
      }
    } catch {
      setAccounts([]);
    }
  }

  function openCollectWarranty(row: ReceivableInvoiceRow) {
    setWhRow(row);
    setWhPayDate(todayYmd());
    setWhAmount(Math.max(0, Math.round(num(row.warrantyOutstanding))));
    setWhNote(`Thu bảo hành treo HĐ ${row.code}`);
    setAccountId("");
    setWhOpen(true);
    loadAccountsOnce();
  }

  function closeCollectWarranty() {
    if (loadingPay) return;
    setWhOpen(false);
    setWhRow(null);
  }

  async function submitCollectWarranty() {
    if (!whRow) return;

    const partnerId = whRow.partnerId;
    if (!partnerId) {
      push({ type: "error", message: "Hóa đơn chưa có khách hàng (partnerId) nên không thể tạo phiếu thu." });
      return;
    }

    const remain = num(whRow.warrantyOutstanding);
    const amt = Math.round(num(whAmount));

    if (!Number.isFinite(amt) || amt <= 0) {
      push({ type: "error", message: "Số tiền thu bảo hành phải > 0." });
      return;
    }
    if (amt > remain + 0.0001) {
      push({ type: "error", message: `Thu vượt số bảo hành còn lại. Còn lại: ${fmtMoney(remain)}.` });
      return;
    }

    try {
      setLoadingPay(true);

      await api.post("/payments", {
        date: whPayDate,
        partnerId,
        type: "RECEIPT",
        amount: amt,
        accountId: accountId || undefined,
        note: whNote || undefined,
        allocations: [{ invoiceId: whRow.invoiceId, amount: amt, kind: "WARRANTY_HOLD" }],
      });

      push({ type: "success", message: `Đã thu bảo hành: ${fmtMoney(amt)} (HĐ ${whRow.code})` });

      setWhOpen(false);
      setWhRow(null);

      await fetchData({ silent: true });
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || "Không tạo được phiếu thu bảo hành";
      push({ type: "error", message: msg });
    } finally {
      setLoadingPay(false);
    }
  }

  return (
    <div style={page}>
      <ToastHost toasts={toasts} onClose={remove} />

      {/* Header */}
      <div style={header}>
        <div>
          <div style={title}>Công nợ phải thu</div>
          <div style={subtitle}>
            Chốt đến <b>{asOf}</b> · {summary?.invoiceCount ?? 0} hóa đơn
          </div>
        </div>

        <div style={headerRight}>
          <div style={field}>
            <div style={fieldLabel}>Chốt đến</div>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={input} />
          </div>

          <label style={checkRow}>
            <input type="checkbox" checked={includeRows} onChange={(e) => setIncludeRows(e.target.checked)} />
            <span>Chi tiết hóa đơn</span>
          </label>

          <button onClick={exportExcelPretty} disabled={exporting || loading} style={ghostBtnBtn(exporting || loading)}>
            {exporting ? "Đang xuất..." : "Xuất Excel"}
          </button>

          <button onClick={() => fetchData({ silent: false })} disabled={loading} style={primaryBtn(loading)}>
            {loading ? "Đang tải..." : "Tải lại"}
          </button>
        </div>
      </div>

      {bannerError ? (
        <div style={banner}>
          <div style={{ fontWeight: 900 }}>Không tải được báo cáo</div>
          <div style={{ opacity: 0.85, marginTop: 2 }}>{bannerError}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={ghostBtn} onClick={() => fetchData({ silent: false })}>
              Thử lại
            </button>
          </div>
        </div>
      ) : null}

      {/* KPI */}
      <div style={kpiGrid}>
        <KpiCard label="Nợ thường" value={summary?.normalOutstanding ?? 0} hint="Phải thu ngay" />
        <KpiCard label="Bảo hành treo" value={summary?.warrantyHoldNotDue ?? 0} hint="Chưa đến hạn" tone="hold" />
        <KpiCard label="Bảo hành đến hạn" value={summary?.warrantyHoldDue ?? 0} hint="Đã đến hạn" tone="due" />
        <KpiCard label="Tổng phải thu" value={summary?.totalOutstanding ?? 0} hint="Tổng công nợ" strong />
      </div>

      {/* Main */}
      <div style={mainGridSingle}>
        <div style={panel}>
          <div style={panelHeader}>
            <div>
              <div style={panelTitle}>Chi tiết hóa đơn</div>
              <div style={{ ...subtitle, marginTop: 2, opacity: 0.75 }}>
                Lọc theo NV sale:{" "}
                <b>
                  {saleKey === "__ALL__" ? "Tất cả" : saleOptions.find((x) => x.key === saleKey)?.label || "Đã chọn"}
                </b>
              </div>
            </div>

            <div style={filtersRow}>
              <div style={tabs}>
                <button style={tabBtn(tab === "ALL")} onClick={() => setTab("ALL")}>
                  Tất cả
                </button>
                <button style={tabBtn(tab === "NORMAL")} onClick={() => setTab("NORMAL")}>
                  Nợ thường
                </button>
                <button style={tabBtn(tab === "WARRANTY")} onClick={() => setTab("WARRANTY")}>
                  Nợ bảo hành
                </button>
              </div>

              <select
                value={saleKey}
                onChange={(e) => setSaleKey(e.target.value)}
                style={{ ...input, width: 220, cursor: "pointer" }}
                title="Lọc theo nhân viên sale"
              >
                <option value="__ALL__">Tất cả NV sale</option>
                {saleOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm mã HĐ / khách / sale..."
                style={{ ...input, width: 280 }}
              />
            </div>
          </div>

          {/* totals strip */}
          <div style={strip}>
            <div style={stripItem}>
              <div style={stripLabel}>Trong danh sách</div>
              <div style={stripValue}>{totalsInView.count} HĐ</div>
            </div>
            <div style={stripItem}>
              <div style={stripLabel}>Nợ thường</div>
              <div style={stripValue}>{fmtMoney(totalsInView.normal)}</div>
            </div>
            <div style={stripItem}>
              <div style={stripLabel}>BH treo</div>
              <div style={stripValue}>{fmtMoney(totalsInView.hold)}</div>
            </div>
            <div style={stripItem}>
              <div style={stripLabel}>BH đến hạn</div>
              <div style={{ ...stripValue, ...(totalsInView.due > 0 ? dueText : null) }}>{fmtMoney(totalsInView.due)}</div>
            </div>
            <div style={{ ...stripItem, marginLeft: "auto", textAlign: "right" }}>
              <div style={stripLabel}>Tổng phải thu</div>
              <div style={{ ...stripValue, fontWeight: 900 }}>{fmtMoney(totalsInView.total)}</div>
            </div>
          </div>

          {!includeRows ? (
            <div style={{ padding: 14, opacity: 0.8 }}>Bạn đang tắt “Chi tiết hóa đơn”. Bật lại để xem bảng chi tiết.</div>
          ) : (
            <div style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={thLeft}>Mã HĐ</th>
                    <th style={th}>Ngày</th>
                    <th style={th}>Khách</th>
                    <th style={th}>NV sale</th>
                    <th style={thRight}>Tổng</th>
                    <th style={thRight}>Nợ thường</th>
                    <th style={thRight}>BH treo</th>
                    <th style={thRight}>BH đến hạn</th>
                    <th style={thRight}>Tổng nợ</th>
                    {tab === "WARRANTY" ? <th style={thRight}>Thao tác</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={tab === "WARRANTY" ? 10 : 9} style={{ padding: 14, opacity: 0.75 }}>
                        Không có hóa đơn phù hợp bộ lọc.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((r) => {
                      const warnDue = (r.warrantyHoldDue || 0) > 0;
                      const canCollectWarranty = (r.warrantyOutstanding || 0) > 0;

                      return (
                        <tr key={r.invoiceId} style={trRow} className="rowHover">
                          <td style={tdLeft}>
                            <div style={{ fontWeight: 900 }}>{r.code}</div>
                            {r.hasWarrantyHold ? (
                              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                                BH: {fmtMoney(r.warrantyHoldAmount)} {r.warrantyDueDate ? `· đến ${r.warrantyDueDate}` : ""}
                              </div>
                            ) : null}
                          </td>
                          <td style={td}>{r.issueDate}</td>
                          <td style={td}>{clampText(r.partnerName, 28)}</td>
                          <td style={td}>{clampText(r.saleName || "-", 22) || "-"}</td>
                          <td style={tdRight}>{fmtMoney(r.total)}</td>
                          <td style={tdRight}>{fmtMoney(r.normalOutstanding || 0)}</td>
                          <td style={tdRight}>{fmtMoney(r.warrantyHoldNotDue || 0)}</td>
                          <td style={{ ...tdRight, ...(warnDue ? dueText : null) }}>{fmtMoney(r.warrantyHoldDue || 0)}</td>
                          <td style={tdRightStrong}>{fmtMoney(r.totalOutstanding || 0)}</td>

                          {tab === "WARRANTY" ? (
                            <td style={tdRight}>
                              <button
                                style={miniBtn(!canCollectWarranty)}
                                disabled={!canCollectWarranty}
                                onClick={() => openCollectWarranty(r)}
                                title={canCollectWarranty ? "Thu bảo hành treo" : "Không còn nợ bảo hành"}
                              >
                                Thu BH
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal Thu bảo hành */}
      {whOpen && whRow ? (
        <div style={modalOverlay} onMouseDown={closeCollectWarranty}>
          <div style={modalCard} onMouseDown={(e) => e.stopPropagation()}>
            <div style={modalHeader}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 14 }}>Thu bảo hành treo</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  HĐ <b>{whRow.code}</b> · Khách: <b>{whRow.partnerName}</b>
                </div>
              </div>
              <button style={modalCloseBtn} onClick={closeCollectWarranty} disabled={loadingPay}>
                ✕
              </button>
            </div>

            <div style={modalBody}>
              <div style={modalInfoGrid}>
                <InfoLine label="Bảo hành treo" value={fmtMoney(num(whRow.warrantyHoldAmount))} />
                <InfoLine label="Còn phải thu" value={fmtMoney(num(whRow.warrantyOutstanding))} strong />
                <InfoLine label="Đến hạn" value={whRow.warrantyDueDate || "-"} />
              </div>

              <div style={modalFormGrid}>
                <div style={field}>
                  <div style={fieldLabel}>Ngày thu</div>
                  <input type="date" value={whPayDate} onChange={(e) => setWhPayDate(e.target.value)} style={input} disabled={loadingPay} />
                </div>

                <div style={field}>
                  <div style={fieldLabel}>Số tiền thu</div>
                  <input
                    value={String(whAmount)}
                    onChange={(e) => setWhAmount(num(e.target.value))}
                    style={input}
                    disabled={loadingPay}
                    inputMode="numeric"
                    placeholder="0"
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Tối đa: <b>{fmtMoney(num(whRow.warrantyOutstanding))}</b>
                  </div>
                </div>

                <div style={field}>
                  <div style={fieldLabel}>Tài khoản nhận</div>
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    style={{ ...input, cursor: "pointer" }}
                    disabled={loadingPay}
                    title="Chọn tài khoản nhận tiền (nếu có)"
                  >
                    <option value="">Không chọn</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} {a.code ? `(${a.code})` : ""}
                      </option>
                    ))}
                  </select>
                  {accounts.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                      (Chưa có API danh sách tài khoản hoặc chưa cấu hình — vẫn thu được nếu không chọn.)
                    </div>
                  ) : null}
                </div>

                <div style={{ ...field, gridColumn: "1 / -1" }}>
                  <div style={fieldLabel}>Ghi chú</div>
                  <input value={whNote} onChange={(e) => setWhNote(e.target.value)} style={input} disabled={loadingPay} placeholder="Ghi chú..." />
                </div>
              </div>
            </div>

            <div style={modalFooter}>
              <button style={ghostBtn} onClick={closeCollectWarranty} disabled={loadingPay}>
                Đóng
              </button>
              <button style={primaryBtn(loadingPay)} onClick={submitCollectWarranty} disabled={loadingPay}>
                {loadingPay ? "Đang tạo phiếu..." : "Xác nhận thu bảo hành"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .rowHover:hover { background: rgba(15, 23, 42, 0.04); }
      `}</style>
    </div>
  );
};

/* ======================= Small components ======================= */

const KpiCard: React.FC<{
  label: string;
  value: number;
  hint?: string;
  strong?: boolean;
  tone?: "hold" | "due";
}> = ({ label, value, hint, strong, tone }) => {
  const border =
    tone === "due"
      ? "1px solid rgba(239, 68, 68, 0.25)"
      : tone === "hold"
      ? "1px solid rgba(245, 158, 11, 0.22)"
      : "1px solid rgba(148, 163, 184, 0.22)";
  const bg =
    tone === "due"
      ? "rgba(239, 68, 68, 0.06)"
      : tone === "hold"
      ? "rgba(245, 158, 11, 0.06)"
      : "rgba(2, 6, 23, 0.02)";

  return (
    <div style={{ ...card, border, background: bg }}>
      <div style={cardLabel}>{label}</div>
      <div style={{ ...cardValue, fontWeight: strong ? 900 : 850 }}>{fmtMoney(value)}</div>
      <div style={cardHint}>{hint || "\u00A0"}</div>
    </div>
  );
};

const InfoLine: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => {
  return (
    <div style={infoLine}>
      <div style={infoLabel}>{label}</div>
      <div style={{ ...infoValue, ...(strong ? { fontWeight: 950 } : null) }}>{value}</div>
    </div>
  );
};

/* ======================= Styles (giữ nguyên như bạn gửi) ======================= */

const page: React.CSSProperties = {
  padding: 18,
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: 16,
  flexWrap: "wrap",
};

const title: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  letterSpacing: 0.2,
};

const subtitle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12.5,
  opacity: 0.75,
};

const headerRight: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
};

const input: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.28)",
  background: "rgba(2, 6, 23, 0.02)",
  outline: "none",
};

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid rgba(15, 23, 42, 0.18)",
    background: disabled ? "rgba(2, 6, 23, 0.06)" : "rgba(2, 6, 23, 0.10)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
  };
}

function ghostBtnBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 12px",
    borderRadius: 10,
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: disabled ? "rgba(2, 6, 23, 0.04)" : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
  };
}

const checkRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  opacity: 0.9,
};

const banner: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(239, 68, 68, 0.22)",
  background: "rgba(239, 68, 68, 0.06)",
};

const kpiGrid: React.CSSProperties = {
  marginTop: 14,
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
};

const card: React.CSSProperties = {
  borderRadius: 14,
  padding: 14,
};

const cardLabel: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.75,
  fontWeight: 800,
};

const cardValue: React.CSSProperties = {
  marginTop: 8,
  fontSize: 22,
  fontWeight: 900,
};

const cardHint: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  opacity: 0.65,
};

const mainGridSingle: React.CSSProperties = {
  marginTop: 14,
  display: "grid",
  gap: 12,
  gridTemplateColumns: "1fr",
  alignItems: "start",
};

const panel: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "#fff",
  padding: 12,
  boxShadow: "0 8px 16px rgba(0,0,0,0.04)",
};

const panelHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
  flexWrap: "wrap",
};

const panelTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 14,
};

const ghostBtn: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.25)",
  background: "transparent",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 12,
};

const filtersRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const tabs: React.CSSProperties = {
  display: "flex",
  gap: 6,
  padding: 4,
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(2, 6, 23, 0.02)",
};

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "7px 10px",
    borderRadius: 10,
    border: active ? "1px solid rgba(2, 132, 199, 0.35)" : "1px solid transparent",
    background: active ? "rgba(2, 132, 199, 0.08)" : "transparent",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12.5,
  };
}

const strip: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  borderRadius: 14,
  border: "1px solid rgba(148, 163, 184, 0.20)",
  background: "rgba(2, 6, 23, 0.02)",
  display: "flex",
  gap: 14,
  alignItems: "center",
  flexWrap: "wrap",
};

const stripItem: React.CSSProperties = {
  minWidth: 120,
};

const stripLabel: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
  fontWeight: 800,
};

const stripValue: React.CSSProperties = {
  marginTop: 4,
  fontSize: 13.5,
  fontWeight: 900,
};

const dueText: React.CSSProperties = {
  color: "#dc2626",
};

const tableWrap: React.CSSProperties = {
  marginTop: 10,
  maxHeight: "62vh",
  overflow: "auto",
  borderRadius: 14,
  border: "1px solid rgba(148, 163, 184, 0.18)",
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  fontSize: 13,
};

const thBase: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  padding: "10px 10px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 900,
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  background: "#fff",
};

const thLeft: React.CSSProperties = { ...thBase, borderTopLeftRadius: 14 };
const th: React.CSSProperties = { ...thBase };
const thRight: React.CSSProperties = { ...thBase, textAlign: "right" };

const tdBase: React.CSSProperties = {
  padding: "10px 10px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
  background: "#fff",
};

const tdLeft: React.CSSProperties = { ...tdBase, minWidth: 120 };
const td: React.CSSProperties = { ...tdBase };
const tdRight: React.CSSProperties = { ...tdBase, textAlign: "right" };
const tdRightStrong: React.CSSProperties = { ...tdRight, fontWeight: 900 };

const trRow: React.CSSProperties = {
  cursor: "default",
};

function miniBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid rgba(2, 132, 199, 0.35)",
    background: disabled ? "rgba(2, 6, 23, 0.06)" : "rgba(2, 132, 199, 0.08)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 950,
    fontSize: 12,
    opacity: disabled ? 0.6 : 1,
  };
}

/* ===== Modal styles (giữ nguyên) ===== */

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 14,
  zIndex: 1000,
};

const modalCard: React.CSSProperties = {
  width: "min(720px, 98vw)",
  borderRadius: 16,
  background: "#fff",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  boxShadow: "0 18px 38px rgba(0,0,0,0.20)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  maxHeight: "86vh",
};

const modalHeader: React.CSSProperties = {
  padding: 14,
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
};

const modalCloseBtn: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.25)",
  background: "transparent",
  cursor: "pointer",
  fontWeight: 900,
  lineHeight: 1,
};

const modalBody: React.CSSProperties = {
  padding: 14,
  overflow: "auto",
};

const modalFooter: React.CSSProperties = {
  padding: 14,
  borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  position: "sticky",
  bottom: 0,
  background: "#fff",
};

const modalInfoGrid: React.CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  marginBottom: 12,
};

const infoLine: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  background: "rgba(2, 6, 23, 0.02)",
  padding: 10,
};

const infoLabel: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.7,
  fontWeight: 800,
};

const infoValue: React.CSSProperties = {
  marginTop: 6,
  fontSize: 14,
  fontWeight: 900,
};

const modalFormGrid: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
};

export default ReceivablesReportPage;
