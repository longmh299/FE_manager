// src/api/invoiceTrace.ts
import api from "./client";

export type InvoiceTraceType = "PURCHASE" | "SALES" | "PURCHASE_RETURN" | "SALES_RETURN";
export type InvoiceTraceStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";

export type InvoiceTraceRow = {
  lineId: string;
  invoiceId: string;
  invoiceCode: string;
  invoiceType: InvoiceTraceType;
  status: InvoiceTraceStatus;
  issueDate: string;
  partnerId: string | null;
  partnerName: string | null;
  saleUserId: string | null;
  saleUserName: string | null;

  itemId: string;
  itemSku: string | null;
  itemName: string | null;

  qty: number;
  price: number;
  amount: number;
  unitCost?: number | null;
  costTotal?: number | null;
};

export type InvoiceTraceParams = {
  code: string;
  type: InvoiceTraceType;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd
  status?: InvoiceTraceStatus | "";
  page?: number;
  pageSize?: number;
};

export type InvoiceTraceResult = {
  data: InvoiceTraceRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Truy xuất các dòng hóa đơn (nhập/xuất) có chứa sản phẩm theo mã.
 * BE: GET /api/invoice-trace
 */
export async function traceInvoicesByItemCode(
  params: InvoiceTraceParams
): Promise<InvoiceTraceResult> {
  const query: Record<string, any> = {
    code: params.code,
    type: params.type,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
  };
  if (params.from) query.from = params.from;
  if (params.to) query.to = params.to;
  if (params.status) query.status = params.status;

  const res = await api.get("/invoice-trace", { params: query });
  const payload = res?.data ?? {};

  return {
    data: Array.isArray(payload.data) ? payload.data : [],
    total: Number(payload.total) || 0,
    page: Number(payload.page) || params.page || 1,
    pageSize: Number(payload.pageSize) || params.pageSize || 20,
  };
}