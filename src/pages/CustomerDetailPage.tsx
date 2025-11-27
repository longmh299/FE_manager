import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";

type InvoiceHistory = {
  id: string;
  code: string | null;
  issueDate: string;
  total: number;
};

type PartnerDetail = {
  id: string;
  name: string;
  taxCode?: string | null;
  phone?: string | null;
  address?: string | null;
  createdAt?: string;
  updatedAt?: string;
  invoices?: InvoiceHistory[];
};

const PartnerDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatDate = (d?: string) => {
    if (!d) return "-";
    return new Date(d).toLocaleString("vi-VN");
  };

  useEffect(() => {
    if (!id) return;

    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/partners/${id}`);
        // BE trả { ok, data }
        const partner: PartnerDetail = res.data?.data ?? res.data;
        setData(partner);
      } catch (err: any) {
        console.error("Fetch partner detail error", err);
        setError(
          err?.response?.data?.error ||
            err?.response?.data?.message ||
            "Không tải được thông tin khách hàng"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-700">
        Đang tải thông tin khách hàng...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm">
        <div className="mb-4 text-red-600">{error}</div>
        <button
          onClick={() => navigate("/partners")}
          className="px-4 py-2 rounded bg-slate-800 text-white text-xs"
        >
          ← Quay lại danh sách khách hàng
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-sm text-slate-700">
        Không tìm thấy dữ liệu khách hàng.
      </div>
    );
  }

  const invoices = data.invoices ?? [];

  return (
    <div className="p-6 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 mb-1">
            Thông tin khách hàng
          </h2>
          <p className="text-slate-500">
            Xem thông tin cơ bản và lịch sử hóa đơn của khách hàng.
          </p>
        </div>
        <button
          onClick={() => navigate("/partners")}
          className="px-4 py-2 rounded bg-slate-800 text-white text-xs"
        >
          ← Quay lại danh sách
        </button>
      </div>

      {/* Thông tin cơ bản */}
      <div className="bg-white rounded-lg shadow mb-6 p-4">
        <h3 className="font-semibold text-slate-800 mb-3 text-base">
          Thông tin cơ bản
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <div>
            <div className="text-slate-500">Tên khách hàng</div>
            <div className="font-medium text-slate-800">{data.name}</div>
          </div>
          <div>
            <div className="text-slate-500">Mã số thuế</div>
            <div className="font-medium text-slate-800">
              {data.taxCode || "-"}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Điện thoại</div>
            <div className="font-medium text-slate-800">
              {data.phone || "-"}
            </div>
          </div>
          <div>
            <div className="text-slate-500">Ngày tạo</div>
            <div className="font-medium text-slate-800">
              {formatDate(data.createdAt)}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-slate-500">Địa chỉ</div>
            <div className="font-medium text-slate-800">
              {data.address || "-"}
            </div>
          </div>
        </div>
      </div>

      {/* Lịch sử hóa đơn */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-slate-800 mb-3 text-base">
          Lịch sử mua hàng
        </h3>

        {invoices.length === 0 && (
          <div className="text-slate-500">
            Khách hàng này chưa có hóa đơn nào.
          </div>
        )}

        {invoices.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-600">
                  <th className="px-3 py-2 text-left font-medium">Mã HĐ</th>
                  <th className="px-3 py-2 text-left font-medium">Ngày HĐ</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Tổng tiền
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b last:border-b-0 hover:bg-slate-50"
                  >
                    <td className="px-3 py-2">{inv.code || `HD#${inv.id}`}</td>
                    <td className="px-3 py-2">
                      {formatDate(inv.issueDate as any)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {inv.total != null
                        ? inv.total.toLocaleString("vi-VN")
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default PartnerDetailPage;
