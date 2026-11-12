// src/pages/TechCommissionPage.tsx
// ✅ Báo cáo "Doanh số & hoa hồng nhân viên" (kế toán / quản trị), 2 tab:
//  - Sale: doanh số từng sale trong tháng, tính vào NGÀY KHÁCH TRẢ ĐỦ TIỀN (khớp trang Báo cáo doanh thu) — SaleView
//  - Kỹ thuật: tổng hợp theo tháng cho từng kỹ thuật để tính tiền (phần dưới)
//  - hoá đơn bán ĐÃ DUYỆT trong tháng (theo ngày duyệt) có tên ở ô NV kỹ thuật
//  - Thực nhận = 0,5% tiền hàng (chưa VAT, không gồm dịch vụ, đã trừ hàng khách trả tới hết tháng)
//  - Phụ cấp KT = ô "Phụ cấp kỹ thuật" trên hoá đơn; hoá đơn CÓ phụ cấp chỉ ăn phụ cấp, KHÔNG ăn %
//  - Tổng nhận = thực nhận + phụ cấp
//  - Bấm 1 kỹ thuật để xem từng hoá đơn; xuất Excel tổng hợp / chi tiết
import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { saveAs } from "file-saver";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import { PinActionDialog } from "../components/SecondPassword";
import { useAuth } from "../context/AuthContext";

type Inv = {
  invoiceId: string;
  invoiceCode: string;
  issueDate: string;
  approvedDate: string;
  customerName: string;
  saleUserName: string | null;
  goods: number;
  earnsPct?: boolean; // false = hoá đơn có phụ cấp -> không tính %
  serviceAmount: number;
  commission: number;
  laborFee: number;
  totalIncome: number;
};
type Sum = { goods: number; commission: number; laborFee: number; totalIncome: number; serviceAmount: number; laborCount: number; orderCount: number };
type Tech = { techKey: string; techName: string; summary: Sum; invoices: Inv[] };
type Closed = { closedBy: string | null; closedAt: string } | null;
type Report = { month: number; year: number; rate: number; summary: Sum; techs: Tech[]; closed?: Closed };

const money = (v: number) => `${Math.round(Number(v || 0)).toLocaleString("vi-VN")} đ`;
const nowVN = () => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  return { y, m };
};

type ViewProps = { month: number; year: number; push: ReturnType<typeof useToast>["push"] };

/* ===================== CHỐT THÁNG =====================
 * Chốt = lưu nguyên bảng số của tháng. Tháng đã chốt thì sửa hoá đơn cũ / đổi luật / đổi tỉ lệ không làm nhảy số nữa.
 * Kế toán + quản trị chốt được (tháng đã kết thúc); mở lại chỉ quản trị + mật khẩu cấp 2.
 */
