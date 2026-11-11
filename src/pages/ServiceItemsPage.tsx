// src/pages/ServiceItemsPage.tsx
// ✅ Hàng dịch vụ (công sửa máy, công lắp đặt…)
//  - không quản tồn: bán trên hoá đơn bao nhiêu cũng được, không trừ kho, không có ở trang tồn / kiểm kê / đối soát
//  - có tính doanh thu, KHÔNG tính doanh số (sale + 0,5% kỹ thuật)
//  - kế toán / quản trị: thêm, sửa tên, sửa giá bán đề xuất, chuyển mã linh kiện có sẵn thành dịch vụ; quản trị xoá
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { ToastHost, useToast } from "../components/Toast";
import SellPriceCell from "../components/SellPriceCell";
import DeleteItemDialog, { type DeleteItemTarget } from "../components/DeleteItemDialog";
import { useAuth } from "../context/AuthContext";

type Unit = { id: string; code?: string; name?: string };
type Row = {
  id: string;
  sku: string;
  name: string;
  sellPrice: number | null;
  sellPriceUpdatedAt?: string | null;
  unit?: Unit | null;
  lineCount: number;
};
type Found = { id: string; sku: string; name: string; kind?: string; stockQty?: number };

const errMsg = (e: unknown, fb: string) => {
  const x = e as { response?: { data?: { message?: string } }; message?: string };
  return x?.response?.data?.message || x?.message || fb;
};
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
const unitLabel = (u?: Unit | null) => u?.name || u?.code || "";

