// src/pages/InvoicesPage.tsx
import React, { useEffect, useState } from "react";
import api from "../api/client";

type InvoiceType = "SALES" | "PURCHASE";

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
  date?: string; // luôn lưu dạng yyyy-MM-dd cho input date
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

  // tiền
  subtotal?: number; // tạm tính (chỉ tiền hàng)
  tax?: number; // tiền thuế
  taxPercent?: number; // % thuế user nhập
  totalAmount: number; // tổng cộng = subtotal + tax

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

/** Chuẩn hoá ngày về dạng yyyy-MM-dd để dùng cho input type="date" */
function normalizeDateForInput(raw?: string): string {
  if (!raw) return "";

  // nếu backend đã trả sẵn yyyy-MM-dd thì dùng luôn
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // nếu dạng dd/MM/yyyy
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

/** Format ngày hiển thị trên list: dd/MM/yyyy */
function formatDateDisplay(raw?: string): string {
  if (!raw) return "";
  // nếu đang là yyyy-MM-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-");
    return `${d}/${m}/${y}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// -------- styles ----------
const styles: Record<string, React.CSSProperties> = {
  page: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  header: { padding: "12px 16px", borderBottom: "1px solid #e5e7eb" },
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 600 },
  body: { display: "flex", flex: 1, minHeight: 0 },

  left: {
    flex: 1,
    minWidth: 0,
    borderRight: "1px solid #e5e7eb",
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
  },
  toolbar: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 },
  searchInput: {
    flex: 1,
    padding: "6px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 4,
    fontSize: 14,
  },
  addBtn: {
    whiteSpace: "nowrap",
    padding: "6px 12px",
    borderRadius: 4,
    border: "none",
    background: "#2563eb",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
  },
  listWrapper: {
    flex: 1,
    minHeight: 0,
    marginTop: 4,
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  tableContainer: { flex: 1, overflowY: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  thead: { background: "#f3f4f6", position: "sticky", top: 0, zIndex: 1 },
  th: {
    padding: "6px 8px",
    borderBottom: "1px solid #e5e7eb",
    textAlign: "left",
    fontWeight: 600,
  },
  td: {
    padding: "6px 8px",
    borderBottom: "1px solid #e5e7eb",
    textAlign: "left",
    verticalAlign: "middle",
  },
  row: { cursor: "pointer" },
  rowSelected: { background: "#e0f2fe" },
  linkBtn: {
    padding: 0,
    marginRight: 6,
    border: "none",
    background: "none",
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 13,
  },
  linkBtnDanger: { color: "#dc2626" },

  statusBadge: {
    padding: "2px 8px",
    borderRadius: 9999,
    fontSize: 12,
    display: "inline-block",
  },

  right: {
    width: 440,
    maxWidth: 500,
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
  },
  rightTitle: { margin: "0 0 8px", fontSize: 16, fontWeight: 600 },
  rightEmpty: { fontSize: 14, color: "#6b7280" },

  form: { display: "flex", flexDirection: "column", gap: 10, fontSize: 14 },

  sectionBox: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 12,
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
  label: { fontWeight: 500, fontSize: 13 },
  input: {
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
  },
  rowInline: {
    display: "flex",
    gap: 12,
  },
  flex1: { flex: 1 },
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
  suggestItemMuted: { fontSize: 12, color: "#9ca3af", padding: "4px 8px" },

  gridHeader: {
    display: "grid",
    gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr auto",
    columnGap: 8,
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: 4,
  },
  gridRow: {
    display: "grid",
    gridTemplateColumns: "3fr 1fr 1fr 1fr 1fr auto",
    columnGap: 8,
    alignItems: "center",
    marginBottom: 4,
  },
  smallInput: {
    width: "100%",
    padding: "4px 6px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    fontSize: 13,
  },
  smallBtn: {
    padding: "4px 8px",
    borderRadius: 4,
    border: "none",
    background: "#ef4444",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },
  addLineBtn: {
    marginTop: 6,
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px dashed #2563eb",
    background: "#eff6ff",
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 12,
  },

  // tổng tiền
  totalText: { fontWeight: 600, textAlign: "right", marginTop: 4 },
  summaryRow: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    fontSize: 13,
  },
  summaryLabel: {
    minWidth: 100,
    textAlign: "right",
  },
  summaryValue: {
    minWidth: 120,
    textAlign: "right",
    fontWeight: 600,
  },

  formActions: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 8,
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
    marginTop: 4,
  },
  actionCell: {
    display: "flex",
    alignItems: "center",
    gap: 10, // dãn khoảng cách nút
    flexWrap: "wrap",
  },
};

const InvoicesPage: React.FC = () => {
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [staffs, setStaffs] = useState<StaffUser[]>([]);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showPartnerSuggest, setShowPartnerSuggest] = useState(false);
  const [openItemSuggestIndex, setOpenItemSuggestIndex] =
    useState<number | null>(null);

  // mode: view | edit | create
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
  const isViewMode = mode === "view";

  // -------- helpers tiền --------
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

  // -------- load data --------
  useEffect(() => {
    loadInvoices();
    loadPartners();
    loadItems();
    loadStaffs();
  }, []);

  async function loadInvoices() {
    try {
      setLoadingList(true);
      const res = await api.get("/invoices", {
        params: {
          q: "",
          page: 1,
          pageSize: 20,
          type: "",
          saleUserId: "",
          techUserId: "",
          from: "",
          to: "",
        },
      });
      const data = unwrap<any[]>(res);

      const mapped: Invoice[] = data.map((x: any) => {
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

        // lấy ngày từ BE rồi chuẩn hoá cho input date
        const rawDate = x.date ?? x.issueDate ?? x.createdAt ?? "";
        const normalizedDate = normalizeDateForInput(rawDate);

        return {
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
          // đã post tồn nếu có movement
          posted: Array.isArray(x.movements) && x.movements.length > 0,
        };
      });

      setInvoices(mapped);
      if (!selected) {
        setMode("view");
      }
    } catch (err) {
      console.error("loadInvoices error", err);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadPartners() {
    try {
      const res = await api.get("/partners", {
        params: { q: "", page: 1, pageSize: 50 },
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

  // ⚠️ FIX loadItems: luôn lấy sku từ sku/code/itemCode, tăng pageSize
  async function loadItems() {
    try {
      const res = await api.get("/items", {
        params: { q: "", page: 1, pageSize: 5000 },
      });
      const data = unwrap<any[]>(res);
      const mapped: Item[] = data.map((i: any) => {
        const sku =
          (i.sku ?? "").trim() ||
          (i.code ?? "").trim() ||
          (i.itemCode ?? "").trim() ||
          "";

        return {
          id: String(i.id),
          sku,
          name: i.name ?? sku,
          unit: i.unit ?? "",
          price: Number(i.sellPrice ?? i.price ?? 0),
        };
      });
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

  // -------- helpers --------

  function handleNewInvoice() {
    const today = new Date().toISOString().slice(0, 10); // yyyy-MM-dd
    const inv: Invoice = {
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
      posted: false,
    };
    setSelected(inv);
    setShowPartnerSuggest(false);
    setOpenItemSuggestIndex(null);
    setMode("create");
  }

  function handleSelectInvoice(
    inv: Invoice,
    nextMode: "view" | "edit" = "view"
  ) {
    const clone: Invoice = {
      ...inv,
      lines: inv.lines.map((l) => ({ ...l })),
    };
    setSelected(clone);
    setShowPartnerSuggest(false);
    setOpenItemSuggestIndex(null);
    setMode(nextMode);
  }

  function updateSelected(partial: Partial<Invoice>) {
    setSelected((prev) => {
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

  function selectPartner(p: Partner) {
    updateSelected({
      partnerId: p.id,
      partnerName: p.name,
      partnerAddress: p.address,
      partnerPhone: p.phone,
      partnerTaxCode: p.taxCode,
      partnerEmail: p.email,
    });
    setShowPartnerSuggest(false);
  }

  function handlePartnerNameChange(value: string) {
    updateSelected({ partnerName: value, partnerId: undefined });
    setShowPartnerSuggest(true);
  }

  function handleLineChange(
    index: number,
    field: keyof InvoiceLine,
    value: any
  ) {
    setSelected((prev) => {
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
    setSelected((prev) => {
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
    setSelected((prev) => {
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
    setSelected((prev) => {
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
    if (!selected) return;
    if (isViewMode) return;

    if (selected.partnerId) {
      alert("Khách hàng này đã có trong danh sách đối tác.");
      return;
    }
    if (!selected.partnerName.trim()) {
      alert("Vui lòng nhập tên khách hàng trước.");
      return;
    }

    try {
      const payload = {
        name: selected.partnerName,
        address: selected.partnerAddress,
        phone: selected.partnerPhone,
        taxCode: selected.partnerTaxCode,
        email: selected.partnerEmail,
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
      updateSelected({ partnerId: p.id });
      alert("Đã lưu khách hàng vào danh sách đối tác.");
    } catch (err) {
      console.error("save partner error", err);
      alert("Lưu khách hàng thất bại, kiểm tra log console.");
    }
  }

  // -------- post tồn --------
  async function handlePostStock() {
    if (!selected) return;
    if (!selected.id) {
      alert("Cần lưu hóa đơn trước khi post tồn.");
      return;
    }
    if (selected.posted) {
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
      await api.post(`/invoices/${selected.id}/post`);
      await loadInvoices();
      alert("Đã post tồn cho hóa đơn.");
      setSelected(null);
      setMode("view");
    } catch (err: any) {
      console.error("post stock error", err);
      const msg =
        err?.response?.data?.message ||
        "Post tồn thất bại, kiểm tra log console.";
      alert(msg);
    }
  }

  // -------- unpost tồn --------
  async function handleUnpostStock() {
    if (!selected) return;
    if (!selected.id) {
      alert("Cần lưu hóa đơn trước khi hủy post tồn.");
      return;
    }
    if (!selected.posted) {
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
      await api.post(`/invoices/${selected.id}/unpost`);
      await loadInvoices();
      alert("Đã hủy post tồn cho hóa đơn.");
      setSelected(null);
      setMode("view");
    } catch (err: any) {
      console.error("unpost stock error", err);
      const msg =
        err?.response?.data?.message ||
        "Hủy post tồn thất bại, kiểm tra log console.";
      alert(msg);
    }
  }

  // -------- save/delete --------
  async function handleSave() {
    if (!selected) return;
    if (isViewMode) return;

    if (!selected.code.trim()) {
      alert("Mã hóa đơn là bắt buộc.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        code: selected.code,
        issueDate: selected.date, // gửi yyyy-MM-dd
        type: selected.type,
        partnerId: selected.partnerId,
        partnerName: selected.partnerName,
        partnerAddress: selected.partnerAddress,
        partnerPhone: selected.partnerPhone,
        partnerTax: selected.partnerTaxCode,
        partnerAddr: selected.partnerAddress,
        saleUserId: selected.saleUserId,
        techUserId: selected.techUserId,
        taxPercent: selected.taxPercent ?? 0, // gửi % thuế lên BE
        lines: selected.lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          qty: l.qty,
          price: l.price,
          unitPrice: l.price,
          itemName: l.itemName,
        })),
      };

      if (!selected.id) {
        await api.post("/invoices", payload);
      } else {
        await api.put(`/invoices/${selected.id}`, payload);
      }

      await loadInvoices();
      setSelected(null);
      setMode("view");
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

  async function handleDelete(inv: Invoice) {
    if (!inv.id) return;
    if (!window.confirm("Bạn có chắc muốn xóa hóa đơn này?")) return;
    try {
      await api.delete(`/invoices/${inv.id}`);
      await loadInvoices();
      if (selected?.id === inv.id) {
        setSelected(null);
        setMode("view");
      }
    } catch (err) {
      console.error("delete invoice error", err);
      alert("Xóa hóa đơn thất bại, xem log console.");
    }
  }

  // -------- filter & suggest --------
  const filteredList = invoices.filter((i) => {
    const q = search.toLowerCase();
    return (
      i.code.toLowerCase().includes(q) ||
      i.partnerName.toLowerCase().includes(q)
    );
  });

  const partnerSuggestions =
    selected && selected.partnerName
      ? partners
          .filter((p) =>
            p.name.toLowerCase().includes(selected.partnerName.toLowerCase())
          )
          .slice(0, 20)
      : [];

  // -------- render --------
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.headerTitle}>Hóa đơn</h1>
      </div>

      <div style={styles.body}>
        {/* LEFT: list hóa đơn */}
        <div style={styles.left}>
          <div style={styles.toolbar}>
            <input
              style={styles.searchInput}
              placeholder="Tìm theo số HĐ / tên khách hàng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button style={styles.addBtn} type="button" onClick={handleNewInvoice}>
              + Thêm hóa đơn
            </button>
          </div>

          <div style={styles.listWrapper}>
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead style={styles.thead}>
                  <tr>
                    <th style={styles.th}>Số HĐ</th>
                    <th style={styles.th}>Ngày</th>
                    <th style={styles.th}>Khách hàng</th>
                    <th style={styles.th}>Tổng tiền</th>
                    <th style={styles.th}>Trạng thái</th>
                    <th style={styles.th}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingList && (
                    <tr>
                      <td style={styles.td} colSpan={6}>
                        Đang tải dữ liệu...
                      </td>
                    </tr>
                  )}
                  {!loadingList && filteredList.length === 0 && (
                    <tr>
                      <td style={styles.td} colSpan={6}>
                        Không tìm thấy hóa đơn
                      </td>
                    </tr>
                  )}
                  {!loadingList &&
                    filteredList.map((inv) => (
                      <tr
                        key={inv.id ?? Math.random()}
                        style={{
                          ...styles.row,
                          ...(selected && selected.id === inv.id
                            ? styles.rowSelected
                            : {}),
                        }}
                        onClick={() => handleSelectInvoice(inv, "view")}
                      >
                        <td style={styles.td}>{inv.code}</td>
                        <td style={styles.td}>{formatDateDisplay(inv.date)}</td>
                        <td style={styles.td}>{inv.partnerName}</td>
                        <td style={styles.td}>
                          {inv.totalAmount.toLocaleString()} đ
                        </td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.statusBadge,
                              backgroundColor: inv.posted ? "#dcfce7" : "#ffedd5",
                              color: inv.posted ? "#166534" : "#9a3412",
                              border: `1px solid ${
                                inv.posted ? "#bbf7d0" : "#fed7aa"
                              }`,
                            }}
                          >
                            {inv.posted ? "Đã lưu tồn" : "Nháp"}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.actionCell}>
                            <button
                              type="button"
                              style={styles.linkBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectInvoice(inv, "edit");
                              }}
                            >
                              Sửa
                            </button>
                            <button
                              type="button"
                              style={styles.linkBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(
                                  `/invoices/${inv.id}/print`,
                                  "_blank",
                                  "noopener,noreferrer"
                                );
                              }}
                            >
                              In
                            </button>
                            <button
                              type="button"
                              style={{ ...styles.linkBtn, ...styles.linkBtnDanger }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(inv);
                              }}
                            >
                              Xóa
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT: form hóa đơn */}
        <div style={styles.right}>
          <h2 style={styles.rightTitle}>
            Thông tin hóa đơn{" "}
            {mode === "create"
              ? "(tạo mới)"
              : mode === "edit"
              ? "(đang sửa)"
              : "(xem)"}
          </h2>

          {!selected && (
            <div style={styles.rightEmpty}>
              Chọn một hóa đơn bên trái để xem, hoặc bấm{" "}
              <b>“Thêm hóa đơn”</b> để tạo mới.
            </div>
          )}

          {selected && (
            <form
              style={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                if (!isViewMode) {
                  handleSave();
                }
              }}
            >
              {/* Thông tin đơn hàng */}
              <div style={styles.sectionBox}>
                <div style={styles.sectionTitle}>Thông tin đơn hàng</div>

                <div style={styles.formRow}>
                  <label style={styles.label}>Mã hóa đơn *</label>
                  <input
                    style={styles.input}
                    value={selected.code}
                    onChange={(e) =>
                      updateSelected({ code: e.target.value.toUpperCase() })
                    }
                    placeholder="VD: HD0001"
                    disabled={isViewMode}
                  />
                </div>

                <div style={{ ...styles.formRow, ...styles.rowInline }}>
                  <div style={styles.flex1}>
                    <label style={styles.label}>Ngày hóa đơn</label>
                    <input
                      style={styles.input}
                      type="date"
                      value={selected.date || ""}
                      onChange={(e) =>
                        updateSelected({ date: e.target.value })
                      }
                      disabled={isViewMode}
                    />
                  </div>
                  <div style={styles.flex1}>
                    <label style={styles.label}>Loại hóa đơn</label>
                    <select
                      style={styles.select}
                      value={selected.type}
                      onChange={(e) =>
                        updateSelected({
                          type: e.target.value as InvoiceType,
                        })
                      }
                      disabled={isViewMode}
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
                  <label style={styles.label}>
                    Tên khách hàng (gõ để tìm)
                  </label>
                  <input
                    style={styles.input}
                    value={selected.partnerName}
                    onChange={(e) =>
                      !isViewMode && handlePartnerNameChange(e.target.value)
                    }
                    onFocus={() =>
                      !isViewMode && setShowPartnerSuggest(true)
                    }
                    placeholder="Nhập tên khách hàng..."
                    disabled={isViewMode}
                  />
                  {!isViewMode &&
                    showPartnerSuggest &&
                    partnerSuggestions.length > 0 && (
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
                  {!isViewMode &&
                    showPartnerSuggest &&
                    partnerSuggestions.length === 0 && (
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
                    value={selected.partnerAddress || ""}
                    onChange={(e) =>
                      updateSelected({ partnerAddress: e.target.value })
                    }
                    disabled={isViewMode}
                  />
                </div>

                <div style={{ ...styles.formRow, ...styles.rowInline }}>
                  <div style={styles.flex1}>
                    <label style={styles.label}>Số điện thoại</label>
                    <input
                      style={styles.input}
                      value={selected.partnerPhone || ""}
                      onChange={(e) =>
                        updateSelected({ partnerPhone: e.target.value })
                      }
                      disabled={isViewMode}
                    />
                  </div>
                  <div style={styles.flex1}>
                    <label style={styles.label}>Mã số thuế</label>
                    <input
                      style={styles.input}
                      value={selected.partnerTaxCode || ""}
                      onChange={(e) =>
                        updateSelected({ partnerTaxCode: e.target.value })
                      }
                      disabled={isViewMode}
                    />
                  </div>
                </div>

                <div style={styles.formRow}>
                  <label style={styles.label}>Email</label>
                  <input
                    style={styles.input}
                    value={selected.partnerEmail || ""}
                    onChange={(e) =>
                      updateSelected({ partnerEmail: e.target.value })
                    }
                    disabled={isViewMode}
                  />
                </div>

                <div style={{ marginTop: 4 }}>
                  <button
                    type="button"
                    style={styles.secondarySmallBtn}
                    onClick={handleSavePartner}
                    disabled={isViewMode}
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
                      value={selected.saleUserId || ""}
                      onChange={(e) =>
                        updateSelected({
                          saleUserId: e.target.value || undefined,
                        })
                      }
                      disabled={isViewMode}
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
                      value={selected.techUserId || ""}
                      onChange={(e) =>
                        updateSelected({
                          techUserId: e.target.value || undefined,
                        })
                      }
                      disabled={isViewMode}
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
                  <div>Sản phẩm</div>
                  <div>ĐVT</div>
                  <div>SL</div>
                  <div>Đơn giá</div>
                  <div>Thành tiền</div>
                  <div />
                </div>

                {selected.lines.length === 0 && (
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                    Chưa có dòng sản phẩm, bấm “Thêm dòng sản phẩm”.
                  </div>
                )}

                {selected.lines.map((line, idx) => {
                  // ⚠️ FIX filter gợi ý: trim + tìm theo cả sku + name, sort ưu tiên mã bắt đầu bằng q
                  const q = line.itemName.trim().toLowerCase();

                  const itemSuggestions =
                    q.length > 0
                      ? items
                          .filter((it) => {
                            const name = (it.name || "").toLowerCase();
                            const sku = (it.sku || "").toLowerCase();
                            return sku.includes(q) || name.includes(q);
                          })
                          .sort((a, b) => {
                            const aSku = (a.sku || "").toLowerCase();
                            const bSku = (b.sku || "").toLowerCase();
                            const aStarts = aSku.startsWith(q) ? 0 : 1;
                            const bStarts = bSku.startsWith(q) ? 0 : 1;
                            if (aStarts !== bStarts) return aStarts - bStarts;
                            return aSku.localeCompare(bSku);
                          })
                          .slice(0, 50)
                      : [];

                  return (
                    <div key={idx} style={styles.gridRow}>
                      <div style={styles.autoWrapper}>
                        <input
                          style={styles.smallInput}
                          value={line.itemName}
                          onChange={(e) =>
                            !isViewMode &&
                            handleLineChange(idx, "itemName", e.target.value)
                          }
                          onFocus={() =>
                            !isViewMode && setOpenItemSuggestIndex(idx)
                          }
                          placeholder="Gõ mã hoặc tên sản phẩm..."
                          disabled={isViewMode}
                        />
                        {!isViewMode &&
                          openItemSuggestIndex === idx &&
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
                                    title={it.sku ? `[${it.sku}] ${it.name}` : it.name} // tooltip nếu cần xem mã
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

                      <div>
                        <input
                          style={styles.smallInput}
                          value={line.unit || ""}
                          onChange={(e) =>
                            !isViewMode &&
                            handleLineChange(idx, "unit", e.target.value)
                          }
                          disabled={isViewMode}
                        />
                      </div>

                      <div>
                        <input
                          style={styles.smallInput}
                          type="number"
                          min={0}
                          value={line.qty}
                          onChange={(e) =>
                            !isViewMode &&
                            handleLineChange(
                              idx,
                              "qty",
                              Number(e.target.value) || 0
                            )
                          }
                          disabled={isViewMode}
                        />
                      </div>

                      <div>
                        <input
                          style={styles.smallInput}
                          type="number"
                          min={0}
                          value={line.price}
                          onChange={(e) =>
                            !isViewMode &&
                            handleLineChange(
                              idx,
                              "price",
                              Number(e.target.value) || 0
                            )
                          }
                          disabled={isViewMode}
                        />
                      </div>

                      <div style={{ fontSize: 13 }}>
                        {(line.qty * line.price).toLocaleString()}
                      </div>

                      <div>
                        <button
                          type="button"
                          style={styles.smallBtn}
                          onClick={() => removeLine(idx)}
                          disabled={isViewMode}
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
                  disabled={isViewMode}
                >
                  + Thêm dòng sản phẩm
                </button>

                {/* Tóm tắt tiền + thuế */}
                <div style={{ marginTop: 8 }}>
                  <div style={styles.summaryRow}>
                    <span style={styles.summaryLabel}>Tạm tính:</span>
                    <span style={styles.summaryValue}>
                      {(selected.subtotal ?? 0).toLocaleString()} đ
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
                        value={selected.taxPercent ?? 0}
                        onChange={(e) => {
                          if (isViewMode) return;
                          const raw = e.target.value;
                          const num = raw === "" ? 0 : Number(raw);
                          const val = isNaN(num) ? 0 : num;
                          setSelected((prev) => {
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
                        disabled={isViewMode}
                      />
                      <span>%</span>
                      <span style={{ marginLeft: 12 }}>
                        = {(selected.tax ?? 0).toLocaleString()} đ
                      </span>
                    </div>
                  </div>

                  <div style={styles.summaryRow}>
                    <span style={styles.summaryLabel}>Tổng cộng:</span>
                    <span style={styles.summaryValue}>
                      {selected.totalAmount.toLocaleString()} đ
                    </span>
                  </div>
                </div>

                <div style={styles.postStatusRow}>
                  <span
                    style={{
                      fontSize: 13,
                      color: selected.posted ? "#16a34a" : "#f97316",
                    }}
                  >
                    Trạng thái tồn:{" "}
                    {selected.posted ? "Đã lưu tồn" : "Chưa lưu tồn"}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      style={styles.secondarySmallBtn}
                      disabled={!selected.id || selected.posted}
                      onClick={handlePostStock}
                    >
                      Lưu tồn
                    </button>
                    <button
                      type="button"
                      style={styles.secondarySmallBtn}
                      disabled={!selected.id || !selected.posted}
                      onClick={handleUnpostStock}
                    >
                      Hủy lưu tồn
                    </button>
                  </div>
                </div>
              </div>

              {/* Chỉ hiện nút khi đang tạo/sửa */}
              {mode !== "view" && (
                <div style={styles.formActions}>
                  <button
                    type="button"
                    style={styles.secondaryBtn}
                    onClick={() => {
                      if (mode === "edit" && selected?.id) {
                        // quay về xem lại bản gốc
                        const original = invoices.find(
                          (i) => i.id === selected.id
                        );
                        if (original) {
                          handleSelectInvoice(original, "view");
                        } else {
                          setSelected(null);
                        }
                      } else {
                        // create -> bỏ chọn
                        setSelected(null);
                      }
                      setMode("view");
                    }}
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
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default InvoicesPage;
