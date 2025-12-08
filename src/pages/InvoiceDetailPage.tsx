import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";

type InvoiceType = "SALES" | "PURCHASE";
type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

type Partner = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  taxCode?: string;
  email?: string;
};

type Item = {
  id: string;
  sku?: string;
  name: string;
  unit?: string;
  price?: number;
};

type InvoiceLine = {
  id?: string;
  itemId?: string;
  itemName: string;
  unit?: string;
  qty: number;
  price: number;
};

type StaffUser = {
  id: string;
  name: string;
};

type Invoice = {
  id: string | number | null;
  code: string;
  date?: string;
  type: InvoiceType;
  partnerId?: string;
  partnerName: string;
  partnerAddress?: string;
  partnerPhone?: string;
  partnerTaxCode?: string;
  partnerEmail?: string;
  saleUserId?: string;
  techUserId?: string;
  lines: InvoiceLine[];

  subtotal?: number;
  tax?: number;
  taxPercent?: number;
  totalAmount: number;

  paymentStatus?: PaymentStatus;
  paidAmount?: number;

  posted?: boolean;
};

// unwrap { ok: true, data: ... }
function unwrap<T = any>(res: any): T {
  if (res && typeof res === "object" && "data" in res) {
    const body = (res as any).data;
    if (body && typeof body === "object" && "data" in body) {
      return body.data as T;
    }
    return body as T;
  }
  return res as T;
}

function normalizeDateForInput(raw?: string): string {
  if (!raw) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split("/");
    return `${y}-${m}-${d}`;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// -------- styles ----------
const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
  },
  header: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb" },
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 600 },

  body: {
    flex: 1,
    minHeight: 0,
    padding: "12px 16px",
    display: "flex",
    justifyContent: "center",
    overflowY: "auto",
  },
  content: {
    width: "100%",
    maxWidth: 900,
  },

  backBtn: {
    border: "none",
    background: "none",
    color: "#2563eb",
    cursor: "pointer",
    padding: 0,
    marginBottom: 12,
    fontSize: 14,
  },

  form: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    fontSize: 14,
  },

  sectionBox: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 12,
    background: "#ffffff",
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: 8,
    borderBottom: "1px solid #f3f4f6",
    paddingBottom: 4,
  },

  formRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 8,
  },
  rowInline: {
    display: "flex",
    gap: 12,
  },
  flex1: { flex: 1 },

  label: { fontWeight: 500, fontSize: 13 },
  input: {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
  },
  select: {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 14,
    background: "#fff",
    width: "100%",
    boxSizing: "border-box",
  },

  autoWrapper: { position: "relative" },
  suggestBox: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    maxHeight: 160,
    overflowY: "auto",
    zIndex: 30,
    marginTop: 2,
    boxShadow: "0 4px 10px rgba(0,0,0,0.04)",
  },
  suggestItem: { padding: "4px 8px", fontSize: 13, cursor: "pointer" },
  suggestItemMuted: { padding: "4px 8px", fontSize: 12, color: "#9ca3af" },

  // Dòng sản phẩm
  gridHeader: {
    display: "grid",
    gridTemplateColumns: "4fr 1fr 2fr 2fr 70px", // SP - SL - ĐG - TT - Xóa
    columnGap: 8,
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    padding: "4px 6px",
    background: "#f9fafb",
    borderRadius: 4,
    alignItems: "center",
  },
  gridRow: {
    display: "grid",
    gridTemplateColumns: "4fr 1fr 2fr 2fr 70px",
    columnGap: 8,
    alignItems: "center",
    marginBottom: 6,
    padding: "4px 6px",
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
  },
  smallInput: {
    width: "100%",
    padding: "5px 8px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 13,
    boxSizing: "border-box",
  },
  smallBtn: {
    padding: "2px 6px",
    borderRadius: 4,
    border: "none",
    background: "#ef4444",
    color: "#fff",
    cursor: "pointer",
    fontSize: 11,
    width: "100%",
    boxSizing: "border-box",
  },
  addLineBtn: {
    marginTop: 8,
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px dashed #2563eb",
    background: "#eff6ff",
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 12,
    width: "100%",
    textAlign: "center",
  },
  totalBox: {
    width: "100%",
    padding: "5px 8px",
    borderRadius: 4,
    border: "1px solid #e5e7eb",
    fontSize: 13,
    boxSizing: "border-box",
    background: "#f9fafb",
    textAlign: "right",
    whiteSpace: "nowrap",
  },

  // tổng tiền
  summaryRow: {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
    fontSize: 13,
  },
  summaryLabel: {
    width: 160,
    textAlign: "left",
    fontWeight: 500,
  },
  summaryValue: {
    width: 200,
    textAlign: "right",
    fontWeight: 600,
  },

  formActions: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 12,
    gap: 8,
  },
  primaryBtn: {
    padding: "6px 16px",
    borderRadius: 4,
    border: "none",
    background: "#16a34a",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  secondaryBtn: {
    padding: "6px 12px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  secondarySmallBtn: {
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },

  postStatusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 8,
  },
};