const ServiceItemsPage: React.FC = () => {
  const { toasts, push, remove } = useToast();
  const { user } = useAuth();
  const isAdmin = String(user?.role || "").toLowerCase() === "admin";

  const [rows, setRows] = useState<Row[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // thêm mới
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  // sửa tên
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editSku, setEditSku] = useState("");

  // chuyển mã có sẵn thành dịch vụ
  const [convQ, setConvQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [busyId, setBusyId] = useState("");

  const [delTarget, setDelTarget] = useState<DeleteItemTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/items/services");
      setRows(Array.isArray(r.data?.data) ? r.data.data : []);
    } catch (e) {
      push({ type: "error", title: "Lỗi", message: errMsg(e, "Không tải được danh sách dịch vụ.") });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    api
      .get("/items/units")
      .then((r) => {
        const list: Unit[] = Array.isArray(r.data?.data) ? r.data.data : [];
        setUnits(list);
        const lan = list.find((u) => /^l[aầ]n$/i.test(String(u.name || u.code || "").trim()));
        setUnitId((cur) => cur || lan?.id || list[0]?.id || "");
      })
      .catch(() => undefined);
  }, [load]);

  // tìm mã linh kiện có sẵn để chuyển thành dịch vụ
  useEffect(() => {
    const term = convQ.trim();
    if (term.length < 2) {
      setFound([]);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .get("/items", { params: { q: term, pageSize: 10 } })
        .then((r) => {
          const list: Found[] = Array.isArray(r.data?.data) ? r.data.data : [];
          setFound(list.filter((x) => String(x.kind || "").toUpperCase() !== "SERVICE"));
        })
        .catch(() => setFound([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [convQ]);

  const shown = useMemo(() => {
    const t = plain(q.trim());
    return t ? rows.filter((r) => plain(`${r.sku} ${r.name}`).includes(t)) : rows;
  }, [rows, q]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return push({ type: "error", title: "Thiếu tên", message: "Nhập tên dịch vụ, VD: Công sửa máy." });
    setSaving(true);
    try {
      const digits = price.replace(/[^\d]/g, "");
      await api.post("/items", {
        name: n,
        sku: sku.trim() || undefined,
        unitId: unitId || undefined,
        kind: "SERVICE",
        sellPrice: digits ? Number(digits) : 0,
      });
      push({ type: "success", title: "Đã thêm", message: `Dịch vụ "${n}". Chọn được ngay trên hoá đơn bán.` });
      setName("");
      setSku("");
      setPrice("");
      await load();
    } catch (e2) {
      push({ type: "error", title: "Chưa thêm được", message: errMsg(e2, "Thử lại sau.") });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (r: Row) => {
    const n = editName.trim();
    if (!n) return push({ type: "error", title: "Thiếu tên", message: "Tên dịch vụ không được để trống." });
    setBusyId(r.id);
    try {
      await api.put(`/items/${r.id}`, { name: n, sku: editSku.trim() || r.sku });
      setEditId("");
      await load();
    } catch (e) {
      push({ type: "error", title: "Chưa lưu được", message: errMsg(e, "Thử lại sau.") });
    } finally {
      setBusyId("");
    }
  };

  const convert = async (f: Found) => {
    setBusyId(f.id);
    try {
      await api.put(`/items/${f.id}`, { kind: "SERVICE" });
      push({ type: "success", title: "Đã chuyển", message: `"${f.name}" giờ là hàng dịch vụ, không quản tồn.` });
      setConvQ("");
      setFound([]);
      await load();
    } catch (e) {
      push({ type: "error", title: "Chưa chuyển được", message: errMsg(e, "Thử lại sau.") });
    } finally {
      setBusyId("");
    }
  };

  const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

  return (
    <div className="p-4">
      <ToastHost toasts={toasts} onClose={remove} />
      <h1 className="text-xl font-semibold text-slate-900">Hàng dịch vụ</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">
        Công sửa máy, công lắp đặt… bán trên hoá đơn như hàng thường nhưng <b>không quản tồn</b> (không trừ kho, không có ở trang tồn, kiểm
        kê, đối soát). Tiền dịch vụ <b>có tính doanh thu</b>, <b>không tính doanh số</b> của sale và kỹ thuật.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <form onSubmit={add} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Thêm dịch vụ</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Tên dịch vụ *</span>
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Công sửa máy" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Mã (trống = tự sinh)</span>
              <input className={input} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="VD: DV-SUAMAY" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Đơn vị tính</span>
              <select className={input} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Giá bán đề xuất</span>
              <input
                className={`${input} text-right`}
                inputMode="numeric"
                value={price}
                onChange={(e) => {
                  const d = e.target.value.replace(/[^\d]/g, "");
                  setPrice(d ? Number(d).toLocaleString("vi-VN") : "");
                }}
                placeholder="0"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
              >
                {saving ? "Đang lưu…" : "Thêm dịch vụ"}
              </button>
            </div>
          </div>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Chuyển mã có sẵn thành dịch vụ</h2>
          <p className="mt-1 text-xs text-slate-500">
            Đã lỡ tạo "Công sửa máy" dạng linh kiện? Tìm rồi bấm Chuyển. Mã đang còn tồn phải điều chỉnh tồn về 0 trước.
          </p>
          <input className={`${input} mt-3`} value={convQ} onChange={(e) => setConvQ(e.target.value)} placeholder="Gõ mã hoặc tên…" />
          <div className="mt-2 divide-y divide-slate-100">
            {found.map((f) => (
              <div key={f.id} className="flex items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <b>{f.sku}</b> {f.name}
                  <div className="text-xs text-slate-500">
                    {String(f.kind || "").toUpperCase() === "MACHINE" ? "Máy" : "Linh kiện"} · tồn {Number(f.stockQty ?? 0).toLocaleString("vi-VN")}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyId === f.id}
                  onClick={() => convert(f)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Chuyển
                </button>
              </div>
            ))}
            {convQ.trim().length >= 2 && found.length === 0 && <div className="py-2 text-xs text-slate-500">Không thấy mã nào.</div>}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Danh sách ({rows.length})</h2>
        <input
          aria-label="Tìm dịch vụ"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã, tên…"
          className="ml-auto w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm sm:w-72"
        />
      </div>

      <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Mã</th>
              <th className="px-3 py-2">Tên dịch vụ</th>
              <th className="px-3 py-2">ĐVT</th>
              <th className="px-3 py-2 text-right">Giá bán đề xuất</th>
              <th className="px-3 py-2 text-right">Đã dùng</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  Đang tải...
                </td>
              </tr>
            )}
            {!loading && shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  {rows.length ? "Không có dịch vụ khớp." : "Chưa có dịch vụ nào. Thêm ở ô phía trên."}
                </td>
              </tr>
            )}
            {!loading &&
              shown.map((r) => {
                const editing = editId === r.id;
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-middle">
                    <td className="px-3 py-2.5 font-medium">
                      {editing ? <input className={input} value={editSku} onChange={(e) => setEditSku(e.target.value)} /> : r.sku}
                    </td>
                    <td className="px-3 py-2.5">
                      {editing ? (
                        <input
                          className={input}
                          value={editName}
                          autoFocus
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit(r);
                            if (e.key === "Escape") setEditId("");
                          }}
                        />
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{unitLabel(r.unit)}</td>
                    <td className="px-3 py-2.5">
                      <SellPriceCell
                        itemId={r.id}
                        value={r.sellPrice}
                        updatedAt={r.sellPriceUpdatedAt}
                        canEdit
                        onSaved={(p, at) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, sellPrice: p, sellPriceUpdatedAt: at } : x)))}
                        onError={(m) => push({ type: "error", title: "Lỗi", message: m })}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.lineCount ? `${r.lineCount} dòng HĐ` : "Chưa"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => saveEdit(r)}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
                          >
                            Lưu
                          </button>
                          <button type="button" onClick={() => setEditId("")} className="ml-1 rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100">
                            Huỷ
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditId(r.id);
                              setEditName(r.name);
                              setEditSku(r.sku);
                            }}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Sửa tên
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setDelTarget({ itemId: r.id, sku: r.sku, name: r.name })}
                              className="ml-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                            >
                              Xoá
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <DeleteItemDialog
        target={delTarget}
        onClose={() => setDelTarget(null)}
        onDeleted={(t) => {
          setDelTarget(null);
          setRows((prev) => prev.filter((x) => x.id !== t.itemId));
          push({ type: "success", title: "Đã xoá", message: `Dịch vụ ${t.sku || t.name}.` });
        }}
      />
    </div>
  );
};

export default ServiceItemsPage;