// src/components/PartnerDepositBadge.tsx
// ✅ Trang khách: khách đang có tiền cọc chưa trừ vào hoá đơn
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

const money = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("vi-VN")} đ`;

const PartnerDepositBadge: React.FC<{ partnerId: string }> = ({ partnerId }) => {
  const [r, setR] = useState<{ rec: number; pay: number; n: number } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get("/deposits", { params: { partnerId } })
      .then((res) => {
        const items: Array<{ type: string; remaining: number }> = res.data?.items || [];
        const rec = items.filter((x) => x.type === "RECEIPT").reduce((s, x) => s + Number(x.remaining || 0), 0);
        const pay = items.filter((x) => x.type === "PAYMENT").reduce((s, x) => s + Number(x.remaining || 0), 0);
        if (alive) setR({ rec, pay, n: items.length });
      })
      .catch(() => alive && setR(null));
    return () => {
      alive = false;
    };
  }, [partnerId]);
  if (!r || r.n === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {r.rec > 0 && (
        <span className="mr-4">
          Khách đang có <b>{money(r.rec)}</b> tiền cọc chưa trừ vào hoá đơn.
        </span>
      )}
      {r.pay > 0 && (
        <span className="mr-4">
          Đã cọc cho nhà cung cấp này <b>{money(r.pay)}</b> chưa trừ.
        </span>
      )}
      <Link to="/deposits" className="text-sky-700 hover:underline">
        Xem
      </Link>
    </div>
  );
};

export default PartnerDepositBadge;
