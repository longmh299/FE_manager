// src/components/NewPartnerInline.tsx
// ✅ Khách mới chưa có trong danh sách: tạo nhanh (tên + SĐT) ngay trong form cọc
import React, { useState } from "react";
import api from "../api/client";

type P = { id: string; name: string; phone?: string | null };

const NewPartnerInline: React.FC<{ name: string; onCreated: (p: P) => void }> = ({ name, onCreated }) => {
  const [open, setOpen] = useState(false);
  const [nm, setNm] = useState(name);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setNm(name);
          setOpen(true);
        }}
        className="mt-1 text-sm font-medium text-sky-700 hover:underline"
      >
        + Thêm khách mới “{name}”
      </button>
    );

  const save = async () => {
    setErr(null);
    if (!nm.trim()) return setErr("Nhập tên khách.");
    setBusy(true);
    try {
      if (phone.trim()) {
        const dup = (await api.get("/partners/check-duplicate", { params: { phone: phone.trim(), name: nm.trim() } }).catch(() => null))?.data;
        // cùng số điện thoại = khách đã có, chọn luôn khách đó cho khỏi trùng
        const hit = (dup?.data?.phoneMatches || [])[0];
        if (hit?.id) {
          onCreated(hit);
          return;
        }
      }
      const res = await api.post("/partners", { name: nm.trim(), phone: phone.trim() || null });
      const p = res.data?.data || res.data;
      if (!p?.id) throw new Error("Không tạo được khách.");
      onCreated(p);
    } catch (e: unknown) {
      const x = e as { response?: { data?: { message?: string; error?: string } }; message?: string };
      setErr(x?.response?.data?.message || x?.response?.data?.error || x?.message || "Không tạo được khách.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg border border-sky-200 bg-sky-50/50 p-2 sm:grid-cols-[1fr_1fr_auto]">
      <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Tên khách" value={nm} onChange={(e) => setNm(e.target.value)} />
      <input
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="Số điện thoại"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button type="button" disabled={busy} onClick={save} className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
        {busy ? "Đang tạo…" : "Tạo khách"}
      </button>
      {err && <p className="text-xs text-rose-600 sm:col-span-3">{err}</p>}
    </div>
  );
};

export default NewPartnerInline;
