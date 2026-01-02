// src/pages/ReceivablesReportPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { CurrencyInput } from "../components/CurrencyInput";

/* ======================= Types ======================= */

type PaymentAccount = { id: string; code: string; name: string; isActive?: boolean };

type PaymentHistoryRow = {
  paymentId: string;
  paymentDate: string; // yyyy-MM-dd
  paymentType: string; // PaymentType
  refNo: string | null;
  allocationKind: "NORMAL" | "WARRANTY_HOLD" | "TAX";
  amount: number;
  note: string | null;
  accountName?: string | null;
  accountCode?: string | null;
};

type ReceivableInvoiceRow = {
  invoiceId: string;
  code: string;
  issueDate: string; // yyyy-MM-dd
  partnerId: string | null;
  partnerName: string;

  saleUserId?: string | null;
  saleName?: string | null;

  netTotal?: number; // ✅ dùng cho "Tổng hóa đơn"
  total?: number; // legacy

  hasWarrantyHold: boolean;
  warrantyHoldAmount: number;
  warrantyDueDate: string | null;

  paidTotal: number;
  paidNormal: number;
  paidWarranty: number;

  normalOutstanding: number; // tiền hàng còn phải thu
  warrantyOutstanding: number; // bảo hành còn phải thu

  warrantyHoldNotDue: number;
  warrantyHoldDue: number;

  totalOutstanding: number;

  paymentHistory?: PaymentHistoryRow[];
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
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return new Date(ymd);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
}

function getInvoiceNetTotal(r: ReceivableInvoiceRow): number {
  const v = (r as any).netTotal;
  if (v != null) return num(v);
  return num((r as any).total);
}

/* ======================= Excel Builder (giữ logic như bản trước) ======================= */

