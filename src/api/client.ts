// src/api/client.ts
import axios from "axios";

// Base URL dùng chung cho mọi API
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";

// Tạo instance axios dùng chung
const api = axios.create({
  baseURL: API_BASE_URL,
  // KHÔNG dùng withCredentials ở đây để tránh lỗi CORS
  // withCredentials: true,
});

// Gắn token (nếu có) vào header
api.interceptors.request.use((config) => {
  const token =
    localStorage.getItem("token") || sessionStorage.getItem("token");

  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * ✅ Ngày chứng từ bị khoá (đã chốt sổ / quá hạn 7–90 ngày): báo bằng hộp thông báo giữa màn hình
 *    (DateLockedAlert trong Layout nghe sự kiện "date-locked"), ở MỌI trang, không cần sửa từng nơi.
 *    Câu lỗi gốc rút gọn lại để toast / dòng đỏ của từng trang không lặp nguyên đoạn dài.
 */
const LOCK_RE = /đã chốt sổ|quá hạn chỉnh sửa/i;
api.interceptors.response.use(
  (res) => res,
  (error) => {
    // ✅ phiên hết hạn / token bị thu hồi giữa chừng: về trang đăng nhập (trừ chính lời gọi đăng nhập)
    const isLoginCall = String(error?.config?.url || "").includes("/auth/login");
    if (error?.response?.status === 401 && !isLoginCall && window.location.pathname !== "/login") {
      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
      window.location.assign("/login");
      return new Promise(() => {}); // đang chuyển trang, không để màn hình báo lỗi thêm
    }

    const data = error?.response?.data;
    const msg = typeof data?.message === "string" ? data.message : "";
    if (msg && LOCK_RE.test(msg)) {
      const kind = /đã chốt sổ/i.test(msg) ? "closed" : "rolling";
      try {
        window.dispatchEvent(new CustomEvent("date-locked", { detail: { message: msg, kind } }));
      } catch {}
      data.message = kind === "closed" ? "Ngày chứng từ nằm trong kỳ đã chốt sổ." : "Chứng từ đã quá hạn chỉnh sửa.";
      data.lockedMessage = msg;
    }
    return Promise.reject(error);
  }
);

/**
 * ✅ Gửi POST có chống ghi trùng: nếu mạng lỗi không biết server đã lưu chưa, bấm lại cùng nội dung
 * sẽ dùng lại khoá cũ và server trả kết quả lần đầu thay vì ghi thêm. Có phản hồi từ server thì khoá hết tác dụng.
 */
const pendingIdemKeys = new Map<string, string>();
export async function postOnce(url: string, body: any) {
  const fp = `${url}:${JSON.stringify(body)}`;
  const key = pendingIdemKeys.get(fp) ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  pendingIdemKeys.set(fp, key);
  try {
    const res = await api.post(url, body, { headers: { "Idempotency-Key": key } });
    pendingIdemKeys.delete(fp);
    return res;
  } catch (e: any) {
    if (e?.response) pendingIdemKeys.delete(fp); // server đã trả lời: lần sau là yêu cầu mới
    throw e;
  }
}

/**
 * Lấy base URL gốc (để mở link export Excel, v.v…)
 * Ví dụ: http://localhost:3000/api -> http://localhost:3000
 */
export function getApiBaseUrl() {
  return API_BASE_URL.replace(/\/api\/?$/, "");
}

/**
 * Helper bóc mảng từ nhiều kiểu response khác nhau
 */
export function extractList<T = any>(raw: any): T[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.results)) return raw.results;
  return [];
}

export default api; // cho import api from "../api/client"
export { api };    // cho chỗ nào đang import { api } from "../api/client"
