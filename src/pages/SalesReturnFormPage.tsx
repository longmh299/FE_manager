// src/pages/SalesReturnFormPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";

type InvoiceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type UserRole = "staff" | "accountant" | "admin";

type ItemOption = { id: string; name: string; sku?: string };

type InvoiceOption = {
  id: string;
  code: string;
  issueDate?: string;
  partnerId?: string | null;
  partnerName?: string | null;
  saleUserId?: string | null;
  saleUserName?: string | null;
  techUserId?: string | null;
  techUserName?: string | null;
  total?: number;
};

type LineDraft = {
  itemId: string;
  itemName: string;
  qty: number;
  price: number;
};

type RefInvoiceDetail = {
  id: string;
  code?: string;
  issueDate?: string;
  partnerName?: string;

  // tổng của HĐ gốc (thường là GROSS)
  total?: number;

  // VAT data (nếu API có trả)
  taxPercent?: number;
  tax?: number;

  lines?: Array<{
    id?: string;
    itemId: string;
    itemName?: string | null;
    itemSku?: string | null;
    qty: any;
    price: any;
    amount?: any;
  }>;
};

function unwrap<T = any>(res: any): T {
  const body = res?.data;
  if (body && typeof body === "object" && "data" in body) return body.data as T;
  return body as T;
}

async function fetchMeRole(): Promise<UserRole | null> {
  try {
    const r = await api.get("/auth/me");
    return (r?.data?.role ?? r?.data?.user?.role ?? null) as any;
  } catch {
    return null;
  }
}

function formatMoney(n: number) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function formatDate(raw?: string) {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.split("-").reverse().join("/");
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function statusLabel(st: InvoiceStatus) {
  if (st === "DRAFT") return "NHÁP";
  if (st === "SUBMITTED") return "CHỜ DUYỆT";
  if (st === "APPROVED") return "ĐÃ DUYỆT";
  if (st === "REJECTED") return "TỪ CHỐI";
  return st;
}

function statusPillStyle(st: InvoiceStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.2,
    border: "1px solid",
  };
  if (st === "DRAFT") return { ...base, background: "#FFF7ED", borderColor: "#FDBA74", color: "#9A3412" };
  if (st === "SUBMITTED") return { ...base, background: "#EFF6FF", borderColor: "#93C5FD", color: "#1D4ED8" };
  if (st === "APPROVED") return { ...base, background: "#ECFDF5", borderColor: "#6EE7B7", color: "#065F46" };
  if (st === "REJECTED") return { ...base, background: "#FEF2F2", borderColor: "#FCA5A5", color: "#991B1B" };
  return { ...base, background: "#F9FAFB", borderColor: "#E5E7EB", color: "#111827" };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #D1D5DB",
    background: "#fff",
    color: "#111827",
    fontWeight: 800,
    cursor: "pointer",
  };
}

function dangerGhostBtnStyle(): React.CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #FCA5A5",
    background: "#fff",
    color: "#991B1B",
    fontWeight: 900,
    cursor: "pointer",
  };
}

const styles: Record<string, React.CSSProperties> = {
  autoWrapper: { position: "relative", zIndex: 20 },

  suggestBox: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    maxHeight: 240,
    overflowY: "auto",
    zIndex: 9999,
    marginTop: 6,
    boxShadow: "0 10px 18px rgba(0,0,0,0.08)",
  },
  suggestItem: { padding: "10px 12px", fontSize: 13, cursor: "pointer" },
  suggestItemMuted: { padding: "10px 12px", fontSize: 12, color: "#9ca3af" },
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  border: "1px solid #D1D5DB",
  borderRadius: 12,
  outline: "none",
};

const readOnlyInputStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#F9FAFB",
};

const returnNoticeStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #fde68a",
  background: "#fffbeb",
  color: "#92400e",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.4,
};

const refBoxStyle: React.CSSProperties = {
  marginTop: 12,
  border: "1px solid #E5E7EB",
  borderRadius: 14,
  background: "#fff",
  padding: 14,
};

