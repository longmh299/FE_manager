import React, { useEffect, useState } from "react";
import { api } from "../api/client"; // nếu bạn để default thì đổi thành: import api from "../api/client";

export interface CustomerFields {
  partnerId: string | null;
  partnerName: string;
  partnerPhone: string;
  partnerEmail: string;
  partnerTax: string;
  partnerAddr: string;
}

export interface Partner {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  taxCode?: string | null; // tên field MST bên backend
  address?: string | null;
}

interface Props {
  value: CustomerFields;
  onChange: (value: CustomerFields) => void;
}

const InvoiceCustomerBlock: React.FC<Props> = ({ value, onChange }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);

  // helper cập nhật 1 field
  const updateField = (field: keyof CustomerFields, v: string | null) => {
    onChange({
      ...value,
      [field]: v ?? "",
    });
  };

  // ================== TÌM KHÁCH HÀNG CŨ ==================
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setLoading(true);
        // GET /partners?q=...&pageSize=10
        const res = await api.get("/partners", {
          params: { q, pageSize: 10 },
        });

        const items: Partner[] = res.data.items ?? res.data.data ?? res.data;
        if (Array.isArray(items)) setResults(items);
        else setResults([]);
      } catch (err) {
        console.error("Search partners error", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [query]);

  const handleSelectPartner = (p: Partner) => {
    onChange({
      partnerId: p.id,
      partnerName: p.name ?? "",
      partnerPhone: p.phone ?? "",
      partnerEmail: p.email ?? "",
      partnerTax: p.taxCode ?? "",
      partnerAddr: p.address ?? "",
    });
    setQuery("");
    setResults([]);
  };

  // ================== LƯU KHÁCH HÀNG MỚI ==================
  const handleSavePartner = async () => {
    try {
      const payload = {
        name: value.partnerName,
        phone: value.partnerPhone || null,
        email: value.partnerEmail || null,
        taxCode: value.partnerTax || null,
        address: value.partnerAddr || null,
      };

      const res = await api.post("/partners", payload);
      const p: Partner = res.data;

      onChange({
        ...value,
        partnerId: p.id,
      });

      alert("Đã lưu khách hàng vào Partner.");
    } catch (err) {
      console.error("Save partner error", err);
      alert("Không lưu được khách hàng. Kiểm tra log backend.");
    }
  };

  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        borderRadius: 8,
        border: "1px solid #e5e7eb",
        backgroundColor: "#f9fafb",
      }}
    >
      <h4
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        Khách hàng
      </h4>

      {/* ========= TÌM KHÁCH HÀNG ĐÃ CÓ ========= */}
      <div
        style={{
          marginBottom: 12,
          position: "relative",
        }}
      >
        <label
          style={{
            fontSize: 13,
            fontWeight: 500,
            display: "block",
            marginBottom: 4,
          }}
        >
          Tìm khách hàng (theo tên / MST / SĐT)
        </label>
        <input
          className="form-control"
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
          }}
          placeholder="Nhập tối thiểu 2 ký tự..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && (
          <div
            style={{
              fontSize: 12,
              color: "#6b7280",
              marginTop: 4,
            }}
          >
            Đang tìm khách hàng...
          </div>
        )}

        {results.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "100%",
              marginTop: 4,
              backgroundColor: "#ffffff",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              maxHeight: 220,
              overflowY: "auto",
              zIndex: 50,
            }}
          >
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPartner(p)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "white",
                  padding: "6px 8px",
                  borderBottom: "1px solid #f3f4f6",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#6b7280",
                  }}
                >
                  {p.taxCode && <>MST: {p.taxCode} · </>}
                  {p.phone && <>SĐT: {p.phone}</>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ========= FORM THÔNG TIN KHÁCH HÀNG ========= */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          columnGap: 12,
          rowGap: 8,
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <label
            style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}
          >
            Tên khách hàng
          </label>
          <input
            className="form-control"
            style={{ padding: "6px 8px", fontSize: 13 }}
            value={value.partnerName}
            onChange={(e) => updateField("partnerName", e.target.value)}
          />
        </div>

        <div>
          <label
            style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}
          >
            Số điện thoại
          </label>
          <input
            className="form-control"
            style={{ padding: "6px 8px", fontSize: 13 }}
            value={value.partnerPhone}
            onChange={(e) => updateField("partnerPhone", e.target.value)}
          />
        </div>

        <div>
          <label
            style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}
          >
            Email (không bắt buộc)
          </label>
          <input
            className="form-control"
            type="email"
            style={{ padding: "6px 8px", fontSize: 13 }}
            value={value.partnerEmail}
            onChange={(e) => updateField("partnerEmail", e.target.value)}
          />
        </div>

        <div>
          <label
            style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}
          >
            Mã số thuế (không bắt buộc)
          </label>
          <input
            className="form-control"
            style={{ padding: "6px 8px", fontSize: 13 }}
            value={value.partnerTax}
            onChange={(e) => updateField("partnerTax", e.target.value)}
          />
        </div>

        <div>
          <label
            style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}
          >
            Địa chỉ
          </label>
          <input
            className="form-control"
            style={{ padding: "6px 8px", fontSize: 13 }}
            value={value.partnerAddr}
            onChange={(e) => updateField("partnerAddr", e.target.value)}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={handleSavePartner}
          disabled={!value.partnerName.trim()}
          className="btn btn-outline-secondary btn-sm"
        >
          Lưu khách hàng vào Partner
        </button>

        {value.partnerId && (
          <span
            style={{
              fontSize: 12,
              color: "#16a34a",
            }}
          >
            Đã gắn với Partner ID: {value.partnerId}
          </span>
        )}
      </div>
    </div>
  );
};

export default InvoiceCustomerBlock;
