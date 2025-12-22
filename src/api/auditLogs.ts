// src/api/auditLogs.ts
import api from "./client";

/** ================= TYPES ================= */

export type AuditUser = {
  // ✅ backend có thể select thiếu id -> để optional cho khỏi lỗi
  id?: string;
  username: string;
  role: string;
};

export type AuditLogRow = {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;

  // ✅ nếu backend có lưu userId thẳng trên AuditLog thì vẫn hiển thị được
  userId?: string | null;

  before?: any;
  after?: any;
  meta?: any;

  createdAt: string;

  user?: AuditUser | null;
};

export type ListAuditLogsResp = {
  total: number;
  page: number;
  pageSize: number;
  rows: AuditLogRow[];
};

/** ================= API ================= */

export type ListAuditLogsParams = {
  q?: string;
  entity?: string;
  entityId?: string;
  action?: string;

  // ✅ filter theo username (UI bạn dùng username)
  username?: string;

  // ✅ giữ lại nếu sau này cần filter theo id
  userId?: string;

  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  page?: number;
  pageSize?: number;
};

export async function listAuditLogs(params?: ListAuditLogsParams) {
  // ✅ tương thích nhiều kiểu backend:
  // - có thể backend dùng query "user" hoặc "username"
  // - nên gửi cả 2 để khỏi lệch
  const queryParams: any = { ...(params || {}) };

  if (params?.username) {
    queryParams.username = params.username;
    queryParams.user = params.username; // fallback nếu BE đang dùng key "user"
  }

  const res = await api.get<ListAuditLogsResp>("/audit-logs", { params: queryParams });
  return res.data;
}

export async function getAuditLogById(id: string) {
  const res = await api.get<AuditLogRow>(`/audit-logs/${id}`);
  return res.data;
}