function toNum(x: any) {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clampPct(x: any) {
  const n = toNum(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function roundMoney(n: number) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

export default function SalesReturnFormPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const isNew = !id || id === "new";

  const toast = useToast();

  const [role, setRole] = useState<UserRole | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<InvoiceStatus>("DRAFT");

  const [code, setCode] = useState("");
  const [issueDate, setIssueDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // ✅ Hướng A: SALES_RETURN bắt buộc chọn HĐ gốc (SALES APPROVED)
  const [refInvoiceId, setRefInvoiceId] = useState<string>("");
  const [refInvoiceLabel, setRefInvoiceLabel] = useState<string>("");
  const [refInvoiceQuery, setRefInvoiceQuery] = useState<string>("");
  const [refSuggestOpen, setRefSuggestOpen] = useState(false);
  const [refLoading, setRefLoading] = useState(false);
  const [refOptions, setRefOptions] = useState<InvoiceOption[]>([]);

  // ✅ chi tiết hóa đơn gốc (để “Trả full”)
  const [refDetail, setRefDetail] = useState<RefInvoiceDetail | null>(null);
  const [loadingRefDetail, setLoadingRefDetail] = useState(false);

  // ✅ VAT% của phiếu trả (mặc định lấy theo HĐ gốc)
  const [taxPercent, setTaxPercent] = useState<number>(0);

  // snapshot (để hiển thị)
  const [partnerId, setPartnerId] = useState<string>("");
  const [partnerName, setPartnerName] = useState<string>("");

  // staff (hiển thị thôi; approve BE sẽ copy từ invoice gốc)
  const [saleUserName, setSaleUserName] = useState<string>("");
  const [techUserName, setTechUserName] = useState<string>("");

  const [note, setNote] = useState("");

  const [items, setItems] = useState<ItemOption[]>([]);
  const [openItemSuggestIndex, setOpenItemSuggestIndex] = useState<number | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);

  // subtotal = tổng dòng hàng (chưa VAT)
  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.price || 0), 0),
    [lines]
  );

  const taxAmount = useMemo(() => {
    const pct = clampPct(taxPercent);
    return roundMoney((toNum(subtotal) * pct) / 100);
  }, [subtotal, taxPercent]);

  const grossTotal = useMemo(() => roundMoney(toNum(subtotal) + toNum(taxAmount)), [subtotal, taxAmount]);

  const refSubtotal = useMemo(() => {
    const ls = refDetail?.lines || [];
    return ls.reduce((s, l) => s + toNum(l.qty) * toNum(l.price), 0);
  }, [refDetail]);

  const refTax = useMemo(() => {
    // ưu tiên field tax nếu API có
    if (refDetail?.tax != null) return Math.max(0, toNum(refDetail.tax));
    // fallback: total - subtotal
    const t = refDetail?.total != null ? toNum(refDetail.total) : 0;
    const sub = toNum(refSubtotal);
    return Math.max(0, roundMoney(t - sub));
  }, [refDetail, refSubtotal]);

  const refGross = useMemo(() => {
    const t = refDetail?.total != null ? toNum(refDetail.total) : 0;
    if (t > 0) return t;
    return roundMoney(toNum(refSubtotal) + toNum(refTax));
  }, [refDetail, refSubtotal, refTax]);

  const refTaxPctDerived = useMemo(() => {
    if (refDetail?.taxPercent != null) return clampPct(refDetail.taxPercent);
    const sub = toNum(refSubtotal);
    const tx = toNum(refTax);
    if (sub <= 0 || tx <= 0) return 0;
    return clampPct(roundMoney((tx / sub) * 100));
  }, [refDetail, refSubtotal, refTax]);

  useEffect(() => {
    (async () => {
      setLoadingRole(true);
      const r = await fetchMeRole();
      setRole(r);
      setLoadingRole(false);

      if (!r) return nav("/login", { replace: true });
      if (r !== "admin") {
        toast.push({ type: "error", title: "Không có quyền", message: "Chức năng này chỉ dành cho ADMIN." });
        return nav("/", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load items ONCE
  useEffect(() => {
    if (role !== "admin") return;

    (async () => {
      try {
        const res = await api.get("/items", { params: { q: "", page: 1, pageSize: 1000 } });
        const data = unwrap<any[]>(res);
        const mapped: ItemOption[] = (Array.isArray(data) ? data : []).map((x: any) => ({
          id: String(x.id),
          name: String(x.name ?? x.sku ?? x.id),
          sku: x.sku ? String(x.sku) : undefined,
        }));
        setItems(mapped);
      } catch (e: any) {
        console.error("loadItems error", e);
        setItems([]);
        toast.push({
          type: "error",
          title: "Lỗi",
          message: e?.response?.data?.message || e?.message || "Không tải được danh sách sản phẩm (/items).",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // ✅ Search invoice gốc (SALES đã duyệt) (debounced)
  useEffect(() => {
    if (role !== "admin") return;
    if (!refSuggestOpen) return;

    const q = (refInvoiceQuery || "").trim();
    if (!q) {
      setRefOptions([]);
      return;
    }

    let alive = true;
    const t = setTimeout(async () => {
      setRefLoading(true);
      try {
        const res = await api.get("/invoices", {
          params: {
            q,
            page: 1,
            pageSize: 30,
            type: "SALES",
            status: "APPROVED",
          },
        });

        const body = (res as any)?.data;
        const raw = body?.data?.items ?? body?.items ?? body?.data ?? body;
        const rows = Array.isArray(raw) ? raw : [];

        const mapped: InvoiceOption[] = rows
          .map((x: any) => ({
            id: String(x.id),
            code: String(x.code ?? x.id),
            issueDate: x.issueDate ? String(x.issueDate) : undefined,
            partnerId: x.partnerId ? String(x.partnerId) : null,
            partnerName: x.partnerName ? String(x.partnerName) : null,
            saleUserId: x.saleUserId ? String(x.saleUserId) : null,
            saleUserName: x.saleUserName ? String(x.saleUserName) : null,
            techUserId: x.techUserId ? String(x.techUserId) : null,
            techUserName: x.techUserName ? String(x.techUserName) : null,
            total: x.total != null ? Number(x.total) : undefined,
          }))
          .filter((x: InvoiceOption) => x.id && x.code);

        if (alive) setRefOptions(mapped);
      } catch (e) {
        console.error("searchRefInvoices error", e);
        if (alive) setRefOptions([]);
      } finally {
        if (alive) setRefLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [refInvoiceQuery, refSuggestOpen, role]);

  async function loadRefInvoiceDetail(invoiceId: string) {
    if (!invoiceId) {
      setRefDetail(null);
      return;
    }
    setLoadingRefDetail(true);
    try {
      const r = await api.get(`/invoices/${invoiceId}`);
      const inv = r.data?.data ?? r.data;

      const detail: RefInvoiceDetail = {
        id: String(inv?.id ?? invoiceId),
        code: inv?.code ? String(inv.code) : undefined,
        issueDate: inv?.issueDate ? String(inv.issueDate) : undefined,
        partnerName: inv?.partnerName ? String(inv.partnerName) : undefined,
        total: inv?.total != null ? Number(inv.total) : undefined,

        // VAT fields (nếu BE trả)
        taxPercent: inv?.taxPercent != null ? Number(inv.taxPercent) : undefined,
        tax: inv?.tax != null ? Number(inv.tax) : undefined,

        lines: Array.isArray(inv?.lines)
          ? inv.lines.map((l: any) => ({
              id: l.id ? String(l.id) : undefined,
              itemId: String(l.itemId ?? ""),
              itemName: l.itemName != null ? String(l.itemName) : null,
              itemSku: l.itemSku != null ? String(l.itemSku) : null,
              qty: l.qty,
              price: l.price,
              amount: l.amount,
            }))
          : [],
      };

      setRefDetail(detail);

      // ✅ auto set VAT% theo hóa đơn gốc (nếu đang tạo phiếu mới hoặc đang chưa set)
      const pctFromRef =
        detail.taxPercent != null
          ? clampPct(detail.taxPercent)
          : (() => {
              const sub = (detail.lines || []).reduce((s, l) => s + toNum(l.qty) * toNum(l.price), 0);
              const tx =
                detail.tax != null
                  ? Math.max(0, toNum(detail.tax))
                  : Math.max(0, roundMoney(toNum(detail.total) - toNum(sub)));
              if (sub <= 0 || tx <= 0) return 0;
              return clampPct(roundMoney((tx / sub) * 100));
            })();

      // chỉ tự động set nếu đang NEW hoặc taxPercent đang =0 (tránh overwrite khi user đang chỉnh)
      setTaxPercent((cur) => {
        const curN = clampPct(cur);
        if (isNew || curN <= 0.0001) return pctFromRef;
        return curN;
      });
    } catch (e: any) {
      console.error("loadRefInvoiceDetail error", e);
      setRefDetail(null);
      toast.push({
        type: "error",
        title: "Lỗi",
        message: e?.response?.data?.message || e?.message || "Không tải được chi tiết hóa đơn gốc (/invoices/:id).",
      });
    } finally {
      setLoadingRefDetail(false);
    }
  }

  function clearRefInvoice() {
    setRefInvoiceId("");
    setRefInvoiceLabel("");
    setRefInvoiceQuery("");
    setRefOptions([]);

    setPartnerId("");
    setPartnerName("");
    setSaleUserName("");
    setTechUserName("");

    setRefDetail(null);

    // reset VAT% về 0 khi đổi HĐ gốc
    setTaxPercent(0);
  }

  async function selectRefInvoice(opt: InvoiceOption) {
    setRefInvoiceId(opt.id);

    const label = `${opt.code}${opt.partnerName ? ` - ${opt.partnerName}` : ""}`;
    setRefInvoiceLabel(label);
    setRefInvoiceQuery(label);
    setRefSuggestOpen(false);

    setPartnerId(String(opt.partnerId || ""));
    setPartnerName(String(opt.partnerName || ""));

    setSaleUserName(String(opt.saleUserName || ""));
    setTechUserName(String(opt.techUserName || ""));

    await loadRefInvoiceDetail(opt.id);
  }

  // ✅ “Trả full”: copy toàn bộ lines từ hóa đơn gốc
  function applyReturnFullFromRef() {
    if (!refInvoiceId || !refDetail) {
      toast.push({
        type: "warning",
        title: "Chưa chọn hóa đơn gốc",
        message: "Hãy chọn Hóa đơn gốc (SALES đã duyệt) trước khi bấm “Trả full”.",
      });
      return;
    }

    const refLines = Array.isArray(refDetail.lines) ? refDetail.lines : [];
    if (refLines.length === 0) {
      toast.push({
        type: "warning",
        title: "Hóa đơn gốc không có hàng",
        message: "Hóa đơn gốc không có dòng hàng để trả.",
      });
      return;
    }

    const newLines: LineDraft[] = refLines
      .filter((l) => String(l.itemId || "").trim())
      .map((l) => {
        const displayName =
          l.itemSku && l.itemName ? `${l.itemSku} - ${l.itemName}` : l.itemName || l.itemSku || l.itemId;

        return {
          itemId: String(l.itemId),
          itemName: String(displayName || ""),
          qty: Math.max(0, toNum(l.qty)),
          price: Math.max(0, toNum(l.price)),
        };
      });

    setLines(newLines.length ? newLines : [{ itemId: "", itemName: "", qty: 1, price: 0 }]);

    // ✅ đảm bảo VAT% đang theo hóa đơn gốc
    if (refTaxPctDerived > 0.0001) {
      setTaxPercent((cur) => {
        const curN = clampPct(cur);
        if (curN <= 0.0001) return refTaxPctDerived;
        return curN;
      });
    }

    toast.push({
      type: "success",
      title: "Đã nạp hàng từ hóa đơn gốc",
      message: "Bạn có thể chỉnh lại số lượng/giá trước khi Lưu/Gửi duyệt.",
    });
  }

  // Load invoice if edit
  useEffect(() => {
    if (role !== "admin") return;

    if (isNew) {
      setLines([{ itemId: "", itemName: "", qty: 1, price: 0 }]);
      clearRefInvoice();
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const r = await api.get(`/invoices/${id}`);
        const inv = r.data?.data ?? r.data;
        if (!inv) return;

        if (inv.type !== "SALES_RETURN") {
          toast.push({ type: "error", title: "Sai loại phiếu", message: "Đây không phải phiếu Khách trả hàng." });
          nav("/sales-returns", { replace: true });
          return;
        }

        setStatus(inv.status as InvoiceStatus);
        setCode(String(inv.code ?? ""));
        setIssueDate(inv.issueDate ? String(inv.issueDate).slice(0, 10) : new Date().toISOString().slice(0, 10));

        const rid = String(inv.refInvoiceId ?? "");
        setRefInvoiceId(rid);

        const refCode = String(inv.refInvoice?.code ?? "");
        const refPartner = String(inv.refInvoice?.partnerName ?? inv.partnerName ?? "");
        const label = refCode ? `${refCode}${refPartner ? ` - ${refPartner}` : ""}` : rid;
        setRefInvoiceLabel(label);
        setRefInvoiceQuery(label);

        setPartnerId(String(inv.partnerId ?? ""));
        setPartnerName(String(inv.partnerName ?? ""));

        setSaleUserName(String(inv.saleUserName ?? inv.saleUser?.username ?? inv.saleUser?.name ?? ""));
        setTechUserName(String(inv.techUserName ?? inv.techUser?.username ?? inv.techUser?.name ?? ""));

        setNote(String(inv.note ?? ""));

        // ✅ load VAT% của phiếu trả (nếu có)
        setTaxPercent(inv.taxPercent != null ? clampPct(inv.taxPercent) : 0);

        const ls: LineDraft[] =
          (inv.lines ?? []).map((l: any) => ({
            itemId: String(l.itemId ?? ""),
            itemName: String(l.itemName ?? l.item?.name ?? ""),
            qty: Number(l.qty ?? 0),
            price: Number(l.price ?? 0),
          })) || [];
        setLines(ls.length ? ls : [{ itemId: "", itemName: "", qty: 1, price: 0 }]);

        // ✅ load ref detail để có nút “Trả full” và preview
        if (rid) {
          await loadRefInvoiceDetail(rid);
        } else {
          setRefDetail(null);
        }
      } catch (e: any) {
        toast.push({
          type: "error",
          title: "Lỗi",
          message: e?.response?.data?.message || e?.message || "Không tải được phiếu.",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [role, isNew, id, nav]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = status === "APPROVED" || status === "REJECTED";
  const editable = status === "DRAFT";

  function addLine() {
    setLines((cur) => [...cur, { itemId: "", itemName: "", qty: 1, price: 0 }]);
  }

  function removeLine(idx: number) {
    setLines((cur) => cur.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function selectItemForLine(idx: number, it: ItemOption) {
    updateLine(idx, { itemId: it.id, itemName: it.sku ? `${it.sku} - ${it.name}` : it.name });
    setOpenItemSuggestIndex(null);
  }

  async function save() {
    const validLines = lines
      .map((l) => ({
        itemId: String(l.itemId || "").trim(),
        itemName: String(l.itemName || "").trim(),
        qty: Number(l.qty || 0),
        price: Number(l.price || 0),
      }))
      .filter((l) => l.itemId && l.qty > 0);

    if (!refInvoiceId) {
      toast.push({ type: "warning", title: "Thiếu thông tin", message: "Vui lòng chọn Hóa đơn gốc (SALES đã duyệt)." });
      return;
    }

    if (!partnerId) {
      toast.push({ type: "warning", title: "Thiếu thông tin", message: "Thiếu khách hàng của hóa đơn gốc (partnerId)." });
      return;
    }

    if (validLines.length === 0) {
      toast.push({ type: "warning", title: "Thiếu dòng hàng", message: "Phải có ít nhất 1 dòng hàng." });
      return;
    }

    const pct = clampPct(taxPercent);
    const computedTax = roundMoney((toNum(subtotal) * pct) / 100);

    const body: any = {
      type: "SALES_RETURN",
      code: code.trim() || undefined,
      issueDate,

      refInvoiceId,

      partnerId,
      partnerName: partnerName.trim() || undefined,

      note: note || "",

      saleUserId: null,
      techUserId: null,

      lines: validLines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty,
        price: l.price,
        itemName: l.itemName,
      })),

      paymentStatus: "UNPAID",
      paidAmount: 0,

      // ✅ FIX: trả hàng phải mang theo VAT% và VAT amount
      taxPercent: pct,
      tax: computedTax,
    };

    setLoading(true);
    try {
      if (isNew) {
        const r = await api.post("/invoices", body);
        const inv = r.data?.data ?? r.data;
        toast.push({ type: "success", title: "Thành công", message: "Đã tạo phiếu." });
        nav(`/sales-returns/${inv.id}`, { replace: true });
      } else {
        await api.put(`/invoices/${id}`, body);
        toast.push({ type: "success", title: "Thành công", message: "Đã lưu phiếu." });
      }
    } catch (e: any) {
      toast.push({ type: "error", title: "Lỗi", message: e?.response?.data?.message || e?.message || "Không lưu được." });
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!id) return;
    setLoading(true);
    try {
      await api.post(`/invoices/${id}/submit`);
      toast.push({ type: "success", title: "Đã gửi duyệt", message: "Phiếu đã chuyển sang CHỜ DUYỆT." });
      nav("/sales-returns", { replace: true });
    } catch (e: any) {
      toast.push({ type: "error", title: "Lỗi", message: e?.response?.data?.message || e?.message || "Không gửi duyệt được." });
    } finally {
      setLoading(false);
    }
  }

  if (loadingRole) return <div style={{ padding: 16 }}>Đang kiểm tra đăng nhập…</div>;
  if (role !== "admin") return null;

  return (
    <div style={{ padding: 16 }}>
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>{isNew ? "Tạo phiếu Khách trả hàng" : `Phiếu trả hàng: ${code || id}`}</h2>
            {!isNew ? <span style={statusPillStyle(status)}>{statusLabel(status)}</span> : null}
          </div>

          <div style={{ color: "#6b7280" }}>{locked ? "Phiếu đã chốt, chỉ xem." : "Duyệt phiếu sẽ nhập kho."}</div>

          <div style={returnNoticeStyle}>
            ⚠️ <b>Phiếu trả hàng</b> chỉ ghi nhận <b>hàng khách trả</b> và <b>nhập kho khi DUYỆT</b>.<br />
            Việc <b>hoàn tiền</b> (nếu có) sẽ làm <b>riêng</b> tại màn <b>Quản lý hóa đơn bán</b> bằng phiếu chi (alloc NORMAL âm) để có lịch sử.
          </div>
        </div>

        <button style={ghostBtnStyle()} onClick={() => nav("/sales-returns")}>
          ← Danh sách
        </button>
      </div>

      {/* Info Card */}
      <div style={{ marginTop: 14, border: "1px solid #E5E7EB", borderRadius: 14, padding: 14, background: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Mã phiếu</div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!editable}
              style={inputStyle}
              placeholder="Để trống sẽ tự sinh"
            />
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Ngày</div>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              disabled={!editable}
              style={inputStyle}
            />
          </div>

          {/* ✅ Hóa đơn gốc */}
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Hóa đơn gốc (SALES đã duyệt) *</div>

              {editable ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button
                    type="button"
                    style={primaryBtnStyle()}
                    onClick={applyReturnFullFromRef}
                    disabled={loadingRefDetail || !refInvoiceId}
                    title={!refInvoiceId ? "Chọn hóa đơn gốc trước" : "Copy toàn bộ dòng hàng từ hóa đơn gốc"}
                  >
                    Trả full
                  </button>

                  <button
                    type="button"
                    style={dangerGhostBtnStyle()}
                    onClick={() => {
                      setLines([{ itemId: "", itemName: "", qty: 1, price: 0 }]);
                      toast.push({ type: "info", title: "Đã reset", message: "Đã reset danh sách dòng hàng." });
                    }}
                  >
                    Reset dòng
                  </button>
                </div>
              ) : null}
            </div>

            {editable ? (
              <div style={{ ...styles.autoWrapper, zIndex: 50 }} onBlur={() => setTimeout(() => setRefSuggestOpen(false), 120)}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={refInvoiceQuery}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRefInvoiceQuery(v);
                      setRefSuggestOpen(true);

                      if (!v.trim() || v.trim() !== refInvoiceLabel.trim()) {
                        setRefInvoiceId("");
                        setRefInvoiceLabel("");
                        setPartnerId("");
                        setPartnerName("");
                        setSaleUserName("");
                        setTechUserName("");
                        setRefDetail(null);
                        setTaxPercent(0);
                      }
                    }}
                    onFocus={() => setRefSuggestOpen(true)}
                    style={inputStyle}
                    placeholder="Gõ để tìm theo mã hóa đơn / khách hàng..."
                  />

                  {refInvoiceId ? (
                    <button
                      type="button"
                      style={{ ...ghostBtnStyle(), padding: "10px 12px", whiteSpace: "nowrap" }}
                      onClick={() => clearRefInvoice()}
                    >
                      Đổi
                    </button>
                  ) : null}
                </div>

                {refSuggestOpen && (refInvoiceQuery || "").trim().length > 0 ? (
                  <div style={styles.suggestBox}>
                    {refLoading ? (
                      <div style={styles.suggestItemMuted}>Đang tìm…</div>
                    ) : refOptions.length > 0 ? (
                      refOptions.map((it) => (
                        <div
                          key={it.id}
                          style={styles.suggestItem}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectRefInvoice(it);
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>
                            {it.code}{" "}
                            <span style={{ fontWeight: 700, color: "#6b7280" }}>{it.issueDate ? `• ${formatDate(it.issueDate)}` : ""}</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            {it.partnerName ? `KH: ${it.partnerName}` : ""}
                            {it.total != null ? ` • Tổng: ${formatMoney(it.total)}` : ""}
                          </div>
                          {(it.saleUserName || it.techUserName) && (
                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                              {it.saleUserName ? `Sale: ${it.saleUserName}` : ""}
                              {it.saleUserName && it.techUserName ? " • " : ""}
                              {it.techUserName ? `Tech: ${it.techUserName}` : ""}
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div style={styles.suggestItemMuted}>Không tìm thấy hóa đơn phù hợp</div>
                    )}
                  </div>
                ) : null}

                <div style={{ marginTop: 6, fontSize: 12, color: refInvoiceId ? "#16a34a" : "#991B1B", fontWeight: 800 }}>
                  {refInvoiceId ? "✓ Đã chọn hóa đơn gốc" : "Chưa chọn hóa đơn gốc (phải chọn từ danh sách)"}
                </div>
              </div>
            ) : (
              <input value={refInvoiceLabel || refInvoiceId || ""} readOnly style={readOnlyInputStyle} />
            )}

            {/* Preview hóa đơn gốc */}
            {refInvoiceId ? (
              <div style={refBoxStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>
                    Hóa đơn gốc: <span style={{ color: "#111827" }}>{refDetail?.code || refInvoiceLabel || refInvoiceId}</span>
                    {refDetail?.issueDate ? <span style={{ color: "#6b7280", fontWeight: 800 }}> • {formatDate(refDetail.issueDate)}</span> : null}
                  </div>

                  <div style={{ color: "#111827", fontWeight: 900 }}>
                    Tổng HĐ gốc: {formatMoney(refGross)}
                  </div>
                </div>

                {/* breakdown VAT */}
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div style={{ padding: 10, border: "1px solid #E5E7EB", borderRadius: 12, background: "#F9FAFB" }}>
                    <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>Tạm tính (HĐ gốc)</div>
                    <div style={{ fontWeight: 900 }}>{formatMoney(refSubtotal)}</div>
                  </div>
                  <div style={{ padding: 10, border: "1px solid #E5E7EB", borderRadius: 12, background: "#F9FAFB" }}>
                    <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>VAT (HĐ gốc)</div>
                    <div style={{ fontWeight: 900 }}>
                      {formatMoney(refTax)} {refTaxPctDerived > 0 ? <span style={{ color: "#6b7280", fontWeight: 800 }}>({refTaxPctDerived}%)</span> : null}
                    </div>
                  </div>
                  <div style={{ padding: 10, border: "1px solid #E5E7EB", borderRadius: 12, background: "#F9FAFB" }}>
                    <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>Tổng (HĐ gốc)</div>
                    <div style={{ fontWeight: 900 }}>{formatMoney(refGross)}</div>
                  </div>
                </div>

                <div style={{ marginTop: 8, color: "#6b7280", fontSize: 12, fontWeight: 800 }}>
                  {loadingRefDetail
                    ? "Đang tải chi tiết hóa đơn gốc…"
                    : "Dòng hàng dưới đây lấy từ hóa đơn gốc (dùng cho nút “Trả full”)."}
                </div>

                {!loadingRefDetail ? (
                  <div style={{ marginTop: 10, border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead style={{ background: "#F9FAFB" }}>
                        <tr>
                          <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid #E5E7EB" }}>Sản phẩm (HĐ gốc)</th>
                          <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #E5E7EB", width: 120 }}>SL</th>
                          <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #E5E7EB", width: 180 }}>Đơn giá</th>
                          <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid #E5E7EB", width: 180 }}>Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(refDetail?.lines || []).length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ padding: 12, color: "#6b7280" }}>
                              Không có dòng hàng.
                            </td>
                          </tr>
                        ) : (
                          (refDetail?.lines || []).map((l, i) => {
                            const name = l.itemSku && l.itemName ? `${l.itemSku} - ${l.itemName}` : l.itemName || l.itemSku || l.itemId;
                            const qty = toNum(l.qty);
                            const price = toNum(l.price);
                            const amt = qty * price;
                            return (
                              <tr key={`${l.itemId}-${i}`}>
                                <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", fontWeight: 800 }}>{name}</td>
                                <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", fontWeight: 900 }}>
                                  {formatMoney(qty)}
                                </td>
                                <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", fontWeight: 900 }}>
                                  {formatMoney(price)}
                                </td>
                                <td style={{ padding: 12, borderBottom: "1px solid #F1F5F9", textAlign: "right", fontWeight: 900 }}>
                                  {formatMoney(amt)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {/* <div style={{ marginTop: 8, fontSize: 12, color: "#92400e", fontWeight: 800 }}>
                  * Chưa hiển thị “đã trả trước đó / còn lại” vì backend listInvoices chưa lọc theo refInvoiceId. Khi bạn thêm filter đó, mình nối tiếp ngay.
                </div> */}
              </div>
            ) : null}
          </div>

          {/* ✅ VAT% cho phiếu trả */}
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>VAT (%)</div>
            {editable ? (
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={taxPercent}
                onChange={(e) => setTaxPercent(clampPct(e.target.value))}
                style={{ ...inputStyle, textAlign: "right" }}
                placeholder="0"
              />
            ) : (
              <input value={String(clampPct(taxPercent))} readOnly style={{ ...readOnlyInputStyle, textAlign: "right" }} />
            )}
            {/* <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
              * Mặc định lấy theo HĐ gốc. Trả full mà thiếu VAT sẽ lệch số ở danh sách.
            </div> */}
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Trạng thái</div>
            <input value={statusLabel(status)} readOnly style={readOnlyInputStyle} />
          </div>

          {/* ✅ Snapshot KH + NV (read-only) */}
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Khách hàng</div>
            <input value={partnerName || ""} readOnly style={readOnlyInputStyle} placeholder="Tự lấy theo hóa đơn gốc" />
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>NV Sale</div>
            <input value={saleUserName || ""} readOnly style={readOnlyInputStyle} placeholder="Tự lấy theo hóa đơn gốc" />
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>NV Kỹ thuật</div>
            <input value={techUserName || ""} readOnly style={readOnlyInputStyle} placeholder="Tự lấy theo hóa đơn gốc" />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Ghi chú</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!editable}
              style={{ ...inputStyle, minHeight: 90 }}
              placeholder="Lý do trả hàng..."
            />
          </div>
        </div>
      </div>

      {/* Lines header */}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Dòng hàng trả</h3>

        {editable ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={ghostBtnStyle()} onClick={addLine}>
              + Thêm dòng
            </button>
            <button style={primaryBtnStyle()} onClick={applyReturnFullFromRef} disabled={loadingRefDetail || !refInvoiceId}>
              Trả full (copy từ HĐ gốc)
            </button>
          </div>
        ) : null}
      </div>

      {/* Lines table */}
      <div style={{ marginTop: 10, border: "1px solid #E5E7EB", borderRadius: 14, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#F9FAFB" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 14, borderBottom: "1px solid #E5E7EB" }}>Sản phẩm</th>
              <th style={{ textAlign: "right", padding: 14, borderBottom: "1px solid #E5E7EB", width: 120 }}>SL</th>
              <th style={{ textAlign: "right", padding: 14, borderBottom: "1px solid #E5E7EB", width: 200 }}>Giá trả lại</th>
              <th style={{ textAlign: "right", padding: 14, borderBottom: "1px solid #E5E7EB", width: 200 }}>Thành tiền</th>
              {editable ? <th style={{ textAlign: "center", padding: 14, borderBottom: "1px solid #E5E7EB", width: 90 }}>Xoá</th> : null}
            </tr>
          </thead>

          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={editable ? 5 : 4} style={{ padding: 16, color: "#6b7280" }}>
                  Chưa có dòng nào.
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => {
                const amount = Number(l.qty || 0) * Number(l.price || 0);

                const q = (l.itemName || "").toLowerCase().trim();
                const suggestions =
                  q.length > 0
                    ? items
                        .filter((it) => {
                          const name = (it.name || "").toLowerCase();
                          const sku = (it.sku || "").toLowerCase();
                          return name.includes(q) || sku.includes(q);
                        })
                        .slice(0, 50)
                    : [];

                return (
                  <tr key={idx}>
                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9" }}>
                      {editable ? (
                        <div style={styles.autoWrapper} onBlur={() => setTimeout(() => setOpenItemSuggestIndex(null), 120)}>
                          <input
                            value={l.itemName}
                            onChange={(e) => updateLine(idx, { itemName: e.target.value, itemId: "" })}
                            onFocus={() => setOpenItemSuggestIndex(idx)}
                            style={inputStyle}
                            placeholder="Tìm theo SKU / tên..."
                          />

                          {openItemSuggestIndex === idx && q.length > 0 ? (
                            <div style={styles.suggestBox}>
                              {suggestions.length > 0 ? (
                                suggestions.map((it) => (
                                  <div
                                    key={it.id}
                                    style={styles.suggestItem}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      selectItemForLine(idx, it);
                                    }}
                                  >
                                    <div style={{ fontWeight: 800 }}>{it.name}</div>
                                    <div style={{ fontSize: 12, color: "#6b7280" }}>{it.sku ? `SKU: ${it.sku}` : `ID: ${it.id}`}</div>
                                  </div>
                                ))
                              ) : (
                                <div style={styles.suggestItemMuted}>Không tìm thấy sản phẩm</div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div style={{ fontWeight: 700 }}>{l.itemName || l.itemId}</div>
                      )}
                    </td>

                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", textAlign: "right" }}>
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={l.qty}
                          onChange={(e) => updateLine(idx, { qty: Number(e.target.value || 0) })}
                          style={{ ...inputStyle, textAlign: "right" }}
                        />
                      ) : (
                        <div style={{ fontWeight: 800 }}>{formatMoney(l.qty)}</div>
                      )}
                    </td>

                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", textAlign: "right" }}>
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={l.price}
                          onChange={(e) => updateLine(idx, { price: Number(e.target.value || 0) })}
                          style={{ ...inputStyle, textAlign: "right" }}
                        />
                      ) : (
                        <div style={{ fontWeight: 800 }}>{formatMoney(l.price)}</div>
                      )}
                    </td>

                    <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", textAlign: "right", fontWeight: 900 }}>
                      {formatMoney(amount)}
                    </td>

                    {editable ? (
                      <td style={{ padding: 14, borderBottom: "1px solid #F1F5F9", textAlign: "center" }}>
                        <button style={{ ...ghostBtnStyle(), padding: "8px 10px" }} onClick={() => removeLine(idx)}>
                          X
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

      {/* Footer */}
      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, lineHeight: 1.4 }}>
          <div>
            <b>Tạm tính:</b> {formatMoney(subtotal)}
          </div>
          <div>
            <b>VAT ({clampPct(taxPercent)}%):</b> {formatMoney(taxAmount)}
          </div>
          <div>
            <b>Tổng trả (Gross):</b> {formatMoney(grossTotal)}
          </div>
        </div>

        {editable ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={ghostBtnStyle()} onClick={save} disabled={loading}>
              Lưu
            </button>

            {!isNew ? (
              <button style={primaryBtnStyle()} onClick={submit} disabled={loading}>
                Gửi duyệt
              </button>
            ) : null}
          </div>
        ) : (
          <div style={{ color: "#6b7280", fontWeight: 700 }}>Chỉ xem</div>
        )}
      </div>

      {loading ? <div style={{ marginTop: 10, color: "#6b7280" }}>Đang xử lý…</div> : null}
    </div>
  );
}