async function buildReceivablesExcel(params: {
  asOf: string;
  tabLabel: string;
  saleLabel: string;
  searchLabel: string;
  includeRows: boolean;
  summary: ReportResp["data"]["summary"] | null;
  totalsInView: { invoiceNet: number; normal: number; hold: number; due: number; total: number; count: number };
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

  ws.columns = [
    { key: "A", width: 6 },
    { key: "B", width: 16 },
    { key: "C", width: 13 },
    { key: "D", width: 28 },
    { key: "E", width: 18 },
    { key: "F", width: 16 }, // Tổng HĐ (net)
    { key: "G", width: 16 }, // Tiền hàng
    { key: "H", width: 15 }, // BH treo
    { key: "I", width: 15 }, // BH đến hạn
    { key: "J", width: 15 }, // Tổng nợ
    { key: "K", width: 18 }, // BH tổng
    { key: "L", width: 16 }, // Ngày đến hạn
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

  ws.mergeCells("A1:L1");
  const t = ws.getCell("A1");
  t.value = "BÁO CÁO CÔNG NỢ PHẢI THU";
  t.font = { bold: true, size: 16 };
  t.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 28;

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

  const kpiTop = 3;
  const kpiLeft = 6;
  const kpis = [
    { label: "Tiền hàng", value: num(summary?.normalOutstanding ?? 0), tone: "normal" },
    { label: "BH treo", value: num(summary?.warrantyHoldNotDue ?? 0), tone: "hold" },
    { label: "BH đến hạn", value: num(summary?.warrantyHoldDue ?? 0), tone: "due" },
    { label: "Tổng phải thu", value: num(summary?.totalOutstanding ?? 0), tone: "total" },
  ];

  for (let i = 0; i < kpis.length; i++) {
    const colStart = kpiLeft + i * 2;
    const colEnd = colStart + 1;

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
      kpis[i].tone === "normal"
        ? "Phải thu ngay"
        : kpis[i].tone === "hold"
        ? "Chưa đến hạn"
        : kpis[i].tone === "due"
        ? "Đã đến hạn"
        : "Tổng công nợ";
    hintCell.font = { size: 10, color: { argb: "FF64748B" } };
    hintCell.alignment = { vertical: "middle", horizontal: "left" };

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

  ws.getRow(3).height = 18;
  ws.getRow(4).height = 24;
  ws.getRow(5).height = 18;

  const stripRow = 9;
  ws.mergeCells(stripRow, 1, stripRow, 12);
  const strip = ws.getCell(stripRow, 1);
  strip.value = `TỔNG TRONG DANH SÁCH HIỆN TẠI (SAU LỌC): ${totalsInView.count} HĐ · Tổng HĐ ${fmtMoney(
    totalsInView.invoiceNet
  )} · Tiền hàng ${fmtMoney(totalsInView.normal)} · BH treo ${fmtMoney(totalsInView.hold)} · BH đến hạn ${fmtMoney(
    totalsInView.due
  )} · Tổng phải thu ${fmtMoney(totalsInView.total)}`;
  strip.font = { bold: true, size: 11 };
  strip.alignment = { vertical: "middle", horizontal: "left" };
  strip.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  setBorder(stripRow, 1, stripRow, 12);
  ws.getRow(stripRow).height = 20;

  const headerRow = 12;
  const headers = ["STT", "Mã HĐ", "Ngày", "Khách hàng", "NV sale", "Tổng HĐ", "Tiền hàng", "BH treo", "BH đến hạn", "Tổng nợ", "BH tổng", "Ngày đến hạn"];
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
      { col: 6, val: getInvoiceNetTotal(x) },
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

    for (let c = 1; c <= 12; c++) {
      ws.getCell(r, c).border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    }

    if (dueWarn) ws.getCell(r, 9).font = { bold: true, color: { argb: "FFDC2626" } };
    r++;
  }

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
    let invoiceNet = 0;
    let normal = 0;
    let hold = 0;
    let due = 0;
    let total = 0;

    for (const r of filteredRows) {
      invoiceNet += getInvoiceNetTotal(r);
      normal += r.normalOutstanding || 0;
      hold += r.warrantyHoldNotDue || 0;
      due += r.warrantyHoldDue || 0;
      total += r.totalOutstanding || 0;
    }
    return { invoiceNet, normal, hold, due, total, count: filteredRows.length };
  }, [filteredRows]);

  async function exportExcelPretty() {
    if (exporting) return;

    try {
      setExporting(true);
      push({ type: "info", message: "Đang xuất Excel..." });

      const saleLabel =
        saleKey === "__ALL__" ? "Tất cả NV sale" : saleOptions.find((x) => x.key === saleKey)?.label || "Đã chọn";
      const tabLabel = tab === "ALL" ? "Tất cả" : tab === "NORMAL" ? "Tiền hàng" : "Bảo hành";
      const searchLabel = (searchDebounced || "").trim();

      const wb = await buildReceivablesExcel({
        asOf,
        tabLabel,
        saleLabel,
        searchLabel,
        includeRows,
        summary,
        totalsInView,
        rows: filteredRows,
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

      const filename = `cong-no-phai-thu_${asOf}_${safeFileSlug(tabLabel)}.xlsx`;
      saveAs(blob, filename);

      push({ type: "success", message: `Đã xuất Excel: ${filename}` });
    } catch (e: any) {
      push({ type: "error", message: e?.message || "Xuất Excel thất bại" });
    } finally {
      setExporting(false);
    }
  }

  /* ======================= Common ======================= */

  const NOTE_TEMPLATES = useMemo(
    () => ["Thu tiền mặt", "Thu chuyển khoản", "Thu bù trừ công nợ", "Thu theo đối soát", "Thu hoàn ứng", "Khác"],
    []
  );

  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [loadingPay, setLoadingPay] = useState(false);
  const accountsLoadedRef = useRef(false);

  async function loadAccountsOnce() {
    if (accountsLoadedRef.current) return;
    accountsLoadedRef.current = true;

    try {
      const resp = await api.get<any>("/payment-accounts");
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

  // ✅ chỉ stopPropagation để input focus bình thường
  function stopBubble(e: any) {
    try {
      e?.stopPropagation?.();
    } catch {}
  }
  // dùng cho button trong table
  function stopAll(e: any) {
    try {
      e?.preventDefault?.();
      e?.stopPropagation?.();
    } catch {}
  }

  /* ======================= Collect WARRANTY Modal ======================= */

  const [whOpen, setWhOpen] = useState(false);
  const [whRow, setWhRow] = useState<ReceivableInvoiceRow | null>(null);

  const [whPayDate, setWhPayDate] = useState(todayYmd());
  const [whAmount, setWhAmount] = useState<number>(0);
  const [whNoteTpl, setWhNoteTpl] = useState<string>(NOTE_TEMPLATES[0] || "");
  const [whNote, setWhNote] = useState<string>("");

  function openCollectWarranty(row: ReceivableInvoiceRow) {
    setWhRow(row);
    setWhPayDate(todayYmd());
    setWhAmount(Math.max(0, Math.round(num(row.warrantyOutstanding))));
    const tpl = NOTE_TEMPLATES[0] || "Thu bảo hành";
    setWhNoteTpl(tpl);
    setWhNote(`${tpl} - HĐ ${row.code}`);
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

    const note = String(whNote || "").trim();
    if (!note) {
      push({ type: "error", message: "Ghi chú là bắt buộc. Vui lòng chọn mẫu hoặc nhập ghi chú." });
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
        note,
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

  /* ======================= Collect NORMAL Modal ======================= */

  const [nOpen, setNOpen] = useState(false);
  const [nRow, setNRow] = useState<ReceivableInvoiceRow | null>(null);

  const [nPayDate, setNPayDate] = useState(todayYmd());
  const [nAmount, setNAmount] = useState<number>(0);
  const [nNoteTpl, setNNoteTpl] = useState<string>(NOTE_TEMPLATES[0] || "");
  const [nNote, setNNote] = useState<string>("");

  function openCollectNormal(row: ReceivableInvoiceRow) {
    setNRow(row);
    setNPayDate(todayYmd());
    setNAmount(Math.max(0, Math.round(num(row.normalOutstanding))));
    const tpl = NOTE_TEMPLATES[0] || "Thu tiền";
    setNNoteTpl(tpl);
    setNNote(`${tpl} - HĐ ${row.code}`);
    setAccountId("");
    setNOpen(true);
    loadAccountsOnce();
  }

  function closeCollectNormal() {
    if (loadingPay) return;
    setNOpen(false);
    setNRow(null);
  }

  async function submitCollectNormal() {
    if (!nRow) return;

    const partnerId = nRow.partnerId;
    if (!partnerId) {
      push({ type: "error", message: "Hóa đơn chưa có khách hàng (partnerId) nên không thể tạo phiếu thu." });
      return;
    }

    const remain = num(nRow.normalOutstanding);
    const amt = Math.round(num(nAmount));

    if (!Number.isFinite(amt) || amt <= 0) {
      push({ type: "error", message: "Số tiền thu tiền hàng phải > 0." });
      return;
    }
    if (amt > remain + 0.0001) {
      push({ type: "error", message: `Thu vượt tiền hàng còn lại. Còn lại: ${fmtMoney(remain)}.` });
      return;
    }

    const note = String(nNote || "").trim();
    if (!note) {
      push({ type: "error", message: "Ghi chú là bắt buộc. Vui lòng chọn mẫu hoặc nhập ghi chú." });
      return;
    }

    try {
      setLoadingPay(true);

      await api.post("/payments", {
        date: nPayDate,
        partnerId,
        type: "RECEIPT",
        amount: amt,
        accountId: accountId || undefined,
        note,
        allocations: [{ invoiceId: nRow.invoiceId, amount: amt, kind: "NORMAL" }],
      });

      push({ type: "success", message: `Đã thu tiền hàng: ${fmtMoney(amt)} (HĐ ${nRow.code})` });

      setNOpen(false);
      setNRow(null);

      await fetchData({ silent: true });
    } catch (e: any) {
      push({ type: "error", message: e?.response?.data?.message || e?.message || "Tạo phiếu thu thất bại" });
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

          <button type="button" onClick={exportExcelPretty} disabled={exporting || loading} style={ghostBtnBtn(exporting || loading)}>
            {exporting ? "Đang xuất..." : "Xuất Excel"}
          </button>

          <button type="button" onClick={() => fetchData({ silent: false })} disabled={loading} style={primaryBtn(loading)}>
            {loading ? "Đang tải..." : "Tải lại"}
          </button>
        </div>
      </div>

      {bannerError ? (
        <div style={banner}>
          <div style={{ fontWeight: 900 }}>Không tải được báo cáo</div>
          <div style={{ opacity: 0.85, marginTop: 2 }}>{bannerError}</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={ghostBtn} onClick={() => fetchData({ silent: false })}>
              Thử lại
            </button>
          </div>
        </div>
      ) : null}

      {/* KPI */}
      <div style={kpiGrid}>
        <KpiCard label="Tiền hàng" value={summary?.normalOutstanding ?? 0} hint="Phải thu ngay" />
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
                <b>{saleKey === "__ALL__" ? "Tất cả" : saleOptions.find((x) => x.key === saleKey)?.label || "Đã chọn"}</b>
              </div>
            </div>

            <div style={filtersRow}>
              <div style={tabs}>
                <button type="button" style={tabBtn(tab === "ALL")} onClick={() => setTab("ALL")}>
                  Tất cả
                </button>
                <button type="button" style={tabBtn(tab === "NORMAL")} onClick={() => setTab("NORMAL")}>
                  Tiền hàng
                </button>
                <button type="button" style={tabBtn(tab === "WARRANTY")} onClick={() => setTab("WARRANTY")}>
                  Bảo hành
                </button>
              </div>

              <select value={saleKey} onChange={(e) => setSaleKey(e.target.value)} style={{ ...input, width: 220, cursor: "pointer" }}>
                <option value="__ALL__">Tất cả NV sale</option>
                {saleOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>

              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm mã HĐ / khách / sale..." style={{ ...input, width: 280 }} />
            </div>
          </div>

          {/* totals strip */}
          <div style={strip}>
            <div style={stripItem}>
              <div style={stripLabel}>Trong danh sách</div>
              <div style={stripValue}>{totalsInView.count} HĐ</div>
            </div>
            <div style={stripItem}>
              <div style={stripLabel}>Tổng hóa đơn</div>
              <div style={stripValue}>{fmtMoney(totalsInView.invoiceNet)}</div>
            </div>
            <div style={stripItem}>
              <div style={stripLabel}>Tiền hàng</div>
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
                    <th style={thRight}>Tổng HĐ</th>
                    <th style={thRight}>Tiền hàng</th>
                    <th style={thRight}>BH treo</th>
                    <th style={thRight}>BH đến hạn</th>
                    <th style={thRight}>Tổng nợ</th>
                    <th style={thRight}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: 14, opacity: 0.75 }}>
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

                          <td style={tdRight}>{fmtMoney(getInvoiceNetTotal(r))}</td>
                          <td style={tdRight}>{fmtMoney(r.normalOutstanding || 0)}</td>
                          <td style={tdRight}>{fmtMoney(r.warrantyHoldNotDue || 0)}</td>
                          <td style={{ ...tdRight, ...(warnDue ? dueText : null) }}>{fmtMoney(r.warrantyHoldDue || 0)}</td>
                          <td style={tdRightStrong}>{fmtMoney(r.totalOutstanding || 0)}</td>

                          <td style={tdRight}>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                              {tab !== "WARRANTY" ? (
                                <button
                                  type="button"
                                  style={miniBtn(!(r.normalOutstanding > 0))}
                                  disabled={!(r.normalOutstanding > 0)}
                                  onMouseDown={stopAll}
                                  onClick={(e) => {
                                    stopAll(e);
                                    openCollectNormal(r);
                                  }}
                                  title={r.normalOutstanding > 0 ? "Thu tiền hàng" : "Không còn tiền hàng"}
                                >
                                  Thu tiền
                                </button>
                              ) : null}

                              {tab !== "NORMAL" ? (
                                <button
                                  type="button"
                                  style={miniBtn(!canCollectWarranty)}
                                  disabled={!canCollectWarranty}
                                  onMouseDown={stopAll}
                                  onClick={(e) => {
                                    stopAll(e);
                                    openCollectWarranty(r);
                                  }}
                                  title={canCollectWarranty ? "Thu bảo hành" : "Không còn bảo hành"}
                                >
                                  Thu BH
                                </button>
                              ) : null}
                            </div>
                          </td>
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
          <div style={modalCard} onMouseDown={stopBubble}>
            <div style={modalHeader}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 14 }}>Thu bảo hành</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  HĐ <b>{whRow.code}</b> · Khách: <b>{whRow.partnerName}</b>
                </div>
              </div>
              <button type="button" style={modalCloseBtn} onClick={closeCollectWarranty} disabled={loadingPay}>
                ✕
              </button>
            </div>

            <div style={modalBody}>
              <div style={modalInfoGrid}>
                <InfoLine label="Bảo hành tổng" value={fmtMoney(num(whRow.warrantyHoldAmount))} />
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
                  <CurrencyInput
                    value={whAmount}
                    onValueChange={(v) => setWhAmount(v)}
                    min={0}
                    max={Math.round(num(whRow.warrantyOutstanding))}
                    disabled={loadingPay}
                    placeholder="0"
                    className="ri-currency-wrap"
                    inputClassName="ri-input"
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Tối đa: <b>{fmtMoney(num(whRow.warrantyOutstanding))}</b>
                  </div>
                </div>

                <div style={field}>
                  <div style={fieldLabel}>Tài khoản nhận</div>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...input, cursor: "pointer" }} disabled={loadingPay}>
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
                  <div style={fieldLabel}>Mẫu ghi chú</div>
                  <select
                    value={whNoteTpl}
                    onChange={(e) => {
                      const v = e.target.value;
                      setWhNoteTpl(v);
                      setWhNote(`${v} - HĐ ${whRow.code}`);
                    }}
                    style={{ ...input, cursor: "pointer" }}
                    disabled={loadingPay}
                  >
                    {NOTE_TEMPLATES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ ...field, gridColumn: "1 / -1" }}>
                  <div style={fieldLabel}>Ghi chú (bắt buộc)</div>
                  <input value={whNote} onChange={(e) => setWhNote(e.target.value)} style={input} disabled={loadingPay} placeholder="Bắt buộc" />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Lịch sử giao dịch</div>
                <div style={historyBox}>
                  {!(whRow.paymentHistory && whRow.paymentHistory.length) ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Chưa có phát sinh thu/chi.</div>
                  ) : (
                    <table style={historyTable}>
                      <thead>
                        <tr>
                          <th style={hThLeft}>Ngày</th>
                          <th style={hTh}>Loại</th>
                          <th style={hTh}>Ref</th>
                          <th style={hThRight}>Số tiền</th>
                          <th style={hThLeft}>Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {whRow.paymentHistory!.map((h) => (
                          <tr key={h.paymentId + "_" + h.paymentDate + "_" + h.amount + "_" + h.allocationKind}>
                            <td style={hTdLeft}>{h.paymentDate}</td>
                            <td style={hTd}>{h.allocationKind}</td>
                            <td style={hTd}>{h.refNo || ""}</td>
                            <td style={hTdRight}>{fmtMoney(h.amount)}</td>
                            <td style={hTdLeft}>{h.note || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div style={modalFooter}>
              <button type="button" style={ghostBtn} onClick={closeCollectWarranty} disabled={loadingPay}>
                Đóng
              </button>
              <button type="button" style={primaryBtn(loadingPay)} onClick={submitCollectWarranty} disabled={loadingPay}>
                {loadingPay ? "Đang tạo phiếu..." : "Xác nhận thu"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal Thu tiền hàng */}
      {nOpen && nRow ? (
        <div style={modalOverlay} onMouseDown={closeCollectNormal}>
          <div style={modalCard} onMouseDown={stopBubble}>
            <div style={modalHeader}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 14 }}>Thu tiền hàng</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  HĐ <b>{nRow.code}</b> · Khách: <b>{nRow.partnerName}</b>
                </div>
              </div>
              <button type="button" style={modalCloseBtn} onClick={closeCollectNormal} disabled={loadingPay}>
                ✕
              </button>
            </div>

            <div style={modalBody}>
              <div style={modalInfoGrid}>
                <InfoLine label="Còn tiền hàng" value={fmtMoney(num(nRow.normalOutstanding))} strong />
                <InfoLine label="Tổng phải thu" value={fmtMoney(num(nRow.totalOutstanding))} />
                <InfoLine label="Ngày HĐ" value={nRow.issueDate || "-"} />
              </div>

              <div style={modalFormGrid}>
                <div style={field}>
                  <div style={fieldLabel}>Ngày thu</div>
                  <input type="date" value={nPayDate} onChange={(e) => setNPayDate(e.target.value)} style={input} disabled={loadingPay} />
                </div>

                <div style={field}>
                  <div style={fieldLabel}>Số tiền thu</div>
                  <CurrencyInput
                    value={nAmount}
                    onValueChange={(v) => setNAmount(v)}
                    min={0}
                    max={Math.round(num(nRow.normalOutstanding))}
                    disabled={loadingPay}
                    placeholder="0"
                    className="ri-currency-wrap"
                    inputClassName="ri-input"
                  />
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Tối đa: <b>{fmtMoney(num(nRow.normalOutstanding))}</b>
                  </div>
                </div>

                <div style={field}>
                  <div style={fieldLabel}>Tài khoản nhận</div>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...input, cursor: "pointer" }} disabled={loadingPay}>
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
                  <div style={fieldLabel}>Mẫu ghi chú</div>
                  <select
                    value={nNoteTpl}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNNoteTpl(v);
                      setNNote(`${v} - HĐ ${nRow.code}`);
                    }}
                    style={{ ...input, cursor: "pointer" }}
                    disabled={loadingPay}
                  >
                    {NOTE_TEMPLATES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ ...field, gridColumn: "1 / -1" }}>
                  <div style={fieldLabel}>Ghi chú (bắt buộc)</div>
                  <input value={nNote} onChange={(e) => setNNote(e.target.value)} style={input} disabled={loadingPay} placeholder="Bắt buộc" />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Lịch sử giao dịch</div>
                <div style={historyBox}>
                  {!(nRow.paymentHistory && nRow.paymentHistory.length) ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Chưa có phát sinh thu/chi.</div>
                  ) : (
                    <table style={historyTable}>
                      <thead>
                        <tr>
                          <th style={hThLeft}>Ngày</th>
                          <th style={hTh}>Loại</th>
                          <th style={hTh}>Ref</th>
                          <th style={hThRight}>Số tiền</th>
                          <th style={hThLeft}>Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nRow.paymentHistory!.map((h) => (
                          <tr key={h.paymentId + "_" + h.paymentDate + "_" + h.amount + "_" + h.allocationKind}>
                            <td style={hTdLeft}>{h.paymentDate}</td>
                            <td style={hTd}>{h.allocationKind}</td>
                            <td style={hTd}>{h.refNo || ""}</td>
                            <td style={hTdRight}>{fmtMoney(h.amount)}</td>
                            <td style={hTdLeft}>{h.note || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div style={modalFooter}>
              <button type="button" style={ghostBtn} onClick={closeCollectNormal} disabled={loadingPay}>
                Đóng
              </button>
              <button type="button" style={primaryBtn(loadingPay)} onClick={submitCollectNormal} disabled={loadingPay}>
                {loadingPay ? "Đang tạo phiếu..." : "Thu tiền"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .rowHover:hover { background: rgba(15, 23, 42, 0.04); }

        /* CurrencyInput styling để giống input inline */
        .ri-currency-wrap { width: 100%; }
        .ri-input {
          width: 100%;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          background: rgba(2, 6, 23, 0.02);
          outline: none;
          box-sizing: border-box;
        }
        .ri-input:disabled {
          cursor: not-allowed;
          opacity: 0.75;
        }
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

/* ======================= Styles ======================= */

const page: React.CSSProperties = { padding: 18 };

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: 16,
  flexWrap: "wrap",
};

const title: React.CSSProperties = { fontSize: 20, fontWeight: 900, letterSpacing: 0.2 };

const subtitle: React.CSSProperties = { marginTop: 4, fontSize: 12.5, opacity: 0.75 };

const headerRight: React.CSSProperties = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" };

const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };

const fieldLabel: React.CSSProperties = { fontSize: 11, opacity: 0.7 };

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

const checkRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: 0.9 };

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

const card: React.CSSProperties = { borderRadius: 14, padding: 14 };

const cardLabel: React.CSSProperties = { fontSize: 12, opacity: 0.75, fontWeight: 800 };

const cardValue: React.CSSProperties = { marginTop: 8, fontSize: 22, fontWeight: 900 };

const cardHint: React.CSSProperties = { marginTop: 6, fontSize: 12, opacity: 0.65 };

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

const panelTitle: React.CSSProperties = { fontWeight: 900, fontSize: 14 };

const ghostBtn: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.25)",
  background: "transparent",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 12,
};

const filtersRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };

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

const stripItem: React.CSSProperties = { minWidth: 120 };

const stripLabel: React.CSSProperties = { fontSize: 11, opacity: 0.7, fontWeight: 800 };

const stripValue: React.CSSProperties = { marginTop: 4, fontSize: 13.5, fontWeight: 900 };

const dueText: React.CSSProperties = { color: "#dc2626" };

const tableWrap: React.CSSProperties = {
  marginTop: 10,
  maxHeight: "62vh",
  overflow: "auto",
  borderRadius: 14,
  border: "1px solid rgba(148, 163, 184, 0.18)",
};

const table: React.CSSProperties = { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 };

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

const trRow: React.CSSProperties = { cursor: "default" };

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

/* ===== Modal styles ===== */

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

const modalBody: React.CSSProperties = { padding: 14, overflow: "auto" };

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

const historyBox: React.CSSProperties = {
  marginTop: 6,
  padding: 10,
  borderRadius: 12,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(2, 6, 23, 0.02)",
  maxHeight: 220,
  overflow: "auto",
};

const historyTable: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };

const hThBase: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 8px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  background: "rgba(15, 23, 42, 0.04)",
  position: "sticky",
  top: 0,
};

const hThLeft: React.CSSProperties = { ...hThBase };
const hTh: React.CSSProperties = { ...hThBase };
const hThRight: React.CSSProperties = { ...hThBase, textAlign: "right" };

const hTdBase: React.CSSProperties = {
  padding: "8px 8px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.14)",
  verticalAlign: "top",
};

const hTdLeft: React.CSSProperties = { ...hTdBase };
const hTd: React.CSSProperties = { ...hTdBase };
const hTdRight: React.CSSProperties = { ...hTdBase, textAlign: "right", fontWeight: 900 };

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

const infoLabel: React.CSSProperties = { fontSize: 11, opacity: 0.7, fontWeight: 800 };

const infoValue: React.CSSProperties = { marginTop: 6, fontSize: 14, fontWeight: 900 };

const modalFormGrid: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
};

export default ReceivablesReportPage;
