import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";

const CustomerDetailPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState<any>(null);
  const [activityModal, setActivityModal] = useState<any>(null);
  const [editModal, setEditModal] = useState<any>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null); // 🔥 NEW

  const fetchData = async () => {
    try {
      const res = await api.get(`/customers/${id}`);
      setData(res.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const submitActivity = async () => {
    try {
      await api.post(`/customers/${id}/activity`, activityModal);
      setActivityModal(null);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const openEdit = (field: string, value: string) => {
    setEditModal({
      field,
      value: value || "",
    });
  };

  const handleUpdateField = async () => {
    try {
      await api.put(`/customers/${id}`, {
        [editModal.field]: editModal.value,
      });

      setEditModal(null);
      fetchData();
    } catch (err) {
      alert("Update thất bại");
    }
  };

  if (!data) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 space-y-6 text-sm">
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">{data.name}</h2>
        <button
          onClick={() => navigate("/partners")}
          className="text-xs bg-black text-white px-3 py-1 rounded"
        >
          ← Quay lại
        </button>
      </div>

      {/* INFO */}
      <div className="bg-white p-4 rounded-xl shadow space-y-3">
        <div className="flex justify-between items-center">
          <div>
            📞{" "}
            <span className={!data.phone ? "text-red-500" : ""}>
              {data.phone || "Chưa có SĐT"}
            </span>
          </div>
          <button
            className="text-xs text-blue-600"
            onClick={() => openEdit("phone", data.phone)}
          >
            {data.phone ? "Sửa" : "Bổ sung"}
          </button>
        </div>

        <div className="flex justify-between items-center">
          <div>
            ✉️{" "}
            <span className={!data.email ? "text-red-500" : ""}>
              {data.email || "Chưa có email"}
            </span>
          </div>
          <button
            className="text-xs text-blue-600"
            onClick={() => openEdit("email", data.email)}
          >
            {data.email ? "Sửa" : "Bổ sung"}
          </button>
        </div>

        <div className="flex justify-between items-center">
          <div>🏢 {data.address || "-"}</div>
          <button
            className="text-xs text-blue-600"
            onClick={() => openEdit("address", data.address)}
          >
            Sửa
          </button>
        </div>

        <div className="flex justify-between items-center">
          <div>
            🧾 MST:{" "}
            <span className={!data.taxCode ? "text-red-500" : ""}>
              {data.taxCode || "Chưa có"}
            </span>
          </div>
          <button
            className="text-xs text-blue-600"
            onClick={() => openEdit("taxCode", data.taxCode)}
          >
            {data.taxCode ? "Sửa" : "Bổ sung"}
          </button>
        </div>
      </div>

      {/* MÁY */}
      <div className="bg-white p-4 rounded-xl shadow">
        <h3 className="font-semibold mb-2">Máy đang sử dụng</h3>

        {!data.invoices?.length && (
          <div className="text-gray-400">Chưa có dữ liệu</div>
        )}

        {data.invoices?.flatMap((inv: any) =>
          inv.lines?.map((line: any) => (
            <div key={line.id} className="border-b py-2">
              <div className="font-medium">
                {line.item?.name || "Không rõ máy"}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="bg-white p-4 rounded-xl shadow">
        <h3 className="font-semibold mb-3">Liên hệ nhanh</h3>

        {!data.phone ? (
          <div className="text-red-500 text-sm">
            ⚠️ Khách chưa có số điện thoại
          </div>
        ) : (
          <div className="flex gap-3">
            {/* CALL */}
            <a
              href={`tel:${data.phone}`}
              className="flex-1 text-center bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium"
            >
              📞 Gọi
            </a>

            {/* ZALO */}
            <a
              href={`https://zalo.me/${data.phone}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 text-center bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg text-sm font-medium"
            >
              💬 Zalo
            </a>
          </div>
        )}
      </div>
      {/* 🔥 LỊCH SỬ MUA (UPGRADE) */}
      <div className="bg-white p-4 rounded-xl shadow">
        <h3 className="font-semibold mb-2">Lịch sử mua</h3>

        {!data.invoices?.length && (
          <div className="text-gray-400">Chưa có hóa đơn</div>
        )}

        {data.invoices?.map((inv: any) => {
          const isOpen = openInvoiceId === inv.id;

          return (
            <div key={inv.id} className="border-b py-2">
              {/* HEADER */}
              <div
                className="flex justify-between cursor-pointer"
                onClick={() =>
                  setOpenInvoiceId(isOpen ? null : inv.id)
                }
              >
                <div>
                  <div className="font-medium">
                    {inv.code || "Hóa đơn"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(inv.issueDate).toLocaleDateString()}
                  </div>
                </div>

                <div className="font-semibold">
                  {Number(inv.total).toLocaleString("vi-VN")} đ
                </div>
              </div>

              {/* 🔥 EXPAND */}
              {isOpen && (
                <div className="mt-2 pl-3 border-l space-y-1 text-sm">
                  {inv.lines?.map((line: any) => (
                    <div
                      key={line.id}
                      className="flex justify-between"
                    >
                      <div>
                        {line.item?.name || "Không rõ máy"}
                      </div>

                      <div className="text-gray-500">
                        x{line.qty || 1}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* MODALS giữ nguyên */}
      {activityModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white p-4 rounded w-[320px]">
            <select
              value={activityModal.type}
              onChange={(e) =>
                setActivityModal({
                  ...activityModal,
                  type: e.target.value,
                })
              }
              className="w-full border mb-2"
            >
              <option value="CALL">Gọi</option>
              <option value="MESSAGE">Nhắn</option>
              <option value="VISIT">Gặp</option>
              <option value="NOTE">Ghi chú</option>
            </select>

            <textarea
              value={activityModal.content}
              onChange={(e) =>
                setActivityModal({
                  ...activityModal,
                  content: e.target.value,
                })
              }
              className="w-full border mb-2"
            />

            <button
              onClick={submitActivity}
              className="w-full bg-black text-white py-1"
            >
              Lưu
            </button>
          </div>
        </div>
      )}

      {editModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded-xl w-[320px] space-y-3">
            <h3 className="font-semibold capitalize">
              Sửa {editModal.field}
            </h3>

            <input
              value={editModal.value}
              onChange={(e) =>
                setEditModal({
                  ...editModal,
                  value: e.target.value,
                })
              }
              className="w-full border rounded px-3 py-2 text-sm"
            />

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 text-sm bg-gray-100 rounded"
                onClick={() => setEditModal(null)}
              >
                Huỷ
              </button>

              <button
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
                onClick={handleUpdateField}
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerDetailPage;