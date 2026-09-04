// src/api/analytics.ts
import api from "./client";

export type AnalyticsTotals = {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  screenPageViews: number;
  avgSessionDurationSec: number;
  engagementRate: number; // 0..1
};

export type AnalyticsOverview = {
  range: { from: string; to: string };
  totals: AnalyticsTotals;
  previousTotals: AnalyticsTotals | null;
  changes: Record<string, number | null> | null;
  timeseries: Array<{
    date: string;
    activeUsers: number;
    sessions: number;
    screenPageViews: number;
  }>;
  topPages: Array<{ path: string; title: string; views: number; users: number }>;
  sources: Array<{ channel: string; sessions: number; users: number }>;
  devices: Array<{ device: string; users: number }>;
};

export async function fetchAnalyticsOverview(params: {
  from: string;
  to: string;
  compare?: boolean;
}): Promise<AnalyticsOverview> {
  const res = await api.get("/analytics/overview", {
    params: {
      from: params.from,
      to: params.to,
      compare: params.compare ? 1 : undefined,
    },
  });
  return res.data.data as AnalyticsOverview;
}