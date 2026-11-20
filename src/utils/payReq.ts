// ✅ Yêu cầu thu cọc (chưa có hoá đơn): BE trả invoice = null -> điền chỗ trống để màn hình cũ không lỗi
type AnyReq = { invoice?: unknown; isDeposit?: boolean; partner?: { name?: string } | null };

export function normPayReqs<T>(arr: unknown): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r: AnyReq) =>
    r && !r.invoice
      ? {
          ...r,
          isDeposit: true,
          invoice: {
            id: "",
            code: "",
            issueDate: null,
            customerName: r.partner?.name || "Khách",
            customerPhone: null,
            approved: true,
            returned: false,
            settled: false,
          },
        }
      : r
  ) as T[];
}
