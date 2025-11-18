// src/pages/StockCountDetailPage.tsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";

type Location = {
  id: string;
  code: string;
  name: string;
};

type Item = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  kind?: "PART" | "MACHINE" | string;
};

type StockCountLine = {
  id: string;
  itemId: string;
  countedQty: string;
  bookQty?: string;
  diff?: string;
  item?: Item;
};

type StockCountDetail = {
  id: string;
  refNo: string | null;
  note: string | null;
  status: "draft" | "posted" | string;
  locationId: string;
  location?: Location;
  createdAt: string;
  updatedAt: string;
  lines: StockCountLine[];
};

type TabKind = "PART" | "MACHINE";

const StockCountDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<StockCountDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [posting, setPosting] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);

  // giá trị đang gõ trên input, key = lineId
  const [editingValues, setEditingValues] = useState<Record<string, string>>(
    {}
  );

  // tab hiện tại: Linh kiện (PART) / Máy (MACHINE)
  const [activeTab, setActiveTab] = useState<TabKind>("PART");

  const loadDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.get(`/stock-counts/${id}`);
      const detail: StockCountDetail = res.data.data;
      setData(detail);

      const init: Record<string, string> = {};
      (detail.lines || []).forEach((l) => {
        init[l.id] =
          (l.countedQty as any)?.toString?.() ?? l.countedQty ?? "0";
      });
      setEditingValues(init);
    } catch (err) {
      console.error("Failed to load stock count detail", err);
      alert("Không tải được phiếu kiểm kê.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const parseNumber = (v: string | undefined | null): number => {
    if (v == null || v === "") return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  };

  const handleUpdateCountedQty = async (line: StockCountLine) => {
    if (!id || !data) return;
    if (data.status === "posted") return;

    const value =
      editingValues[line.id] ??
      (line.countedQty as any)?.toString?.() ??
      "0";

    try {
      setSavingLineId(line.id);
      await api.put(`/stock-counts/lines/${line.id}`, {
        countedQty: value || "0",
      });

      // Cập nhật local state cho dòng đó, không reload toàn phiếu
      setData((prev) => {
        if (!prev) return prev;
        const newLines = prev.lines.map((l) => {
          if (l.id !== line.id) return l;
          const newCounted = value || "0";
          const book = parseNumber(l.bookQty ?? "0");
          const counted = parseNumber(newCounted);
          const diff = counted - book;
          return {
            ...l,
            countedQty: newCounted,
            diff: diff.toString(),
          };
        });
        return { ...prev, lines: newLines };
      });
    } catch (err) {
      console.error("Failed to update countedQty", err);
      alert("Cập nhật số thực đếm thất bại");
    } finally {
      setSavingLineId(null);
    }
  };

  const handlePost = async () => {
    if (!id || !data) return;
    if (data.status === "posted") {
      alert("Phiếu kiểm kê đã được post.");
      return;
    }
    const confirm = window.confirm(
      "Post kiểm kê sẽ điều chỉnh tồn kho theo số thực đếm. Bạn chắc chắn?"
    );
    if (!confirm) return;

    try {
      setPosting(true);
      await api.post(`/stock-counts/${id}/post`, {});
      await loadDetail();
      alert("Đã post kiểm kê và điều chỉnh tồn kho.");
    } catch (err: any) {
      console.error("Failed to post stock count", err);
      alert(err?.response?.data?.message || "Post kiểm kê thất bại");
    } finally {
      setPosting(false);
    }
  };

  const handleExport = async () => {
    if (!id) return;
    try {
      const res = await api.get(`/stock-counts/${id}/export`, {
        params: { kind: activeTab }, // PART hoặc MACHINE
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        activeTab === "PART"
          ? `stock_count_parts_${id}.xlsx`
          : `stock_count_machines_${id}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export stock count", err);
      alert("Xuất Excel thất bại");
    }
  };

  const handleDelete = async () => {
    if (!id || !data) return;
    if (data.status === "posted") {
      alert("Không thể xoá phiếu kiểm kê đã post.");
      return;
    }
    const confirm = window.confirm(
      "Bạn chắc chắn muốn xoá phiếu kiểm kê này? (Chỉ nên xoá phiếu test/demo)"
    );
    if (!confirm) return;

    try {
      setDeleting(true);
      await api.delete(`/stock-counts/${id}`);
      alert("Đã xoá phiếu kiểm kê.");
      navigate("/stock-counts");
    } catch (err: any) {
      console.error("Failed to delete stock count", err);
      alert(err?.response?.data?.message || "Xoá phiếu kiểm kê thất bại");
    } finally {
      setDeleting(false);
    }
  };

  const renderDiff = (diffStr?: string) => {
    if (diffStr == null) return "";
    const diff = Number(diffStr);
    if (Number.isNaN(diff)) return diffStr;
    const style: React.CSSProperties = {
      fontWeight: 500,
    };
    if (diff > 0) {
      style.color = "#38a169";
      return <span style={style}>+{diff}</span>;
    }
    if (diff < 0) {
      style.color = "#e53e3e";
      return <span style={style}>{diff}</span>;
    }
    style.color = "#4a5568";
    return <span style={style}>0</span>;
  };

  if (!id) {
    return <div style={{ padding: 16 }}>Thiếu ID phiếu kiểm kê.</div>;
  }

  // lọc theo tab
  const visibleLines =
    data?.lines.filter((l) => l.item?.kind === activeTab) ?? [];

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{
          marginBottom: 12,
          padding: "4px 10px",
          borderRadius: 4,
          border: "1px solid #cbd5e0",
          backgroundColor: "#fff",
          cursor: "pointer",
        }}
      >
        ← Quay lại danh sách
      </button>

      {loading && !data && <div>Đang tải phiếu kiểm kê...</div>}
      {!loading && data && (
        <>
          {/* Header info */}
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: 12,
              marginBottom: 16,
              backgroundColor: "#f7fafc",
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2 style={{ margin: 0, marginBottom: 4 }}>
                  Phiếu kiểm kê: {data.refNo || data.id}
                </h2>
                <div style={{ fontSize: 13, color: "#4a5568" }}>
                  Kho:{" "}
                  {data.location
                    ? `${data.location.code} - ${data.location.name}`
                    : data.locationId}
                </div>
                {data.note && (
                  <div style={{ fontSize: 13, color: "#4a5568" }}>
                    Ghi chú: {data.note}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#718096", marginTop: 4 }}>
                  Tạo lúc:{" "}
                  {new Date(data.createdAt).toLocaleString("vi-VN")} | Cập nhật:{" "}
                  {new Date(data.updatedAt).toLocaleString("vi-VN")}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ marginBottom: 8 }}>
                  {data.status === "posted" ? (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        backgroundColor: "#e6ffed",
                        color: "#007f3b",
                        border: "1px solid #9ae6b4",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      Posted
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        backgroundColor: "#fff8e1",
                        color: "#b7791f",
                        border: "1px solid #fbd38d",
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      Draft
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleExport}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #4a5568",
                      backgroundColor: "#fff",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    Xuất Excel {activeTab === "PART" ? "Linh kiện" : "Máy"}
                  </button>

                  <button
                    type="button"
                    disabled={data.status === "posted" || posting}
                    onClick={handlePost}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #2f855a",
                      backgroundColor:
                        data.status === "posted" || posting ? "#9ae6b4" : "#38a169",
                      color: "#fff",
                      cursor:
                        data.status === "posted" || posting ? "default" : "pointer",
                      fontSize: 13,
                    }}
                  >
                    {posting ? "Đang post..." : "Post kiểm kê"}
                  </button>

                  <button
                    type="button"
                    disabled={data.status === "posted" || deleting}
                    onClick={handleDelete}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 4,
                      border: "1px solid #e53e3e",
                      backgroundColor:
                        data.status === "posted" || deleting ? "#fed7d7" : "#fff5f5",
                      color: "#e53e3e",
                      cursor:
                        data.status === "posted" || deleting ? "default" : "pointer",
                      fontSize: 13,
                    }}
                  >
                    {deleting ? "Đang xoá..." : "Xoá phiếu"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs PART / MACHINE */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("PART")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border:
                  activeTab === "PART"
                    ? "1px solid #3182ce"
                    : "1px solid #cbd5e0",
                backgroundColor:
                  activeTab === "PART" ? "#ebf8ff" : "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Linh kiện (PART)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("MACHINE")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border:
                  activeTab === "MACHINE"
                    ? "1px solid #3182ce"
                    : "1px solid #cbd5e0",
                backgroundColor:
                  activeTab === "MACHINE" ? "#ebf8ff" : "#fff",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Máy (MACHINE)
            </button>
          </div>

          {/* Table lines */}
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              overflow: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ backgroundColor: "#f7fafc" }}>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Tên hàng</th>
                  <th style={thStyle}>ĐVT</th>
                  <th style={thStyle}>Tồn sổ</th>
                  <th style={thStyle}>Thực đếm</th>
                  <th style={thStyle}>Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {visibleLines.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, textAlign: "center" }}>
                      Không có dòng nào trong tab{" "}
                      {activeTab === "PART" ? "Linh kiện" : "Máy"}.
                    </td>
                  </tr>
                )}

                {visibleLines.map((line) => {
                  const inputValue =
                    editingValues[line.id] ??
                    (line.countedQty as any)?.toString?.() ??
                    "0";

                  return (
                    <tr key={line.id} style={{ borderTop: "1px solid #edf2f7" }}>
                      <td style={tdStyle}>{line.item?.sku || ""}</td>
                      <td style={tdStyle}>{line.item?.name || ""}</td>
                      <td style={tdStyle}>{line.item?.unit || ""}</td>
                      <td style={tdStyle}>{line.bookQty ?? "0"}</td>
                      <td style={tdStyle}>
                        <input
                          type="number"
                          value={inputValue}
                          disabled={data.status === "posted"}
                          onChange={(e) =>
                            setEditingValues((prev) => ({
                              ...prev,
                              [line.id]: e.target.value,
                            }))
                          }
                          onBlur={() => handleUpdateCountedQty(line)}
                          style={{
                            width: 100,
                            padding: "2px 4px",
                            borderRadius: 4,
                            border:
                              savingLineId === line.id
                                ? "1px solid #3182ce"
                                : "1px solid #cbd5e0",
                            fontSize: 13,
                          }}
                        />
                      </td>
                      <td style={tdStyle}>{renderDiff(line.diff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontSize: 13,
  fontWeight: 600,
  borderBottom: "1px solid #e2e8f0",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
};

export default StockCountDetailPage;
