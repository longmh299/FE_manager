// src/pages/PurchaseReturnsPage.tsx
import  { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

type InvoiceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

type InvoiceListItem = {
  id: string;
  code: string;
  issueDate?: string;
  partnerName?: string | null;
  total: number;
  status: InvoiceStatus;
};

function formatDateDisplay(raw?: string) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatMoney(n: number) {
  const v = Number(n || 0);
  return v.toLocaleString("vi-VN");
}

async function fetchMeRole(): Promise<string | null> {
  try {
    const r = await api.get("/auth/me");
    return r?.data?.role ?? r?.data?.user?.role ?? null;
  } catch {
    return null;
  }
}

export default function PurchaseReturnsPage() {
  const nav = useNavigate();

  const [role, setRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | InvoiceStatus>("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<InvoiceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  useEffect(() => {
    (async () => {
      setLoadingRole(true);
      const r = await fetchMeRole();
      setRole(r);
      setLoadingRole(false);
      if (r !== "admin") {
        // admin-only
        nav("/", { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params: any = {
        q: q || undefined,
        page,
        pageSize,
        type: "PURCHASE_RETURN",
        status: status || undefined,
      };
      const res = await api.get("/invoices", { params });
      const data = res.data?.data ?? [];
      setRows(
        data.map((x: any) => ({
          id: String(x.id),
          code: String(x.code),
          issueDate: x.issueDate,
          partnerName: x.partnerName ?? "",
          total: Number(x.total ?? 0),
          status: x.status as InvoiceStatus,
        }))
      );
      setTotal(Number(res.data?.total ?? 0));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (role === "admin") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, page, status]);

  async function actSubmit(id: string) {
    await api.post(`/invoices/${id}/submit`);
    await load();
  }

  async function actRecall(id: string) {
    await api.post(`/invoices/${id}/recall`);
    await load();
  }

  async function actApprove(id: string) {
    await api.post(`/invoices/${id}/approve`, {}); // warehouseId optional
    await load();
  }

  async function actReject(id: string) {
    const reason = window.prompt("Lý do từ chối (tuỳ chọn):", "");
    await api.post(`/invoices/${id}/reject`, reason ? { reason } : {});
    await load();
  }

  async function actDelete(id: string) {
    const ok = window.confirm("Xoá phiếu này? (chỉ xoá được khi chưa duyệt)");
    if (!ok) return;
    await api.delete(`/invoices/${id}`);
    await load();
  }

  if (loadingRole) return <div style={{ padding: 16 }}>Đang kiểm tra quyền…</div>;
  if (role !== "admin") return null;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Xuất trả NCC</h2>
        <button onClick={() => nav("/purchase-returns/new")}>+ Tạo phiếu xuất trả</button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã / đối tác..."
          style={{ minWidth: 260, padding: "6px 8px" }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ padding: "6px 8px" }}>
          <option value="">Tất cả trạng thái</option>
          <option value="DRAFT">Nháp</option>
          <option value="SUBMITTED">Chờ duyệt</option>
          <option value="APPROVED">Đã duyệt</option>
          <option value="REJECTED">Từ chối</option>
        </select>
        <button
          onClick={() => {
            setPage(1);
            load();
          }}
          disabled={loading}
        >
          Tìm
        </button>
      </div>

      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "#fafafa" }}>
            <tr>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Mã</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Ngày</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Nhà cung cấp</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Tổng</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>Trạng thái</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 360 }}>
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 12 }}>
                  Đang tải…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12 }}>
                  Không có dữ liệu.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{r.code}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{formatDateDisplay(r.issueDate)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{r.partnerName || ""}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "right" }}>
                    {formatMoney(r.total)}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "center" }}>{r.status}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                      <button onClick={() => nav(`/purchase-returns/${r.id}`)}>Xem/Sửa</button>

                      {r.status === "DRAFT" && (
                        <>
                          <button onClick={() => actSubmit(r.id)}>Gửi duyệt</button>
                          <button onClick={() => actDelete(r.id)}>Xoá</button>
                        </>
                      )}

                      {r.status === "SUBMITTED" && (
                        <>
                          <button onClick={() => actApprove(r.id)}>Duyệt</button>
                          <button onClick={() => actReject(r.id)}>Từ chối</button>
                          <button onClick={() => actRecall(r.id)}>Hủy gửi duyệt</button>
                        </>
                      )}

                      {r.status === "REJECTED" && (
                        <>
                          <button onClick={() => actDelete(r.id)}>Xoá</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          Trang {page}/{totalPages} — Tổng: {total}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Trước
          </button>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Sau →
          </button>
        </div>
      </div>
    </div>
  );
}
