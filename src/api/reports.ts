// src/api/reports.ts
import api from "./client";
import type { RevenueSummary } from "../types";

export async function fetchRevenueSummary(params: {
  from?: string;
  to?: string;
}): Promise<RevenueSummary> {
  const res = await api.get("/reports/revenue", {
    params,
  });

  // BE trả về { ok, data }
  return res.data.data as RevenueSummary;
}
