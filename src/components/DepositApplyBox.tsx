// src/components/DepositApplyBox.tsx
// ✅ Trên hoá đơn: khách / NCC còn tiền cọc thì hiện để trừ vào hoá đơn.
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { postOnce } from "../api/client";

type Dep = { id: string; code: string | null; date: string; remaining: number; note: string | null };

const money = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("vi-VN")} đ`;
const viDate = (s: string) => new Date(s).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

const DepositApplyBox: React.FC<{
  invoiceId: string;
  invoiceType: string; // SALES | PURCHASE
  partnerId?: string;
  status?: string;
  debtNow: number;
  canManage: boolean;
  onApplied: () => void | Promise<void>;
  // ✅ hoá đơn nháp / lập mới: chọn trước khoản cọc, tự trừ lúc bấm Gửi duyệt
  onPlanChange?: (plan: Array<{ depositId: string; amount: number }>) => void;
}> = ({ invoiceId, invoiceType, partnerId, status, debtNow, canManage, onApplied, onPlanChange }) => {
  const [plan, setPlan] = useState<Record<string, boolean>>({});
  const [deps, setDeps] = useState<Dep[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [amt, setAmt] = useState<Record<string, string>>({});

  const okType = invoiceType === "SALES" || invoiceType === "PURCHASE";
  const okStatus = status === "APPROVED" || status === "SUBMITTED";
  const depType = invoiceType === "SALES" ? "RECEIPT" : "PAYMENT";

  const load = useCallback(async () => {
    if (!partnerId || !okType) return setDeps([]);
    try {
      const r = (await api.get("/deposits", { params: { partnerId, type: depType } })).data;
      setDeps(Array.isArray(r?.items) ? r.items : []);
    } catch {
      setDeps([]);
    }
  }, [partnerId, okType, depType]);

  useEffect(() => {
    load();
  }, [load, invoiceId]);

  useEffect(() => {
    if (!onPlanChange) return;
    let left = Math.max(0, debtNow);
    const out: Array<{ depositId: string; amount: number }> = [];
    for (const d of deps) {
      if (!plan[d.id] || left <= 0) continue;
      const typed = amt[d.id] != null && amt[d.id] !== "" ? Number(String(amt[d.id]).replace(/[^\d]/g, "")) || 0 : null;
      const v = Math.min(typed ?? Number(d.remaining || 0), Number(d.remaining || 0), left);
      if (v > 0) {
        out.push({ depositId: d.id, amount: v });
        left -= v;
      }
    }
    onPlanChange(out);
  }, [plan, amt, deps, debtNow, onPlanChange]);

  if (!okType || deps.length === 0) return null;
  const total = deps.reduce((s, d) => s + Number(d.remaining || 0), 0);
  const isSales = invoiceType === "SALES";

  async function apply(d: Dep) {
    setErr(null);
    const def = Math.min(Number(d.remaining || 0), debtNow);
    const v = amt[d.id] != null ? Number(String(amt[d.id]).replace(/[^\d]/g, "")) || 0 : def;
    if (!(v > 0)) return setErr("Nhập số tiền trừ cọc.");
    setBusy(d.id);
    try {
      await postOnce(`/deposits/${d.id}/apply`, { invoiceId, amount: v });
      setAmt((m) => ({ ...m, [d.id]: "" }));
      await load();
      await onApplied();
    } catch (e: unknown) {
      const x = e as { response?: { data?: { message?: string } }; message?: string };
      setErr(x?.response?.data?.message || x?.message || "Không trừ được tiền cọc.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: "1px solid #fcd34d", background: "#fffbeb", borderRadius: 10, padding: "10px 12px", marginTop: 10, fontSize: 13.5 }}>
      <div style={{ fontWeight: 600, color: "#92400e" }}>
        {isSales ? "Khách" : "Nhà cung cấp"} đang có {money(total)} tiền cọc{" "}
        <Link to="/deposits" style={{ fontWeight: 400, fontSize: 12.5, marginLeft: 6 }}>
          xem
        </Link>
      </div>
      {!okStatus && !canManage && (
        <div style={{ color: "#92400e", marginTop: 4 }}>
          Gửi duyệt hoá đơn, admin / kế toán sẽ trừ tiền cọc lúc duyệt.
        </div>
      )}
      {!okStatus && canManage && (
        <>
          <div style={{ color: "#92400e", marginTop: 4 }}>Tick khoản cọc muốn trừ, web tự trừ khi bấm <b>Gửi duyệt</b>.</div>
          {deps.map((d) => (
            <label key={d.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={!!plan[d.id]} onChange={(e) => setPlan((m) => ({ ...m, [d.id]: e.target.checked }))} />
              <span style={{ minWidth: 200 }}>
                {d.code || "Phiếu cọc"} · {viDate(d.date)} · còn <b>{money(d.remaining)}</b>
                {d.note ? <span style={{ color: "#78716c" }}> · {d.note}</span> : null}
              </span>
              {plan[d.id] && (
                <input
                  inputMode="numeric"
                  placeholder={Math.round(Math.min(Number(d.remaining || 0), Math.max(0, debtNow))).toLocaleString("vi-VN")}
                  value={amt[d.id] ?? ""}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[^\d]/g, "")) || 0;
                    setAmt((m) => ({ ...m, [d.id]: n ? n.toLocaleString("vi-VN") : "" }));
                  }}
                  style={{ width: 130, padding: "4px 8px", border: "1px solid #d6d3d1", borderRadius: 6, textAlign: "right" }}
                />
              )}
            </label>
          ))}
        </>
      )}
      {okStatus && debtNow <= 0 && <div style={{ color: "#92400e", marginTop: 4 }}>Hoá đơn đã thu đủ.</div>}
      {okStatus && debtNow > 0 && canManage &&
        deps.map((d) => {
          const def = Math.min(Number(d.remaining || 0), debtNow);
          return (
            <div key={d.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ minWidth: 220 }}>
                {d.code || "Phiếu cọc"} · {viDate(d.date)} · còn <b>{money(d.remaining)}</b>
                {d.note ? <span style={{ color: "#78716c" }}> · {d.note}</span> : null}
              </span>
              <input
                inputMode="numeric"
                value={amt[d.id] ?? Math.round(def).toLocaleString("vi-VN")}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d]/g, "")) || 0;
                  setAmt((m) => ({ ...m, [d.id]: n ? n.toLocaleString("vi-VN") : "" }));
                }}
                style={{ width: 130, padding: "4px 8px", border: "1px solid #d6d3d1", borderRadius: 6, textAlign: "right" }}
              />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => apply(d)}
                style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: "#d97706", color: "#fff", fontWeight: 600, cursor: "pointer" }}
              >
                {busy === d.id ? "Đang trừ…" : "Trừ tiền cọc"}
              </button>
            </div>
          );
        })}
      {okStatus && debtNow > 0 && !canManage && <div style={{ color: "#92400e", marginTop: 4 }}>Nhờ admin / kế toán trừ tiền cọc vào hoá đơn này.</div>}
      {err && <div style={{ color: "#b91c1c", marginTop: 6 }}>{err}</div>}
    </div>
  );
};

export default DepositApplyBox;
