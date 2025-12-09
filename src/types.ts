// src/types.ts
export type UserRole = "staff" | "accountant" | "admin" | string;

export interface User {
  id: string;
  username: string;
  fullName?: string | null;
  role: UserRole;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface StockSummaryByItem {
  itemId: string;
  sku: string;
  name: string;
  kind?: "part" | "machine" | string;
  totalQty: number;
  unit: string;
}

// Thêm kiểu Item để CRUD danh mục hàng hóa
export interface Item {
  id: string;
  sku: string;
  name: string;
  kind?: "part" | "machine" | string;
  unit: string;
  price?: number;
  note?: string | null;
}

export interface Invoice {
  id: string;
  refNo: string;
  type: string;
  date: string;

  customerName?: string | null;

  saleUserId?: string | null;
  saleUserName?: string | null;

  techUserId?: string | null;
  techUserName?: string | null;

  totalAmount: number;
  status: string;
}

export interface Partner {
  id: string;
  name: string;
  taxCode?: string | null;
  phone?: string | null;
  address?: string | null;
  code?: string;      // <--- thêm mã KH

}

// types.ts
export interface InvoiceForm {
  code: string;
  issueDate: string;

  partnerId: string | null;
  partnerName: string;
  partnerPhone: string;
  partnerEmail: string;
  partnerTax: string;
  partnerAddr: string;

  note: string;
}

// ================== Revenue types (THÊM MỚI) ==================

export interface RevenueUserStat {
  userId: string;
  username: string;
  fullName?: string | null;
  totalRevenue: number;
  invoiceCount: number;
}

export interface RevenueProductStat {
  itemId: string;
  sku: string | null;
  name: string | null;
  qty: number;
  revenue: number;
}

export interface RevenueSummary {
  from: string;
  to: string;
  currency: string;
  totalRevenue: number;
  invoiceCount: number;
  bySaleUser: RevenueUserStat[];
  byTechUser: RevenueUserStat[];
  topProducts: RevenueProductStat[];
}

// Invoice dùng riêng cho màn thống kê (từ API /invoices trong khoảng thời gian)
export interface RevenueInvoice {
  id: string;
  code: string;
  issueDate: string;
  total: number;
  partnerName?: string | null;
  saleUserName?: string | null;
  techUserName?: string | null;
}
