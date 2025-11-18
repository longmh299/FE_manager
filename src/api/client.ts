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
