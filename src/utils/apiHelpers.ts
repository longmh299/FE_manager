// src/utils/apiHelpers.ts
import axios from 'axios';

/**
 * Axios client dùng chung cho toàn bộ frontend
 */
const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api',
  withCredentials: true, // nếu bạn đang dùng cookie / auth
});

/**
 * Lấy base URL thô (dùng để mở link export Excel, v.v…)
 * Ví dụ: http://localhost:3000/api -> http://localhost:3000
 */
export function getApiBaseUrl() {
  const url = api.defaults.baseURL || '';
  // nếu baseURL của bạn đang là 'http://.../api' thì bỏ /api đi
  return url.replace(/\/api\/?$/, '');
}

/**
 * Helper bóc danh sách từ nhiều kiểu response khác nhau
 */
export function extractList<T = any>(raw: any): T[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.results)) return raw.results;
  return [];
}

export default api;
