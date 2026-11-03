// src/utils/costDisplay.ts
/** Làm tròn giá vốn đến hàng đơn vị (không có số lẻ sau 1 đồng), CHỈ để hiển thị. Không dùng để tính hay lưu DB. */
export function roundCostDisplay(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) || 0; // "|| 0" để không ra -0
}