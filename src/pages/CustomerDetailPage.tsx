import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

type EditField = "name" | "phone" | "email" | "address" | "taxCode";

const FIELD_LABEL: Record<EditField, string> = {
  name: "Tên khách hàng",
  phone: "Số điện thoại",
  email: "Email",
  address: "Địa chỉ",
  taxCode: "Mã số thuế",
};

const fmtMoney = (n: number) => `${Number(n || 0).toLocaleString("vi-VN")} đ`;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("vi-VN") : "");

const CustomerDetailPage: React.FC = () => {
  const { id } = useParams();

  const [data, setData] = useState<any>(null);
  const [loadError, setLoadError] = useState("");
  const [editModal, setEditModal] = useState<{ field: EditField; value: string } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [invoiceTab, setInvoiceTab] = useState<"approved" | "pending">("approved");

  const fetchData = async () => {
    setLoadError("");
    try {
      const res = await api.get(`/customers/${id}`);
      // ✅ khách đã gộp: chuyển sang mã giữ lại
      if (res.data?.data?.mergedIntoId || res.data?.mergedIntoId) {
        window.location.replace(`/partners/${res.data?.data?.mergedIntoId || res.data?.mergedIntoId}`);
        return;
      }
      setData(res.data.data);
    } catch (err: any) {
      console.error(err);
      setLoadError(err?.response?.data?.message || "Không tải được thông tin khách hàng.");
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openEdit = (field: EditField, value?: string) => {
    setSaveError("");
    setEditModal({ field, value: value || "" });
  };

  const handleUpdateField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal) return;
    // ✅ tên khách không được để trống
    if (editModal.field === "name" && !editModal.value.trim()) {
      setSaveError("Tên khách hàng không được để trống.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await api.put(`/customers/${id}`, { [editModal.field]: editModal.field === "name" ? editModal.value.trim() : editModal.value });
      setEditModal(null);
      fetchData();
    } catch (err) {
      const r = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
      const msg = r?.status === 400 ? r?.data?.message : "";
      if (msg) return setSaveError(msg);
      setSaveError(`Chưa lưu được ${FIELD_LABEL[editModal.field].toLowerCase()}. Kiểm tra lại rồi bấm Lưu lần nữa.`);
    } finally {
      setSaving(false);
    }
  };

  const backLink = (
    <Link to="/partners" className="text-sm font-medium text-slate-500 hover:text-blue-700">
      Về danh sách khách hàng
    </Link>
  );

  if (loadError) {
    return (
      <div className="p-4 space-y-3 text-sm">
        {backLink}
        <p className="text-slate-700">{loadError}</p>
      </div>
    );
  }
  if (!data) return <div className="p-4 text-sm text-slate-500">Đang tải thông tin khách hàng...</div>;

  const invoices: any[] = data.invoices || [];
  // Chỉ 2 nhóm: đã duyệt (mua thật) và chờ duyệt (nháp/chờ duyệt). Hoá đơn huỷ/từ chối không tính.
  const approved = invoices.filter((inv) => inv.status === "APPROVED");
  const pending = invoices.filter((inv) => inv.status === "SUBMITTED" || inv.status === "DRAFT");
  const shown = invoiceTab === "approved" ? approved : pending;
  const machineLines = approved.flatMap((inv) => inv.lines || []);
  const approvedTotal = approved.reduce((s, inv) => s + Number(inv.total || 0), 0);

  const contactRows: Array<{ field: EditField; label: string; value?: string }> = [
    { field: "name", label: "Tên khách hàng", value: data.name },
    { field: "phone", label: "Số điện thoại", value: data.phone },
    { field: "email", label: "Email", value: data.email },
    { field: "taxCode", label: "Mã số thuế", value: data.taxCode },
    { field: "address", label: "Địa chỉ", value: data.address },
  ];

  const tabClass = (active: boolean) =>
    `flex-1 md:flex-none rounded-md px-3 py-1.5 text-sm font-medium ${
      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
    }`;

  return (
    <div className="p-4 space-y-4 text-sm">
      <div>
        {backLink}
        <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-semibold text-slate-900">{data.name}</h1>
          {data.phone && (
            <div className="flex gap-2">
              <a href={`tel:${String(data.phone).replace(/\s/g, "")}`} className="flex-1 rounded-md bg-blue-600 px-5 py-2 text-center font-semibold text-white hover:bg-blue-700 md:flex-none">
                Gọi
              </a>
              <a
                href={`https://zalo.me/${String(data.phone).replace(/\s/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded-md border border-slate-300 bg-white px-5 py-2 text-center font-semibold text-slate-700 hover:border-blue-500 hover:text-blue-700 md:flex-none"
              >
                Zalo
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <section className="rounded-md bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-semibold text-slate-900">Thông tin liên hệ</h2>
            <dl>
              {contactRows.map((r) => (
                <div key={r.field} className="flex items-start justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <dt className="text-xs text-slate-500">{r.label}</dt>
                    <dd className={`mt-0.5 break-words ${r.value ? "text-slate-900" : "text-amber-700"}`}>{r.value || "Chưa có"}</dd>
                  </div>
                  <button type="button" className="shrink-0 font-medium text-blue-700 hover:underline" onClick={() => openEdit(r.field, r.value)}>
                    {r.value ? "Sửa" : "Bổ sung"}
                  </button>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-md bg-white p-4 shadow-sm">
            <h2 className="mb-1 font-semibold text-slate-900">Máy đang sử dụng</h2>
            {machineLines.length === 0 ? (
              <p className="py-2 text-slate-500">Chưa có máy nào. Máy sẽ hiện ở đây khi có hoá đơn được duyệt.</p>
            ) : (
              <ul className="max-h-72 overflow-auto">
                {machineLines.map((line: any) => (
                  <li key={line.id} className="border-b border-slate-100 py-2 text-slate-900 last:border-b-0">
                    {line.item?.name || "Không rõ máy"}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="rounded-md bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Lịch sử mua</h2>
              <p className="mt-0.5 tabular-nums text-slate-500">
                {approved.length} hoá đơn đã duyệt, tổng <b className="font-semibold text-slate-900">{fmtMoney(approvedTotal)}</b>
              </p>
            </div>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Trạng thái hoá đơn">
              <button type="button" aria-pressed={invoiceTab === "approved"} onClick={() => setInvoiceTab("approved")} className={tabClass(invoiceTab === "approved")}>
                Đã duyệt
              </button>
              <button type="button" aria-pressed={invoiceTab === "pending"} onClick={() => setInvoiceTab("pending")} className={tabClass(invoiceTab === "pending")}>
                Chờ duyệt
                {pending.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 text-xs font-semibold tabular-nums text-white">{pending.length}</span>
                )}
              </button>
            </div>
          </div>

          {shown.length === 0 && (
            <p className="px-4 py-8 text-center text-slate-500">
              {invoiceTab === "approved" ? "Chưa có hoá đơn đã duyệt." : "Không có hoá đơn nào đang chờ duyệt."}
            </p>
          )}

          {shown.map((inv: any) => {
            const isOpen = openInvoiceId === inv.id;
            return (
              <div key={inv.id} className="border-b border-slate-100 last:border-b-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenInvoiceId(isOpen ? null : inv.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
                >
                  <span aria-hidden="true" className={`text-slate-400 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}>
                    ▸
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      {inv.code || "Hoá đơn"}
                      {invoiceTab === "pending" && (
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700">{inv.status === "DRAFT" ? "Nháp" : "Chờ duyệt"}</span>
                      )}
                    </span>
                    <span className="block text-xs tabular-nums text-slate-500">{fmtDate(inv.issueDate)}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-900">{fmtMoney(Number(inv.total))}</span>
                </button>

                {isOpen && (
                  <ul className="space-y-1 bg-slate-50 px-4 py-2.5 pl-10">
                    {inv.lines?.map((line: any) => (
                      <li key={line.id} className="flex justify-between gap-4">
                        <span className="min-w-0 text-slate-800">{line.item?.name || "Không rõ máy"}</span>
                        <span className="shrink-0 tabular-nums text-slate-500">x{Number(line.qty || 1)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      </div>

      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleUpdateField} className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl" role="dialog" aria-modal="true">
            <label className="block">
              <span className="mb-1.5 block font-semibold text-slate-900">{FIELD_LABEL[editModal.field]}</span>
              <input
                autoFocus
                value={editModal.value}
                onChange={(e) => setEditModal({ ...editModal, value: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
            {saveError && <p className="text-rose-700">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50" onClick={() => setEditModal(null)}>
                Huỷ
              </button>
              <button type="submit" disabled={saving} className="rounded-md bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default CustomerDetailPage;