// src/pages/StockOpeningImportPage.tsx
import React, { useState } from "react";
import api from "../api/client";

type ImportSummary = {
  createdItems?: number;
  updatedItems?: number;
  affectedStocks?: number;
  mode?: string;
};

const StockOpeningImportPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setSummary(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Vui lòng chọn file Excel tồn.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSummary(null);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", mode); // replace | add

      const res = await api.post("/imports/stocks/opening-onefile", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const sum = res.data?.summary as ImportSummary | undefined;
      setSummary(sum || null);
    } catch (err: any) {
      console.error("Import opening stocks error", err);
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Import tồn thất bại";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, maxWidth: 700, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 12 }}>Nhập tồn đầu từ Excel</h2>

      <p style={{ fontSize: 13, color: "#4a5568", marginBottom: 16 }}>
        File Excel nên có header:{" "}
        <code>sku, name, kind, qty, sellPrice, note</code>. <br />
        Cột <code>kind</code>: <b>MACHINE</b> cho máy, <b>PART</b> cho linh
        kiện. <br />
        Chọn chế độ <b>Ghi đè (replace)</b> để set lại toàn bộ tồn theo file.
      </p>

      <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Chọn file Excel tồn
          </label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Chế độ import
          </label>
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <label>
              <input
                type="radio"
                name="mode"
                value="replace"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />{" "}
              Ghi đè (replace) – set lại số tồn = qty trong file
            </label>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 13, marginTop: 4 }}>
            <label>
              <input
                type="radio"
                name="mode"
                value="add"
                checked={mode === "add"}
                onChange={() => setMode("add")}
              />{" "}
              Cộng thêm (add) – cộng qty trong file vào tồn hiện tại
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "6px 14px",
            borderRadius: 4,
            border: "1px solid #3182ce",
            backgroundColor: loading ? "#90cdf4" : "#3182ce",
            color: "#fff",
            cursor: loading ? "default" : "pointer",
            fontSize: 14,
          }}
        >
          {loading ? "Đang import..." : "Nhập tồn"}
        </button>
      </form>

      {error && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            borderRadius: 4,
            border: "1px solid #fc8181",
            backgroundColor: "#fff5f5",
            color: "#c53030",
            fontSize: 13,
          }}
        >
          Lỗi: {error}
        </div>
      )}

      {summary && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            borderRadius: 4,
            border: "1px solid #c6f6d5",
            backgroundColor: "#f0fff4",
            color: "#22543d",
            fontSize: 13,
          }}
        >
          <div>
            <b>Kết quả import:</b>
          </div>
          <div>Item mới tạo: {summary.createdItems ?? 0}</div>
          <div>Item cập nhật: {summary.updatedItems ?? 0}</div>
          <div>Dòng tồn cập nhật: {summary.affectedStocks ?? 0}</div>
          <div>Chế độ: {summary.mode}</div>
        </div>
      )}
    </div>
  );
};

export default StockOpeningImportPage;