const CloseBar: React.FC<{
  kind: "TECH" | "SALE";
  month: number;
  year: number;
  closed: Closed | undefined;
  loading: boolean;
  onChanged: () => void;
  push: ViewProps["push"];
}> = ({ kind, month, year, closed, loading, onChanged, push }) => {
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);
  const cur = nowVN();
  const ended = year < cur.y || (year === cur.y && month < cur.m);
  const who = kind === "TECH" ? "kỹ thuật" : "sale";

  if (loading) return null;

  const doClose = async () => {
    setBusy(true);
    try {
      await api.post("/reports/commission-close", { month, year, kind });
      push({ type: "success", title: "Đã chốt", message: `Số ${who} tháng ${month}/${year} đã được lưu lại.` });
      setConfirm(false);
      onChanged();
    } catch (e) {
      const x = e as { response?: { data?: { message?: string } } };
      push({ type: "error", title: "Chưa chốt được", message: x?.response?.data?.message || "Thử lại sau." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {closed ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span className="font-semibold">Đã chốt</span>
          <span>
            {closed.closedBy ? `bởi ${closed.closedBy} ` : ""}lúc{" "}
            {new Date(closed.closedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            . Số bên dưới là bản đã lưu, không đổi khi sửa hoá đơn hay đổi tỉ lệ.
          </span>
          {isAdmin && (
            <button type="button" onClick={() => setReopen(true)} className="ml-auto rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
              Mở lại
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Chưa chốt</span>
          <span>{ended ? "Số đang tính trực tiếp, còn thay đổi nếu sửa hoá đơn hoặc đổi tỉ lệ." : "Tháng chưa kết thúc, số còn thay đổi. Hết tháng mới chốt được."}</span>
          {ended &&
            (confirm ? (
              <span className="ml-auto flex items-center gap-2">
                <span className="text-xs">Chốt số {who} tháng {month}/{year}?</span>
                <button type="button" disabled={busy} onClick={doClose} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                  {busy ? "Đang chốt…" : "Chốt"}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="rounded-lg px-2 py-1.5 text-xs hover:bg-amber-100">
                  Huỷ
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
                Chốt tháng này
              </button>
            ))}
        </div>
      )}

      <PinActionDialog
        open={reopen}
        title={`Mở lại số ${who} tháng ${month}/${year}`}
        subtitle="Bản đã chốt sẽ bị xoá, số sẽ tính lại theo hoá đơn và tỉ lệ hiện tại."
        tone="danger"
        confirmLabel="Mở lại"
        onClose={() => setReopen(false)}
        onSubmit={async (pin) => {
          await api.delete("/reports/commission-close", { data: { month, year, kind, pin } });
          setReopen(false);
          push({ type: "success", title: "Đã mở lại", message: `Số ${who} tháng ${month}/${year} đang tính trực tiếp.` });
          onChanged();
        }}
      />
    </>
  );
};

const TechView: React.FC<ViewProps> = ({ month, year, push }) => {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string>("");
  const [exporting, setExporting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/reports/tech-commission", { params: { month, year } });
      setData(r.data?.data ?? null);
    } catch (e) {
      const x = e as { response?: { data?: { message?: string } } };
      push({ type: "error", title: "Lỗi", message: x?.response?.data?.message || "Không tải được báo cáo." });
      setData(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportXlsx = async (view: "summary" | "detail") => {
    setExporting(view);
    try {
      const r = await api.get("/reports/tech-commission/excel", { params: { month, year, view }, responseType: "blob" });
      const mm = String(month).padStart(2, "0");
      saveAs(new Blob([r.data]), `hoa-hong-ky-thuat-${year}-${mm}${view === "detail" ? "-chi-tiet" : ""}.xlsx`);
    } catch {
      push({ type: "error", title: "Lỗi", message: "Không xuất được file Excel." });
    } finally {
      setExporting("");
    }
  };

  const pct = `${((data?.rate ?? 0.005) * 100).toLocaleString("vi-VN")}%`;
  const s = data?.summary;

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <p className="mr-auto max-w-3xl text-sm text-slate-600">
          Hoá đơn bán đã duyệt trong tháng có tên ở ô NV kỹ thuật. Thực nhận = {pct} tiền hàng (chưa VAT, không gồm dịch vụ, đã trừ hàng
          khách trả tới hết tháng). Hoá đơn <b>có phụ cấp kỹ thuật</b> (sửa chữa, bảo trì) thì <b>chỉ ăn phụ cấp, không tính %</b>. Tổng
          nhận = thực nhận + phụ cấp.
        </p>
        <button
          type="button"
          disabled={!!exporting}
          onClick={() => exportXlsx("summary")}
          className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {exporting === "summary" ? "Đang xuất…" : "Excel tổng hợp"}
        </button>
        <button
          type="button"
          disabled={!!exporting}
          onClick={() => exportXlsx("detail")}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {exporting === "detail" ? "Đang xuất…" : "Excel chi tiết"}
        </button>
      </div>

      <CloseBar kind="TECH" month={month} year={year} closed={data?.closed} loading={loading} onChanged={load} push={push} />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { t: "Tiền hàng tính %", v: s?.goods ?? 0, h: `${s?.orderCount ?? 0} hoá đơn` },
          { t: `Thực nhận (${pct})`, v: s?.commission ?? 0 },
          { t: "Phụ cấp kỹ thuật", v: s?.laborFee ?? 0, h: `${s?.laborCount ?? 0} hoá đơn có phụ cấp` },
          { t: "Tổng phải trả kỹ thuật", v: s?.totalIncome ?? 0, strong: true },
        ].map((k) => (
          <div key={k.t} className={`rounded-xl border bg-white p-4 ${k.strong ? "border-emerald-300" : "border-slate-200"}`}>
            <div className="text-xs text-slate-500 sm:text-sm">{k.t}</div>
            <div className={`text-lg font-semibold sm:text-xl ${k.strong ? "text-emerald-700" : "text-slate-900"}`}>{money(k.v)}</div>
            {k.h && <div className="mt-1 text-xs text-slate-500">{k.h}</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Kỹ thuật</th>
              <th className="px-3 py-2 text-right">Số HĐ</th>
              <th className="px-3 py-2 text-right">Tiền hàng</th>
              <th className="px-3 py-2 text-right">Thực nhận</th>
              <th className="px-3 py-2 text-right">Phụ cấp KT</th>
              <th className="px-3 py-2 text-right">Tổng nhận</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  Đang tải...
                </td>
              </tr>
            )}
            {!loading && !data?.techs.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  Tháng này chưa có hoá đơn nào có NV kỹ thuật.
                </td>
              </tr>
            )}
            {!loading &&
              data?.techs.map((t) => {
                const isOpen = open === t.techKey;
                return (
                  <React.Fragment key={t.techKey}>
                    <tr
                      className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${isOpen ? "bg-sky-50/60" : ""}`}
                      onClick={() => setOpen(isOpen ? "" : t.techKey)}
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        <span className="mr-1 inline-block w-3 text-slate-400">{t.invoices.length ? (isOpen ? "▾" : "▸") : ""}</span>
                        {t.techName}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{t.summary.orderCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(t.summary.goods)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(t.summary.commission)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(t.summary.laborFee)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{money(t.summary.totalIncome)}</td>
                    </tr>
                    {isOpen && t.invoices.length > 0 && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={6} className="px-3 pb-3 pt-1">
                          <table className="w-full text-xs sm:text-sm">
                            <thead className="text-left text-slate-500">
                              <tr>
                                <th className="py-1.5 pr-2 font-medium">Số HĐ</th>
                                <th className="py-1.5 pr-2 font-medium">Ngày duyệt</th>
                                <th className="py-1.5 pr-2 font-medium">Khách hàng</th>
                                <th className="py-1.5 pr-2 font-medium">NV bán</th>
                                <th className="py-1.5 pr-2 text-right font-medium">Tiền hàng</th>
                                <th className="py-1.5 pr-2 text-right font-medium">Dịch vụ</th>
                                <th className="py-1.5 pr-2 text-right font-medium">Thực nhận</th>
                                <th className="py-1.5 pr-2 text-right font-medium">Phụ cấp</th>
                                <th className="py-1.5 text-right font-medium">Tổng</th>
                              </tr>
                            </thead>
                            <tbody>
                              {t.invoices.map((r) => (
                                <tr key={r.invoiceId} className="border-t border-slate-200/70">
                                  <td className="py-1.5 pr-2">
                                    <Link className="font-medium text-sky-700 hover:underline" to={`/invoices/${r.invoiceId}`}>
                                      {r.invoiceCode}
                                    </Link>
                                  </td>
                                  <td className="py-1.5 pr-2">{r.approvedDate}</td>
                                  <td className="py-1.5 pr-2">{r.customerName}</td>
                                  <td className="py-1.5 pr-2">{r.saleUserName || "—"}</td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums">
                                    {r.earnsPct === false ? (
                                      <span className="text-slate-400" title="Hoá đơn có phụ cấp kỹ thuật: chỉ ăn phụ cấp, không tính %">
                                        {money(r.goods)}
                                      </span>
                                    ) : (
                                      money(r.goods)
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{r.serviceAmount ? money(r.serviceAmount) : "—"}</td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums">{money(r.commission)}</td>
                                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.laborFee ? money(r.laborFee) : "—"}</td>
                                  <td className="py-1.5 text-right font-medium tabular-nums">{money(r.totalIncome)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            {!loading && !!data?.techs.length && s && (
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-2.5">Tổng</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{s.orderCount}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(s.goods)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(s.commission)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(s.laborFee)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{money(s.totalIncome)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Cột "Dịch vụ" chỉ để xem (công sửa máy… không tính %). Muốn tính lại một hoá đơn thì sửa ô NV kỹ thuật / phụ cấp trên hoá đơn đó.
      </p>
    </div>
  );
};

/* ===================== SALE ===================== */
type SaleInv = {
  invoiceId: string;
  invoiceCode: string;
  type: "SALES" | "SALES_RETURN";
  issueDate: string;
  dsDate: string;
  customerName: string;
  gross: number;
  ds: number;
  commission?: number;
};
type SaleSum = { ds: number; salesDs: number; returnDs: number; orderCount: number; returnCount: number; commission?: number };
type SaleGroup = { saleKey: string; saleName: string; summary: SaleSum; invoices: SaleInv[] };
type SaleReport = { month: number; year: number; rate?: number; summary: SaleSum; sales: SaleGroup[]; closed?: Closed };

const SaleView: React.FC<ViewProps> = ({ month, year, push }) => {
  const [data, setData] = useState<SaleReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState("");
  const [exporting, setExporting] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/reports/sale-ds", { params: { month, year } });
      setData(r.data?.data ?? null);
    } catch (e) {
      const x = e as { response?: { data?: { message?: string } } };
      push({ type: "error", title: "Lỗi", message: x?.response?.data?.message || "Không tải được doanh số sale." });
      setData(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportXlsx = async (view: "summary" | "detail") => {
    setExporting(view);
    try {
      const r = await api.get("/reports/sale-ds/excel", { params: { month, year, view }, responseType: "blob" });
      const mm = String(month).padStart(2, "0");
      saveAs(new Blob([r.data]), `doanh-so-sale-${year}-${mm}${view === "detail" ? "-chi-tiet" : ""}.xlsx`);
    } catch {
      push({ type: "error", title: "Lỗi", message: "Không xuất được file Excel." });
    } finally {
      setExporting("");
    }
  };

  const s = data?.summary;
  const neg = (v: number) => (v < 0 ? "text-rose-600" : "");
  // ✅ admin đặt tỉ lệ hoa hồng sale > 0 (Tài khoản → Tỉ lệ hoa hồng) thì hiện thêm cột hoa hồng
  const rate = Number(data?.rate || 0);
  const hasCom = rate > 0;
  const ratePct = `${(rate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 3 })}%`;
  const cols = hasCom ? 6 : 5;

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <p className="mr-auto max-w-3xl text-sm text-slate-600">
          Doanh số tính vào <b>ngày khách trả đủ tiền</b> (khớp trang Báo cáo doanh thu): tiền hàng chưa VAT, không gồm dịch vụ, ship, phụ
          cấp. Khách trả hàng thì trừ vào tháng của phiếu trả.
        </p>
        <button
          type="button"
          disabled={!!exporting}
          onClick={() => exportXlsx("summary")}
          className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {exporting === "summary" ? "Đang xuất…" : "Excel tổng hợp"}
        </button>
        <button
          type="button"
          disabled={!!exporting}
          onClick={() => exportXlsx("detail")}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {exporting === "detail" ? "Đang xuất…" : "Excel chi tiết"}
        </button>
      </div>

      <CloseBar kind="SALE" month={month} year={year} closed={data?.closed} loading={loading} onChanged={load} push={push} />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { t: "Doanh số bán", v: money(s?.salesDs ?? 0), h: `${s?.orderCount ?? 0} hoá đơn đủ tiền trong tháng` },
          { t: "Trừ hàng khách trả", v: money(s?.returnDs ?? 0), h: `${s?.returnCount ?? 0} phiếu trả` },
          { t: "Doanh số thuần", v: money(s?.ds ?? 0), strong: true },
          hasCom
            ? { t: `Hoa hồng sale (${ratePct})`, v: money(s?.commission ?? 0), h: `${data?.sales.length ?? 0} sale có doanh số` }
            : { t: "Số sale có doanh số", v: String(data?.sales.length ?? 0) },
        ].map((k) => (
          <div key={k.t} className={`rounded-xl border bg-white p-4 ${k.strong ? "border-emerald-300" : "border-slate-200"}`}>
            <div className="text-xs text-slate-500 sm:text-sm">{k.t}</div>
            <div className={`text-lg font-semibold sm:text-xl ${k.strong ? "text-emerald-700" : "text-slate-900"}`}>{k.v}</div>
            {k.h && <div className="mt-1 text-xs text-slate-500">{k.h}</div>}
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Sale</th>
              <th className="px-3 py-2 text-right">HĐ bán</th>
              <th className="px-3 py-2 text-right">Doanh số bán</th>
              <th className="px-3 py-2 text-right">Trừ hàng trả</th>
              <th className="px-3 py-2 text-right">Doanh số thuần</th>
              {hasCom && <th className="px-3 py-2 text-right">Hoa hồng ({ratePct})</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={cols} className="px-3 py-6 text-center text-slate-500">
                  Đang tải...
                </td>
              </tr>
            )}
            {!loading && !data?.sales.length && (
              <tr>
                <td colSpan={cols} className="px-3 py-6 text-center text-slate-500">
                  Tháng này chưa có hoá đơn nào đủ tiền.
                </td>
              </tr>
            )}
            {!loading &&
              data?.sales.map((g) => {
                const isOpen = open === g.saleKey;
                return (
                  <React.Fragment key={g.saleKey}>
                    <tr
                      className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${isOpen ? "bg-sky-50/60" : ""}`}
                      onClick={() => setOpen(isOpen ? "" : g.saleKey)}
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        <span className="mr-1 inline-block w-3 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                        {g.saleName}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{g.summary.orderCount}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(g.summary.salesDs)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{g.summary.returnDs ? money(g.summary.returnDs) : "—"}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${g.summary.ds < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                        {money(g.summary.ds)}
                      </td>
                      {hasCom && <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${neg(g.summary.commission ?? 0)}`}>{money(g.summary.commission ?? 0)}</td>}
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={cols} className="px-3 pb-3 pt-1">
                          <table className="w-full text-xs sm:text-sm">
                            <thead className="text-left text-slate-500">
                              <tr>
                                <th className="py-1.5 pr-2 font-medium">Số HĐ</th>
                                <th className="py-1.5 pr-2 font-medium">Ngày HĐ</th>
                                <th className="py-1.5 pr-2 font-medium">Ngày tính DS</th>
                                <th className="py-1.5 pr-2 font-medium">Khách hàng</th>
                                <th className="py-1.5 pr-2 text-right font-medium">Tổng HĐ (có VAT)</th>
                                <th className="py-1.5 text-right font-medium">Doanh số</th>
                                {hasCom && <th className="py-1.5 pl-2 text-right font-medium">Hoa hồng</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {g.invoices.map((r) => (
                                <tr key={`${r.type}-${r.invoiceId}`} className="border-t border-slate-200/70">
                                  <td className="py-1.5 pr-2">
                                    <Link
                                      className="font-medium text-sky-700 hover:underline"
                                      to={r.type === "SALES" ? `/invoices/${r.invoiceId}` : `/sales-returns/${r.invoiceId}`}
                                    >
                                      {r.invoiceCode}
                                    </Link>
                                    {r.type === "SALES_RETURN" && (
                                      <span className="ml-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">Khách trả</span>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-2">{r.issueDate}</td>
                                  <td className="py-1.5 pr-2">{r.dsDate}</td>
                                  <td className="py-1.5 pr-2">{r.customerName}</td>
                                  <td className={`py-1.5 pr-2 text-right tabular-nums ${neg(r.gross)}`}>{money(r.gross)}</td>
                                  <td className={`py-1.5 text-right font-medium tabular-nums ${neg(r.ds)}`}>{money(r.ds)}</td>
                                  {hasCom && <td className={`py-1.5 pl-2 text-right tabular-nums ${neg(r.commission ?? 0)}`}>{money(r.commission ?? 0)}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            {!loading && !!data?.sales.length && s && (
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-2.5">Tổng</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{s.orderCount}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(s.salesDs)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{s.returnDs ? money(s.returnDs) : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{money(s.ds)}</td>
                {hasCom && <td className="px-3 py-2.5 text-right tabular-nums">{money(s.commission ?? 0)}</td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ===================== TRANG ===================== */
type Tab = "sale" | "tech";

const TechCommissionPage: React.FC = () => {
  const { toasts, push, remove } = useToast();
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get("tab") === "tech" ? "tech" : "sale";
  const cur = nowVN();
  const [month, setMonth] = useState(cur.m);
  const [year, setYear] = useState(cur.y);
  const years = Array.from({ length: 5 }, (_, i) => cur.y - i);
  const sel = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="p-4">
      <ToastHost toasts={toasts} onClose={remove} />
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold text-slate-900">Doanh số &amp; hoa hồng nhân viên</h1>
        <select aria-label="Tháng" className={sel} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              Tháng {m}
            </option>
          ))}
        </select>
        <select aria-label="Năm" className={sel} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              Năm {y}
            </option>
          ))}
        </select>
      </div>

      <div role="tablist" className="mt-3 flex gap-1 border-b border-slate-200">
        {(
          [
            ["sale", "Sale"],
            ["tech", "Kỹ thuật"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setSp(k === "sale" ? {} : { tab: k }, { replace: true })}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === k ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sale" ? <SaleView month={month} year={year} push={push} /> : <TechView month={month} year={year} push={push} />}
    </div>
  );
};

export default TechCommissionPage;