function calcTotal(lines: InvoiceLine[]) {
  return lines.reduce((s, l) => s + l.qty * l.price, 0);
}

function recalcTotals(
  lines: InvoiceLine[],
  taxPercent?: number
): { subtotal: number; tax: number; totalAmount: number } {
  const subtotal = calcTotal(lines);
  let tax = 0;
  if (taxPercent && taxPercent > 0) {
    tax = Math.round((subtotal * taxPercent) / 100);
  }
  const totalAmount = subtotal + tax;
  return { subtotal, tax, totalAmount };
}

function createEmptyInvoice(): Invoice {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: null,
    code: "",
    date: today,
    type: "SALES",
    partnerName: "",
    lines: [],
    subtotal: 0,
    tax: 0,
    taxPercent: 0,
    totalAmount: 0,
    paymentStatus: "UNPAID",
    paidAmount: 0,
    posted: false,
  };
}

const InvoiceDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isCreate = !id || id === "new";

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [staffs, setStaffs] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showPartnerSuggest, setShowPartnerSuggest] = useState(false);
  const [openItemSuggestIndex, setOpenItemSuggestIndex] =
    useState<number | null>(null);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        await Promise.all([
          loadPartners(),
          loadItems(),
          loadStaffs(),
          loadInvoiceIfNeeded(),
        ]);
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadPartners() {
    try {
      const res = await api.get("/partners", {
        params: { q: "", page: 1, pageSize: 100 },
      });
      const data = unwrap<any[]>(res);
      const mapped: Partner[] = data.map((p: any) => ({
        id: String(p.id),
        name: p.name,
        address: p.address,
        phone: p.phone,
        taxCode: p.taxCode,
        email: p.email,
      }));
      setPartners(mapped);
    } catch (err) {
      console.error("loadPartners error", err);
    }
  }

  async function loadItems() {
    try {
      const res = await api.get("/items", {
        params: { q: "", page: 1, pageSize: 1000 },
      });
      const data = unwrap<any[]>(res);
      const mapped: Item[] = data.map((i: any) => ({
        id: String(i.id),
        sku: i.sku || i.code,
        name: i.name,
        unit: i.unit,
        price: Number(i.price ?? 0),
      }));
      setItems(mapped);
    } catch (err) {
      console.error("loadItems error", err);
    }
  }

  async function loadStaffs() {
    try {
      const res = await api.get("/users", {
        params: { page: 1, pageSize: 100 },
      });
      const body = (res as any).data || {};
      const itemsData = (body.items || []) as any[];

      const mapped: StaffUser[] = itemsData
        .filter((u) => u.role === "staff")
        .map((u) => ({
          id: String(u.id),
          name: u.username as string,
        }));

      setStaffs(mapped);
    } catch (err) {
      console.error("loadStaffs error", err);
    }
  }

  async function loadInvoiceIfNeeded() {
    if (isCreate) {
      setInvoice(createEmptyInvoice());
      return;
    }
    if (!id) return;

    try {
      const res = await api.get(`/invoices/${id}`);
      const x = unwrap<any>(res);

      const lines: InvoiceLine[] =
        x.lines?.map((l: any) => ({
          id: l.id,
          itemId: l.itemId,
          itemName: l.item?.name ?? l.itemName ?? "",
          unit: l.item?.unit ?? l.unit,
          qty: Number(l.qty ?? 0),
          price: Number(l.unitPrice ?? l.price ?? 0),
        })) ?? [];

      const subtotalFromApi =
        x.subtotal != null ? Number(x.subtotal) : calcTotal(lines);
      const taxFromApi = x.tax != null ? Number(x.tax) : 0;
      const totalFromApi =
        x.total != null ? Number(x.total) : subtotalFromApi + taxFromApi;

      let taxPercent = 0;
      if (subtotalFromApi > 0 && taxFromApi > 0) {
        taxPercent = +((taxFromApi * 100) / subtotalFromApi).toFixed(2);
      }

      const rawDate = x.date ?? x.issueDate ?? x.createdAt ?? "";
      const normalizedDate = normalizeDateForInput(rawDate);

      const inv: Invoice = {
        id: x.id,
        code: x.code ?? "",
        date: normalizedDate,
        type: (x.type === "PURCHASE" ? "PURCHASE" : "SALES") as InvoiceType,
        partnerId: x.partnerId,
        partnerName: x.partner?.name ?? x.partnerName ?? "",
        partnerAddress: x.partner?.address ?? x.partnerAddr,
        partnerPhone: x.partner?.phone ?? x.partnerPhone,
        partnerTaxCode: x.partner?.taxCode ?? x.partnerTax,
        partnerEmail: x.partner?.email ?? x.partnerEmail,
        saleUserId: x.saleUserId,
        techUserId: x.techUserId,
        lines,
        subtotal: subtotalFromApi,
        tax: taxFromApi,
        taxPercent,
        totalAmount: totalFromApi,
        paymentStatus: (x.paymentStatus as PaymentStatus) ?? "UNPAID",
        paidAmount: x.paidAmount != null ? Number(x.paidAmount) : 0,
        posted: Array.isArray(x.movements) && x.movements.length > 0,
      };

      setInvoice(inv);
    } catch (err) {
      console.error("loadInvoice error", err);
      alert("Không tải được hóa đơn.");
      navigate("/invoices");
    }
  }

  // ------- helpers để update invoice -------
  function updateInvoice(partial: Partial<Invoice>) {
    setInvoice((prev) => {
      if (!prev) return prev;
      const next: Invoice = { ...prev, ...partial };
      const { subtotal, tax, totalAmount } = recalcTotals(
        next.lines,
        next.taxPercent
      );
      next.subtotal = subtotal;
      next.tax = tax;
      next.totalAmount = totalAmount;
      return next;
    });
  }

  function handlePartnerNameChange(value: string) {
    updateInvoice({ partnerName: value, partnerId: undefined });
    setShowPartnerSuggest(true);
  }

  function selectPartner(p: Partner) {
    updateInvoice({
      partnerId: p.id,
      partnerName: p.name,
      partnerAddress: p.address,
      partnerPhone: p.phone,
      partnerTaxCode: p.taxCode,
      partnerEmail: p.email,
    });
    setShowPartnerSuggest(false);
  }

  function handleLineChange(
    index: number,
    field: keyof InvoiceLine,
    value: any
  ) {
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l, idx) =>
        idx === index ? { ...l, [field]: value } : l
      );
      const { subtotal, tax, totalAmount } = recalcTotals(
        lines,
        prev.taxPercent
      );
      return { ...prev, lines, subtotal, tax, totalAmount };
    });
  }

  function selectItemForLine(index: number, it: Item) {
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l, idx) =>
        idx === index
          ? {
              ...l,
              itemId: it.id,
              itemName: it.name,
              unit: it.unit,
              price: l.price || it.price || 0,
            }
          : l
      );
      const { subtotal, tax, totalAmount } = recalcTotals(
        lines,
        prev.taxPercent
      );
      return { ...prev, lines, subtotal, tax, totalAmount };
    });
    setOpenItemSuggestIndex(null);
  }

  function addLine() {
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = [
        ...prev.lines,
        { itemName: "", qty: 1, price: 0, unit: "" } as InvoiceLine,
      ];
      const { subtotal, tax, totalAmount } = recalcTotals(
        lines,
        prev.taxPercent
      );
      return { ...prev, lines, subtotal, tax, totalAmount };
    });
  }

  function removeLine(index: number) {
    setInvoice((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.filter((_, idx) => idx !== index);
      const { subtotal, tax, totalAmount } = recalcTotals(
        lines,
        prev.taxPercent
      );
      return { ...prev, lines, subtotal, tax, totalAmount };
    });
  }

  // -------- save customer to partners --------
  async function handleSavePartner() {
    if (!invoice) return;

    if (invoice.partnerId) {
      alert("Khách hàng này đã có trong danh sách đối tác.");
      return;
    }
    if (!invoice.partnerName.trim()) {
      alert("Vui lòng nhập tên khách hàng trước.");
      return;
    }

    try {
      const payload = {
        name: invoice.partnerName,
        address: invoice.partnerAddress,
        phone: invoice.partnerPhone,
        taxCode: invoice.partnerTaxCode,
        email: invoice.partnerEmail,
      };

      const res = await api.post("/partners", payload);
      const body = (res as any).data || {};
      const partner = body.data ?? body;

      const p: Partner = {
        id: String(partner.id),
        name: partner.name,
        address: partner.address,
        phone: partner.phone,
        taxCode: partner.taxCode,
        email: partner.email,
      };

      setPartners((prev) => [...prev, p]);
      updateInvoice({ partnerId: p.id });
      alert("Đã lưu khách hàng vào danh sách đối tác.");
    } catch (err) {
      console.error("save partner error", err);
      alert("Lưu khách hàng thất bại, kiểm tra log console.");
    }
  }

  // -------- post / unpost tồn --------
  async function handlePostStock() {
    if (!invoice) return;
    if (!invoice.id) {
      alert("Cần lưu hóa đơn trước khi post tồn.");
      return;
    }
    if (invoice.posted) {
      alert("Hóa đơn này đã post tồn rồi.");
      return;
    }

    if (
      !window.confirm(
        "Post tồn cho hóa đơn này? Sau khi post, số lượng tồn sẽ được cập nhật."
      )
    ) {
      return;
    }

    try {
      await api.post(`/invoices/${invoice.id}/post`);
      alert("Đã post tồn cho hóa đơn.");
      navigate("/invoices");
    } catch (err: any) {
      console.error("post stock error", err);
      const msg =
        err?.response?.data?.message ||
        "Post tồn thất bại, kiểm tra log console.";
      alert(msg);
    }
  }

  async function handleUnpostStock() {
    if (!invoice) return;
    if (!invoice.id) {
      alert("Cần lưu hóa đơn trước khi hủy post tồn.");
      return;
    }
    if (!invoice.posted) {
      alert("Hóa đơn này chưa post tồn.");
      return;
    }

    if (
      !window.confirm(
        "Hủy post tồn cho hóa đơn này? Tồn kho sẽ được trả lại như trước khi post."
      )
    ) {
      return;
    }

    try {
      await api.post(`/invoices/${invoice.id}/unpost`);
      alert("Đã hủy post tồn cho hóa đơn.");
      navigate("/invoices");
    } catch (err: any) {
      console.error("unpost stock error", err);
      const msg =
        err?.response?.data?.message ||
        "Hủy post tồn thất bại, kiểm tra log console.";
      alert(msg);
    }
  }

  // -------- save invoice --------
  async function handleSave() {
    if (!invoice) return;

    if (!invoice.code.trim()) {
      alert("Mã hóa đơn là bắt buộc.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        code: invoice.code,
        issueDate: invoice.date,
        type: invoice.type,
        partnerId: invoice.partnerId,
        partnerName: invoice.partnerName,
        partnerAddress: invoice.partnerAddress,
        partnerPhone: invoice.partnerPhone,
        partnerTax: invoice.partnerTaxCode,
        partnerAddr: invoice.partnerAddress,
        saleUserId: invoice.saleUserId,
        techUserId: invoice.techUserId,
        taxPercent: invoice.taxPercent ?? 0,
        paymentStatus: invoice.paymentStatus ?? "UNPAID",
        paidAmount: invoice.paidAmount ?? 0,
        lines: invoice.lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          qty: l.qty,
          price: l.price,
          unitPrice: l.price,
          itemName: l.itemName,
        })),
      };

      if (!invoice.id) {
        await api.post("/invoices", payload);
      } else {
        await api.put(`/invoices/${invoice.id}`, payload);
      }

      alert("Đã lưu hóa đơn.");
      navigate("/invoices");
    } catch (err: any) {
      console.error("Save invoice error", err);

      const message =
        err?.response?.data?.message ??
        (typeof err?.message === "string"
          ? err.message
          : "Lưu hoá đơn thất bại, vui lòng thử lại.");

      alert(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !invoice) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.headerTitle}>Hóa đơn</h1>
        </div>
        <div style={styles.body}>
          <div style={styles.content}>Đang tải...</div>
        </div>
      </div>
    );
  }

  const partnerSuggestions =
    invoice && invoice.partnerName
      ? partners
          .filter((p) =>
            p.name.toLowerCase().includes(invoice.partnerName.toLowerCase())
          )
          .slice(0, 20)
      : [];

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>
          {isCreate ? "Tạo hóa đơn mới" : "Sửa hóa đơn"}
        </h1>
      </div>

      <div style={styles.body}>
        <div style={styles.content}>
          <button
            type="button"
            style={styles.backBtn}
            onClick={() => navigate("/invoices")}
          >
            ← Quay lại danh sách hóa đơn
          </button>

          <form
            style={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            {/* Thông tin đơn hàng */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>Thông tin đơn hàng</div>

              <div style={styles.formRow}>
                <label style={styles.label}>Mã hóa đơn *</label>
                <input
                  style={styles.input}
                  value={invoice.code}
                  onChange={(e) =>
                    updateInvoice({ code: e.target.value.toUpperCase() })
                  }
                  placeholder="VD: HD0001"
                />
              </div>

              <div style={{ ...styles.formRow, ...styles.rowInline }}>
                <div style={styles.flex1}>
                  <label style={styles.label}>Ngày hóa đơn</label>
                  <input
                    style={styles.input}
                    type="date"
                    value={invoice.date || ""}
                    onChange={(e) =>
                      updateInvoice({ date: e.target.value || undefined })
                    }
                  />
                </div>
                <div style={styles.flex1}>
                  <label style={styles.label}>Loại hóa đơn</label>
                  <select
                    style={styles.select}
                    value={invoice.type}
                    onChange={(e) =>
                      updateInvoice({
                        type: e.target.value as InvoiceType,
                      })
                    }
                  >
                    <option value="SALES">Bán hàng</option>
                    <option value="PURCHASE">Nhập hàng</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Khách hàng */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>Khách hàng</div>

              <div
                style={{ ...styles.formRow, ...styles.autoWrapper }}
                onBlur={() => {
                  setTimeout(() => setShowPartnerSuggest(false), 150);
                }}
              >
                <label style={styles.label}>Tên khách hàng (gõ để tìm)</label>
                <input
                  style={styles.input}
                  value={invoice.partnerName}
                  onChange={(e) => handlePartnerNameChange(e.target.value)}
                  onFocus={() => setShowPartnerSuggest(true)}
                  placeholder="Nhập tên khách hàng..."
                />
                {showPartnerSuggest && partnerSuggestions.length > 0 && (
                  <div style={styles.suggestBox}>
                    {partnerSuggestions.map((p) => (
                      <div
                        key={p.id}
                        style={styles.suggestItem}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectPartner(p);
                        }}
                      >
                        {p.name}
                        {p.taxCode && (
                          <span style={{ color: "#9ca3af", marginLeft: 4 }}>
                            ({p.taxCode})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {showPartnerSuggest && partnerSuggestions.length === 0 && (
                  <div style={styles.suggestBox}>
                    <div style={styles.suggestItemMuted}>
                      Không tìm thấy khách hàng phù hợp
                    </div>
                  </div>
                )}
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Địa chỉ</label>
                <input
                  style={styles.input}
                  value={invoice.partnerAddress || ""}
                  onChange={(e) =>
                    updateInvoice({ partnerAddress: e.target.value })
                  }
                />
              </div>

              <div style={{ ...styles.formRow, ...styles.rowInline }}>
                <div style={styles.flex1}>
                  <label style={styles.label}>Số điện thoại</label>
                  <input
                    style={styles.input}
                    value={invoice.partnerPhone || ""}
                    onChange={(e) =>
                      updateInvoice({ partnerPhone: e.target.value })
                    }
                  />
                </div>
                <div style={styles.flex1}>
                  <label style={styles.label}>Mã số thuế</label>
                  <input
                    style={styles.input}
                    value={invoice.partnerTaxCode || ""}
                    onChange={(e) =>
                      updateInvoice({ partnerTaxCode: e.target.value })
                    }
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <label style={styles.label}>Email</label>
                <input
                  style={styles.input}
                  value={invoice.partnerEmail || ""}
                  onChange={(e) =>
                    updateInvoice({ partnerEmail: e.target.value })
                  }
                />
              </div>

              <div style={{ marginTop: 4 }}>
                <button
                  type="button"
                  style={styles.secondarySmallBtn}
                  onClick={handleSavePartner}
                >
                  Lưu khách hàng vào danh sách đối tác
                </button>
              </div>
            </div>

            {/* Nhân viên phụ trách */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>Nhân viên phụ trách</div>

              <div style={{ ...styles.formRow, ...styles.rowInline }}>
                <div style={styles.flex1}>
                  <label style={styles.label}>NV Sale</label>
                  <select
                    style={styles.select}
                    value={invoice.saleUserId || ""}
                    onChange={(e) =>
                      updateInvoice({
                        saleUserId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">-- Chọn NV sale --</option>
                    {staffs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={styles.flex1}>
                  <label style={styles.label}>NV kỹ thuật</label>
                  <select
                    style={styles.select}
                    value={invoice.techUserId || ""}
                    onChange={(e) =>
                      updateInvoice({
                        techUserId: e.target.value || undefined,
                      })
                    }
                  >
                    <option value="">-- Chọn NV kỹ thuật --</option>
                    {staffs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Dòng sản phẩm */}
            <div style={styles.sectionBox}>
              <div style={styles.sectionTitle}>Dòng sản phẩm</div>

              <div style={styles.gridHeader}>
                <div style={{ textAlign: "left" }}>Sản phẩm</div>
                <div style={{ textAlign: "center" }}>SL</div>
                <div style={{ textAlign: "right" }}>Đơn giá</div>
                <div style={{ textAlign: "right" }}>Thành tiền</div>
                <div />
              </div>

              {invoice.lines.length === 0 && (
                <div
                  style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}
                >
                  Chưa có dòng sản phẩm, bấm “Thêm dòng sản phẩm”.
                </div>
              )}

              {invoice.lines.map((line, idx) => {
                const q = line.itemName.toLowerCase();
                const itemSuggestions =
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
                  <div key={idx} style={styles.gridRow}>
                    {/* Sản phẩm */}
                    <div style={styles.autoWrapper}>
                      <input
                        style={styles.smallInput}
                        value={line.itemName}
                        onChange={(e) =>
                          handleLineChange(idx, "itemName", e.target.value)
                        }
                        onFocus={() => setOpenItemSuggestIndex(idx)}
                        placeholder="Gõ mã hoặc tên sản phẩm..."
                      />
                      {openItemSuggestIndex === idx &&
                        line.itemName.length > 0 && (
                          <div style={styles.suggestBox}>
                            {itemSuggestions.length > 0 ? (
                              itemSuggestions.map((it) => (
                                <div
                                  key={it.id}
                                  style={styles.suggestItem}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectItemForLine(idx, it);
                                  }}
                                >
                                  {it.name}
                                </div>
                              ))
                            ) : (
                              <div style={styles.suggestItemMuted}>
                                Không tìm thấy sản phẩm
                              </div>
                            )}
                          </div>
                        )}
                    </div>

                    {/* SL */}
                    <div>
                      <input
                        style={{
                          ...styles.smallInput,
                          textAlign: "center",
                        }}
                        type="number"
                        min={0}
                        value={line.qty}
                        onChange={(e) =>
                          handleLineChange(
                            idx,
                            "qty",
                            Number(e.target.value) || 0
                          )
                        }
                      />
                    </div>

                    {/* Đơn giá */}
                    <div>
                      <input
                        style={{
                          ...styles.smallInput,
                          textAlign: "right",
                        }}
                        type="number"
                        min={0}
                        value={line.price}
                        onChange={(e) =>
                          handleLineChange(
                            idx,
                            "price",
                            Number(e.target.value) || 0
                          )
                        }
                      />
                    </div>

                    {/* Thành tiền */}
                    <div>
                      <div style={styles.totalBox}>
                        {(line.qty * line.price).toLocaleString()}
                      </div>
                    </div>

                    {/* Xoá */}
                    <div style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        style={styles.smallBtn}
                        onClick={() => removeLine(idx)}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                style={styles.addLineBtn}
                onClick={addLine}
              >
                + Thêm dòng sản phẩm
              </button>

              {/* Tóm tắt tiền + thuế + thanh toán */}
              <div style={{ marginTop: 8 }}>
                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Tạm tính:</span>
                  <span style={styles.summaryValue}>
                    {(invoice.subtotal ?? 0).toLocaleString()} đ
                  </span>
                </div>

                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Thuế (%)</span>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <input
                      style={{
                        ...styles.smallInput,
                        width: 70,
                        textAlign: "right",
                      }}
                      type="number"
                      min={0}
                      value={invoice.taxPercent ?? 0}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = raw === "" ? 0 : Number(raw);
                        const val = isNaN(num) ? 0 : num;
                        setInvoice((prev) => {
                          if (!prev) return prev;
                          const { subtotal, tax, totalAmount } = recalcTotals(
                            prev.lines,
                            val
                          );
                          return {
                            ...prev,
                            taxPercent: val,
                            subtotal,
                            tax,
                            totalAmount,
                          };
                        });
                      }}
                    />
                    <span>%</span>
                    <span style={{ marginLeft: 12 }}>
                      = {(invoice.tax ?? 0).toLocaleString()} đ
                    </span>
                  </div>
                </div>

                {/* ĐÃ THU */}
                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Đã thu:</span>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <input
                      style={{
                        ...styles.smallInput,
                        width: 140,
                        textAlign: "right",
                      }}
                      type="number"
                      min={0}
                      value={invoice.paidAmount ?? 0}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = raw === "" ? 0 : Number(raw);
                        const paid = isNaN(num) ? 0 : num;
                        setInvoice((prev) => {
                          if (!prev) return prev;
                          const total = prev.totalAmount ?? 0;
                          let status: PaymentStatus = "UNPAID";
                          if (paid <= 0) status = "UNPAID";
                          else if (paid >= total) status = "PAID";
                          else status = "PARTIAL";
                          return {
                            ...prev,
                            paidAmount: paid,
                            paymentStatus: status,
                          };
                        });
                      }}
                    />
                    <span>đ</span>
                  </div>
                </div>

                {/* CÒN PHẢI THU */}
                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Còn phải thu:</span>
                  <span style={styles.summaryValue}>
                    {Math.max(
                      0,
                      (invoice.totalAmount ?? 0) -
                        (invoice.paidAmount ?? 0)
                    ).toLocaleString()}{" "}
                    đ
                  </span>
                </div>

                {/* TRẠNG THÁI THANH TOÁN */}
                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>
                    Trạng thái thanh toán:
                  </span>
                  <select
                    style={{ ...styles.select, maxWidth: 220 }}
                    value={invoice.paymentStatus || "UNPAID"}
                    onChange={(e) =>
                      updateInvoice({
                        paymentStatus: e.target.value as PaymentStatus,
                      })
                    }
                  >
                    <option value="UNPAID">Chưa thanh toán</option>
                    <option value="PARTIAL">Thanh toán một phần</option>
                    <option value="PAID">Đã thanh toán đủ</option>
                  </select>
                </div>

                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Tổng cộng:</span>
                  <span style={styles.summaryValue}>
                    {invoice.totalAmount.toLocaleString()} đ
                  </span>
                </div>
              </div>

              <div style={styles.postStatusRow}>
                <span
                  style={{
                    fontSize: 13,
                    color: invoice.posted ? "#16a34a" : "#f97316",
                  }}
                >
                  Trạng thái tồn:{" "}
                  {invoice.posted ? "Đã lưu tồn" : "Chưa lưu tồn"}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    style={styles.secondarySmallBtn}
                    disabled={!invoice.id || invoice.posted}
                    onClick={handlePostStock}
                  >
                    Lưu tồn
                  </button>
                  <button
                    type="button"
                    style={styles.secondarySmallBtn}
                    disabled={!invoice.id || !invoice.posted}
                    onClick={handleUnpostStock}
                  >
                    Hủy lưu tồn
                  </button>
                </div>
              </div>
            </div>

            {/* Nút hành động */}
            <div style={styles.formActions}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={() => navigate("/invoices")}
              >
                Hủy
              </button>
              <button
                type="submit"
                style={styles.primaryBtn}
                disabled={saving}
              >
                {saving ? "Đang lưu..." : "Lưu hóa đơn"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetailPage;
