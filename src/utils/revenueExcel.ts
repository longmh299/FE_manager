// src/utils/revenueExcel.ts
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

type StaffRow = {
  userId: string;
  name: string;
  revenue: number; // NET
  collectedNormal?: number; // NET
  collectedGross?: number; // GROSS
};

type RevenueResp = {
  kpis: {
    netRevenue: number;
    grossProfit: number;
    marginPct: number;
    orderCount: number;
    netVat?: number;
    netTotal?: number;
    netCollected?: number;
    netCogs?: number;
  };
  byProduct: Array<{
    itemId: string;
    name: string;
    qty: number;
    revenue: number;
    cogs: number;
    profit: number;
    marginPct: number;
  }>;
  byStaff?: {
    sale: StaffRow[];
    tech: StaffRow[];
  };
};

function n(x: any): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function isUnknownStaffRow(r: StaffRow) {
  const uid = String(r?.userId || "");
  const name = String(r?.name || "").trim().toLowerCase();
  if (!uid) return true;
  if (uid.startsWith("__NAME__:")) return true;
  if (name === "unknown") return true;
  return false;
}

export async function exportRevenueExcel(args: {
  data: RevenueResp;
  from: string;
  to: string;
  accountLabel?: string;
  filename?: string;
}) {
  const { data, from, to, accountLabel, filename } = args;

  const wb = new ExcelJS.Workbook();
  wb.creator = "WMS";
  wb.created = new Date();

  const moneyFmt = '#,##0" đ"';

  const applyHeader = (ws: ExcelJS.Worksheet, headerRowIndex: number) => {
    const row = ws.getRow(headerRowIndex);
    row.font = { bold: true };
    row.alignment = { vertical: "middle" as any, horizontal: "center" as any };
    row.height = 18;

    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  };

  /** Sheet: Tổng quan */
  const ws0 = wb.addWorksheet("Tong quan");
  ws0.columns = [
    { header: "Chi tieu", key: "k", width: 34 },
    { header: "Gia tri", key: "v", width: 24 },
  ];

  ws0.addRow(["Khoang ngay", `${from} → ${to}`]);
  if (accountLabel) ws0.addRow(["Tai khoan", accountLabel]);
  ws0.addRow([]);

  const k = data.kpis || ({} as any);
  const rowsKpi: Array<[string, number, string?]> = [
    ["Da thu (quy ve NET)", n(k.netCollected), moneyFmt],
    ["Doanh thu thuan (chua VAT)", n(k.netRevenue), moneyFmt],
    ["VAT", n(k.netVat), moneyFmt],
    ["Tong (gom VAT)", n(k.netTotal), moneyFmt],
    ["Gia von (COGS)", n(k.netCogs), moneyFmt],
    ["Loi nhuan gop", n(k.grossProfit), moneyFmt],
    ["Bien loi nhuan (%)", n(k.marginPct), "0.0"],
    ["So hoa don", n(k.orderCount), "0"],
  ];

  ws0.addRow(["KPI", ""]);
  ws0.getRow(ws0.lastRow!.number).font = { bold: true };
  ws0.addRow([]);

  for (const [label, val, fmt] of rowsKpi) {
    const r = ws0.addRow([label, val]);
    if (fmt) r.getCell(2).numFmt = fmt;
  }

  /** Sheet: Nhân viên */
  const buildStaffSheet = (title: string, rows: StaffRow[] = []) => {
    const ws = wb.addWorksheet(title);
    ws.columns = [
      { header: "Nhan vien", key: "name", width: 26 },
      { header: "UserId", key: "userId", width: 26 },
      { header: "Doanh so (NET)", key: "net", width: 18 },
      { header: "Da thu NORMAL (NET)", key: "normal", width: 18 },
      { header: "Da thu (GROSS)", key: "gross", width: 18 },
    ];

    ws.addRow(["Nhan vien", "UserId", "Doanh so (NET)", "Da thu NORMAL (NET)", "Da thu (GROSS)"]);
    applyHeader(ws, 1);

    const safe = (rows || []).filter((r) => !isUnknownStaffRow(r));

    for (const r of safe) {
      const rr = ws.addRow([r.name, r.userId, n(r.revenue), n(r.collectedNormal), n(r.collectedGross)]);
      rr.getCell(3).numFmt = moneyFmt;
      rr.getCell(4).numFmt = moneyFmt;
      rr.getCell(5).numFmt = moneyFmt;
    }

    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  buildStaffSheet("Nhan vien - Sale", data.byStaff?.sale || []);
  buildStaffSheet("Nhan vien - Ky thuat", data.byStaff?.tech || []);

  /** Sheet: Top sản phẩm */
  const wsP = wb.addWorksheet("Top san pham");
  wsP.columns = [
    { header: "San pham", key: "name", width: 32 },
    { header: "ItemId", key: "itemId", width: 26 },
    { header: "So luong", key: "qty", width: 12 },
    { header: "Gia ban", key: "unitSell", width: 16 }, // ✅ đổi tên theo yêu cầu
    { header: "Gia von TB", key: "unitCost", width: 16 },
    { header: "Doanh thu", key: "revenue", width: 16 },
    { header: "Gia von", key: "cogs", width: 16 },
    { header: "Loi nhuan gop", key: "profit", width: 16 },
    { header: "% LN", key: "margin", width: 10 },
  ];

  wsP.addRow(["San pham", "ItemId", "So luong", "Gia ban", "Gia von TB", "Doanh thu", "Gia von", "Loi nhuan gop", "% LN"]);
  applyHeader(wsP, 1);

  for (const r of (data.byProduct || []).slice(0, 50)) {
    const qty = n(r.qty);
    const revenue = n(r.revenue);
    const cogs = n(r.cogs);
    const unitSell = qty > 0 ? revenue / qty : 0;
    const unitCost = qty > 0 ? cogs / qty : 0;

    const rr = wsP.addRow([
      r.name,
      r.itemId,
      qty,
      unitSell,
      unitCost,
      revenue,
      cogs,
      n(r.profit),
      n(r.marginPct) / 100,
    ]);

    rr.getCell(4).numFmt = moneyFmt;
    rr.getCell(5).numFmt = moneyFmt;
    rr.getCell(6).numFmt = moneyFmt;
    rr.getCell(7).numFmt = moneyFmt;
    rr.getCell(8).numFmt = moneyFmt;
    rr.getCell(9).numFmt = "0.0%";
  }

  wsP.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, filename || `doanh-thu_${from}_to_${to}.xlsx`);
}
