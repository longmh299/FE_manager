// src/pages/StockOpeningImportPage.tsx
import React, { useState } from "react";
import api from "../api/client";
import { appConfirm } from "../components/AppDialog";

type ImportSummary = {
  createdItems?: number;
  updatedItems?: number;
  affectedStocks?: number;
  mode?: string;
  skippedRows?: number;
  totalBefore?: number;
  totalAfter?: number;
};

const StockOpeningImportPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"replace" | "add">("replace");
  const [warnings, setWarnings] = useState<Array<{ row: number; message: string }>>([]);
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
      setWarnings([]);

      const post = (extra: Record<string, string>) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("mode", mode); // replace | add
        Object.entries(extra).forEach(([k, v]) => formData.append(k, v));
        return api.post("/imports/stocks/opening-onefile", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      };

      // ✅ tính trước kết quả, hỏi xác nhận rồi mới ghi
      const pre = await post({ dryRun: "1" });
      const p = pre.data?.summary as ImportSummary;
      const dup = pre.data?.duplicateOf;
      const preWarn: Array<{ row: number; message: string }> = pre.data?.warningRows || [];
      const ok = await appConfirm(
        <div className="space-y-1 text-left">
          <div>
            Chế độ: <b>{mode === "replace" ? "Ghi đè tồn theo file" : "Cộng thêm vào tồn hiện có"}</b>
          </div>
          <div>Số dòng tồn thay đổi: <b>{p.affectedStocks ?? 0}</b> (mã mới: {p.createdItems ?? 0}, mã đã có: {p.updatedItems ?? 0})</div>
          <div>
            Tổng số lượng các mã này: <b>{Number(p.totalBefore ?? 0).toLocaleString("vi-VN")}</b> →{" "}
            <b>{Number(p.totalAfter ?? 0).toLocaleString("vi-VN")}</b>
          </div>
          {dup && <div className="font-semibold text-red-600">File này đã từng được nhập cộng thêm. Nhập lại sẽ cộng trùng tồn kho.</div>}
          {preWarn.length > 0 && (
            <ul className="max-h-40 list-disc overflow-auto pl-4 text-xs text-amber-700">
              {preWarn.slice(0, 30).map((w, i) => (
                <li key={i}>Dòng {w.row}: {w.message}</li>
              ))}
            </ul>
          )}
        </div>,
        { title: "Xác nhận nhập tồn", tone: mode === "replace" || dup ? "danger" : "info", confirmLabel: "Nhập tồn" }
      );
      if (!ok) return;

      const res = await post(dup ? { allowDuplicate: "1" } : {});
      const sum = (res.data?.summary as ImportSummary) || null;
      setSummary(sum);
      setWarnings(res.data?.warningRows || []);
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

  // 🔹 Tải file Excel mẫu
  // ✅ tải qua api (có gửi kèm đăng nhập). Trước đây mở thẳng link nên server từ chối (chưa đăng nhập) -> không tải được
  const downloadBlob = async (path: string, filename: string) => {
    try {
      const res = await api.get(path, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Download error", err);
      alert(err?.response?.status === 403 ? "Bạn không có quyền tải file này." : "Không tải được file. Thử lại sau.");
    }
  };

  const handleDownloadTemplate = () => {
    void downloadBlob("/imports/stocks/opening-template", "mau-nhap-ton-dau.xlsx");
  };

  return (
    <div style={{ padding: 16, maxWidth: 700, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 12 }}>Nhập tồn đầu từ Excel</h2>

      <p style={{ fontSize: 13, color: "#4a5568", marginBottom: 12 }}>
        File Excel cần có cột tên hàng (<code>name</code>) hoặc mã (<code>sku</code>) và cột tồn (<code>ton_dau</code> hoặc <code>qty</code>).
        Không chắc thì tải file mẫu. <br />
        Cột <code>kind</code>: <b>MACHINE</b> cho máy, <b>PART</b> cho linh kiện; để trống thì giữ nguyên. Ô tồn để trống thì mã đó giữ nguyên. <br />
        <b>Ghi đè</b> chỉ đổi các mã có trong file. Trước khi ghi, hệ thống sẽ hiện kết quả để bạn xác nhận.
      </p>

      {/* 🔹 Nút tải file mẫu Excel */}
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={handleDownloadTemplate}
          style={{
            padding: "6px 14px",
            borderRadius: 4,
            border: "1px solid #2563eb",
            backgroundColor: "#f9fafb",
            color: "#2563eb",
            fontSize: 14,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Tải file mẫu Excel tồn
        </button>
      </div>

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
          <div
            style={{
              display: "flex",
              gap: 16,
              fontSize: 13,
              marginTop: 4,
            }}
          >
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
          {warnings.length > 0 && (
            <ul style={{ marginTop: 6, paddingLeft: 16, color: "#975a16", maxHeight: 200, overflow: "auto" }}>
              {warnings.map((w, i) => (
                <li key={i}>Dòng {w.row}: {w.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default StockOpeningImportPage;
