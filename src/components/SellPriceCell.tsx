// src/components/SellPriceCell.tsx
// ✅ Ô "Giá bán đề xuất" ở trang tồn (linh kiện + máy)
//  - admin / kế toán: bấm vào để sửa, Enter lưu, Esc huỷ
//  - nhân viên: chỉ xem
//  - dưới giá hiện thời gian cập nhật giá lần cuối
import React, { useEffect, useRef, useState } from "react";
import api from "../api/client";

type Props = {
  itemId?: string;
  value: number | null;
  updatedAt?: string | null;
  canEdit: boolean;
  compact?: boolean; // thẻ mobile: chữ nhỏ, căn trái
  onSaved: (price: number, updatedAt: string | null) => void;
  onError?: (msg: string) => void;
};

const fmt = (n: number) => Number(n || 0).toLocaleString("vi-VN");

function fmtPriceUpdatedAt(v?: string | null) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SellPriceCell: React.FC<Props> = ({ itemId, value, updatedAt, canEdit, compact, onSaved, onError }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]);

  const price = Number(value || 0);
  const when = fmtPriceUpdatedAt(updatedAt);
  const editable = canEdit && !!itemId;

  const start = () => {
    if (!editable || saving) return;
    setText(price > 0 ? fmt(price) : "");
    setEditing(true);
  };

  const save = async () => {
    const digits = text.replace(/[^\d]/g, "");
    const next = digits ? Number(digits) : 0;
    if (next === price) {
      setEditing(false);
      return;
    }
    try {
      setSaving(true);
      const res = await api.put(`/items/${itemId}`, { sellPrice: next });
      const d = res?.data?.data || {};
      onSaved(next, d.sellPriceUpdatedAt ?? new Date().toISOString());
      setEditing(false);
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      onError?.(err?.response?.data?.message || err?.message || "Lưu giá bán thất bại.");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: compact ? "flex-start" : "flex-end" }}>
        <input
          ref={inputRef}
          value={text}
          inputMode="numeric"
          disabled={saving}
          placeholder="0"
          onChange={(e) => {
            const digits = e.target.value.replace(/[^\d]/g, "");
            setText(digits ? Number(digits).toLocaleString("vi-VN") : "");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          style={{
            width: compact ? 120 : 110,
            padding: "4px 6px",
            border: "1px solid #93c5fd",
            borderRadius: 6,
            textAlign: "right",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          title="Lưu (Enter)"
          style={{
            padding: "4px 7px",
            borderRadius: 6,
            border: "1px solid #16a34a",
            background: "#16a34a",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {saving ? "…" : "✓"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          title="Huỷ (Esc)"
          style={{
            padding: "4px 7px",
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => {
        if (!editable) return;
        e.stopPropagation(); // không xổ lịch sử nhập xuất của dòng
        start();
      }}
      title={editable ? "Bấm để sửa giá bán đề xuất" : undefined}
      style={{
        textAlign: compact ? "left" : "right",
        cursor: editable ? "pointer" : "default",
        borderRadius: 6,
        padding: editable ? "2px 4px" : 0,
        border: editable ? "1px dashed transparent" : undefined,
      }}
      onMouseEnter={(e) => editable && (e.currentTarget.style.borderColor = "#93c5fd")}
      onMouseLeave={(e) => editable && (e.currentTarget.style.borderColor = "transparent")}
    >
      <div style={{ fontWeight: 600, color: price > 0 ? "#0f172a" : "#94a3b8", fontSize: compact ? 13 : 14 }}>
        {price > 0 ? fmt(price) : "Chưa có"}
        {editable && <span style={{ marginLeft: 4, color: "#94a3b8", fontSize: 11 }}>✎</span>}
      </div>
      {when && <div style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap" }}>Cập nhật {when}</div>}
    </div>
  );
};

export default SellPriceCell;