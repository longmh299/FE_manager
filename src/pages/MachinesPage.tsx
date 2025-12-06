// src/pages/MachinesPage.tsx
import React, { useEffect, useState } from "react";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Item } from "../types";

type Machine = {
  id: string;
  code: string;
  name: string;
  note?: string | null;
};

type MachinePartDto = {
  id: string; // id MachinePart
  itemId: string;
  qtyPerSet: number | null;
  note?: string | null;
  currentQty: number;
  item: Item | any;
};

type EditingMachine = {
  id?: string;
  code: string;
  name: string;
  note?: string;
};

type SearchItem = Item & { id: string };

const PAGE_SIZE = 40;

const MachinesPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = role === "admin";
  const canEdit = isAdmin; // chỉ admin được sửa/xóa/thêm

  const [machines, setMachines] = useState<Machine[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [parts, setParts] = useState<MachinePartDto[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [editing, setEditing] = useState<EditingMachine | null>(null);
  const [savingMachine, setSavingMachine] = useState(false);

  // Modal thêm linh kiện
  const [addingPart, setAddingPart] = useState(false);
  const [searchPartText, setSearchPartText] = useState("");
  const [searchPartResults, setSearchPartResults] = useState<SearchItem[]>([]);
  const [searchingParts, setSearchingParts] = useState(false);
  const [selectedPartItem, setSelectedPartItem] =
    useState<SearchItem | null>(null);
  const [qtyPerSet, setQtyPerSet] = useState<number | null>(1);
  const [savingPart, setSavingPart] = useState(false);

  const [syncing, setSyncing] = useState(false);

  // -------- LOAD LIST MACHINE ----------
  useEffect(() => {
    setPage(1); // reset về trang 1 khi đổi từ khóa
    loadMachines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (machines.length > 0) {
      const id = selectedId || machines[0].id;
      setSelectedId(id);
      loadMachineDetail(id);
    } else {
      setSelectedId(null);
      setSelectedMachine(null);
      setParts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines]);

  // đảm bảo page không vượt quá tổng trang khi list thay đổi
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(machines.length / PAGE_SIZE));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [machines.length, page]);

  async function loadMachines() {
    try {
      setLoadingMachines(true);
      const res = await api.get("/machines", {
        // backend vẫn trả tối đa nhiều máy, FE tự phân trang 40/mỗi trang
        params: { q, page: 1, pageSize: 1000 },
      });
      const body = res.data ?? res;
      const list: Machine[] = Array.isArray(body)
        ? body
        : Array.isArray(body.items)
        ? body.items
        : [];
      setMachines(list);
    } catch (err) {
      console.error("loadMachines error", err);
      setMachines([]);
    } finally {
      setLoadingMachines(false);
    }
  }

  // -------- LOAD DETAIL MACHINE ----------
  async function loadMachineDetail(id: string) {
    try {
      setLoadingDetail(true);
      const res = await api.get(`/machines/${id}`);
      const body = res.data ?? res;
      const data = body.data ?? body;
      setSelectedMachine(data.machine as Machine);
      setParts((data.parts || []) as MachinePartDto[]);
      setSelectedId(id);
    } catch (err) {
      console.error("loadMachineDetail error", err);
      setSelectedMachine(null);
      setParts([]);
    } finally {
      setLoadingDetail(false);
    }
  }

  // -------- ĐỒNG BỘ DÒNG MÁY TỪ ITEM ----------
  async function handleSyncMachines() {
    if (!canEdit) return;
    try {
      setSyncing(true);
      const res = await api.post("/machines/sync-from-items");
      const msg =
        res.data?.message ||
        `Đã đồng bộ dòng máy (syncedMachines = ${
          res.data?.syncedMachines ?? "?"
        })`;
      alert(msg);
      await loadMachines();
    } catch (err) {
      console.error("sync machines error", err);
      alert("Đồng bộ dòng máy thất bại, xem log console.");
    } finally {
      setSyncing(false);
    }
  }

  // -------- CRUD MACHINE ----------
  function openCreateMachine() {
    if (!canEdit) return;
    setEditing({ code: "", name: "", note: "" });
  }

  function openEditMachine(m: Machine) {
    if (!canEdit) return;
    setEditing({
      id: m.id,
      code: m.code,
      name: m.name,
      note: m.note || "",
    });
  }

  function closeMachineModal() {
    setEditing(null);
  }

  async function handleSaveMachine() {
    if (!canEdit) return;
    if (!editing) return;
    if (!editing.code.trim() || !editing.name.trim()) {
      alert("Mã dòng máy và Tên là bắt buộc.");
      return;
    }

    const payload = {
      code: editing.code.trim(),
      name: editing.name.trim(),
      note: editing.note?.trim() || undefined,
    };

    try {
      setSavingMachine(true);
      if (!editing.id) {
        const res = await api.post("/machines", payload);
        const created = (res.data?.data ?? res.data) as Machine;
        await loadMachines();
        setSelectedId(created.id);
        await loadMachineDetail(created.id);
      } else {
        await api.put(`/machines/${editing.id}`, payload);
        await loadMachines();
        if (selectedId === editing.id) {
          await loadMachineDetail(editing.id);
        }
      }
      closeMachineModal();
    } catch (err) {
      console.error("saveMachine error", err);
      alert("Lưu dòng máy thất bại, xem log console để debug.");
    } finally {
      setSavingMachine(false);
    }
  }

  async function handleDeleteMachine(m: Machine) {
    if (!canEdit) return;
    if (
      !window.confirm(
        `Xóa dòng máy "${m.code}"? Tất cả mapping linh kiện của dòng máy này sẽ bị xóa.`,
      )
    ) {
      return;
    }
    try {
      await api.delete(`/machines/${m.id}`);
      await loadMachines();
      if (selectedId === m.id) {
        setSelectedId(null);
        setSelectedMachine(null);
        setParts([]);
      }
    } catch (err) {
      console.error("deleteMachine error", err);
      alert("Xóa dòng máy thất bại, xem log console.");
    }
  }

  // -------- THÊM LINH KIỆN ----------
  function openAddPart() {
    if (!canEdit) return;
    setAddingPart(true);
    setSearchPartText("");
    setSearchPartResults([]);
    setSelectedPartItem(null);
    setQtyPerSet(1);
  }

  function closeAddPart() {
    setAddingPart(false);
  }

  async function handleSearchParts() {
    if (!searchPartText.trim()) {
      setSearchPartResults([]);
      return;
    }
    try {
      setSearchingParts(true);
      const res = await api.get("/items", {
        params: { q: searchPartText.trim(), page: 1, pageSize: 50 },
      });
      const body = res.data ?? res;
      const list: any[] = Array.isArray(body)
        ? body
        : Array.isArray(body.items)
        ? body.items
        : Array.isArray(body.data)
        ? body.data
        : [];
      const filtered = list.filter(
        (x) => !x.kind || x.kind === "PART" || x.kind === "LINHKIEN",
      );
      setSearchPartResults(filtered);
    } catch (err) {
      console.error("search parts error", err);
      setSearchPartResults([]);
    } finally {
      setSearchingParts(false);
    }
  }

  async function handleSavePart() {
    if (!canEdit) return;
    if (!selectedMachine) return;
    if (!selectedPartItem) {
      alert("Hãy chọn một linh kiện.");
      return;
    }

    try {
      setSavingPart(true);
      await api.post(`/machines/${selectedMachine.id}/parts`, {
        itemId: (selectedPartItem as any).id,
        qtyPerSet: qtyPerSet ?? null,
      });

      // cập nhật lại list linh kiện bên phải
      await loadMachineDetail(selectedMachine.id);

      // ❗ GIỮ MODAL MỞ – reset lựa chọn hiện tại để chọn tiếp
      setSelectedPartItem(null);
      setQtyPerSet(1);
      // searchPartText & searchPartResults giữ nguyên để không phải gõ lại
    } catch (err: any) {
      console.error("save part error", err);
      const msg =
        err?.response?.data?.error ||
        "Thêm linh kiện thất bại, xem log console.";
      alert(msg);
    } finally {
      setSavingPart(false);
    }
  }

  async function handleRemovePart(mp: MachinePartDto) {
    if (!canEdit) return;
    if (!selectedMachine) return;
    if (!window.confirm("Gỡ linh kiện này khỏi dòng máy?")) return;

    try {
      await api.delete(`/machines/${selectedMachine.id}/parts/${mp.id}`);
      await loadMachineDetail(selectedMachine.id);
    } catch (err) {
      console.error("delete part error", err);
      alert("Gỡ linh kiện thất bại, xem log console.");
    }
  }

  // --- tính toán phân trang list máy (cột trái)
  const totalPages = Math.max(1, Math.ceil(machines.length / PAGE_SIZE));
  const startIndex = (page - 1) * PAGE_SIZE;
  const pageMachines = machines.slice(startIndex, startIndex + PAGE_SIZE);

  // KHÔNG chặn xem trang nữa, staff/accountant vẫn xem list được

  return (
    <div className="p-6 h-full flex gap-4">
      {/* Cột trái: danh sách dòng máy */}
      <div className="w-1/3 border rounded bg-white flex flex-col">
        <div className="p-3 border-b flex items-center gap-2">
          <input
            className="flex-1 border rounded px-2 py-1 text-sm"
            placeholder="Tìm theo mã / tên dòng máy..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="px-3 py-1.5 rounded bg-gray-100 border text-xs"
            onClick={loadMachines}
            type="button"
          >
            Tìm
          </button>
        </div>
        <div className="p-3 border-b flex justify-between items-center">
          <div className="text-sm font-semibold">Dòng máy</div>
          {canEdit && (
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded border text-xs"
                onClick={handleSyncMachines}
                disabled={syncing}
                type="button"
              >
                {syncing ? "Đang đồng bộ..." : "Đồng bộ dòng máy"}
              </button>
              <button
                className="px-3 py-1.5 rounded bg-green-600 text-white text-xs"
                onClick={openCreateMachine}
                type="button"
              >
                + Thêm dòng máy
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {loadingMachines && (
            <div className="p-3 text-xs text-gray-500">Đang tải...</div>
          )}
          {!loadingMachines && machines.length === 0 && (
            <div className="p-3 text-xs text-gray-500">
              Chưa có dòng máy nào. Thử bấm “Đồng bộ dòng máy” hoặc import lại
              Excel.
            </div>
          )}
          {!loadingMachines &&
            pageMachines.map((m) => (
              <div
                key={m.id}
                className={`px-3 py-2 text-sm border-b cursor-pointer flex justify-between items-center ${
                  selectedId === m.id ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
                onClick={() => loadMachineDetail(m.id)}
              >
                <div>
                  {/* Tên máy ở trên, to & đậm */}
                  <div className="font-semibold text-sm">{m.name}</div>
                  {/* Mã máy ở dưới, nhỏ & xám */}
                  <div className="text-[11px] text-gray-500">{m.code}</div>
                </div>
                {canEdit && (
                  <button
                    className="text-xs text-blue-600 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditMachine(m);
                    }}
                    type="button"
                  >
                    Sửa
                  </button>
                )}
              </div>
            ))}
        </div>

        {/* Pagination cột dòng máy */}
        {machines.length > 0 && (
          <div className="px-3 py-2 border-t flex items-center justify-between text-xs bg-gray-50">
            <div>
              Trang {page}/{totalPages} • {machines.length} dòng máy
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="px-2 py-1 border rounded disabled:opacity-40"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {"<"}
              </button>
              <button
                type="button"
                className="px-2 py-1 border rounded disabled:opacity-40"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {">"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cột phải: chi tiết dòng máy + linh kiện */}
      <div className="flex-1 border rounded bg-white flex flex-col">
        <div className="p-3 border-b flex justify-between items-center">
          <div>
            {/* Tên máy to, đậm ở trên */}
            <div className="text-base font-semibold">
              {selectedMachine
                ? selectedMachine.name
                : "Chưa chọn dòng máy"}
            </div>
            {selectedMachine && (
              <div className="text-xs text-gray-600">
                Mã: {selectedMachine.code}
              </div>
            )}
          </div>
          {selectedMachine && canEdit && (
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded border text-xs"
                onClick={() => openEditMachine(selectedMachine)}
                type="button"
              >
                Sửa thông tin
              </button>
              <button
                className="px-3 py-1.5 rounded border text-xs text-red-600"
                onClick={() => handleDeleteMachine(selectedMachine)}
                type="button"
              >
                Xóa dòng máy
              </button>
            </div>
          )}
        </div>

        {!selectedMachine && (
          <div className="p-4 text-xs text-gray-500">
            Hãy chọn một dòng máy bên trái để xem linh kiện.
          </div>
        )}

        {selectedMachine && (
          <>
            <div className="p-3 border-b flex justify-between items-center">
              <div className="text-sm font-semibold">
                Linh kiện của dòng máy
              </div>
              {canEdit && (
                <button
                  className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs"
                  onClick={openAddPart}
                  type="button"
                >
                  + Thêm linh kiện
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto">
              {loadingDetail && (
                <div className="p-3 text-xs text-gray-500">
                  Đang tải chi tiết dòng máy...
                </div>
              )}
              {!loadingDetail && parts.length === 0 && (
                <div className="p-3 text-xs text-gray-500">
                  Chưa cấu hình linh kiện cho dòng máy này.
                </div>
              )}
              {!loadingDetail && parts.length > 0 && (
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">Tên linh kiện</th>
                      <th className="px-3 py-2 text-right">SL/BOM</th>
                      <th className="px-3 py-2 text-right">Tồn hiện tại</th>
                      <th className="px-3 py-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p) => {
                      const item = p.item || {};
                      return (
                        <tr key={p.id} className="border-t">
                          <td className="px-3 py-1.5">{item.sku}</td>
                          <td className="px-3 py-1.5">{item.name}</td>
                          <td className="px-3 py-1.5 text-right">
                            {p.qtyPerSet ?? "-"}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {p.currentQty.toLocaleString()}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {canEdit ? (
                              <button
                                className="text-xs text-red-600 hover:underline"
                                onClick={() => handleRemovePart(p)}
                                type="button"
                              >
                                Gỡ
                              </button>
                            ) : (
                              <span className="text-[11px] text-gray-400">
                                Chỉ xem
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal thêm / sửa dòng máy */}
      {editing && canEdit && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
            <h2 className="text-base font-semibold mb-4">
              {editing.id ? "Sửa dòng máy" : "Thêm dòng máy"}
            </h2>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium mb-1">
                  Mã dòng máy
                </label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={editing.code}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, code: e.target.value } : prev,
                    )
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Tên dòng máy
                </label>
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  value={editing.name}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, name: e.target.value } : prev,
                    )
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Ghi chú
                </label>
                <textarea
                  className="w-full border rounded px-2 py-1 text-sm"
                  rows={3}
                  value={editing.note ?? ""}
                  onChange={(e) =>
                    setEditing((prev) =>
                      prev ? { ...prev, note: e.target.value } : prev,
                    )
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 rounded border text-sm"
                onClick={closeMachineModal}
                type="button"
              >
                Hủy
              </button>
              <button
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-60"
                disabled={savingMachine}
                onClick={handleSaveMachine}
                type="button"
              >
                {savingMachine ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal thêm linh kiện */}
      {addingPart && selectedMachine && canEdit && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl p-6">
            <h2 className="text-base font-semibold mb-4">
              Thêm linh kiện cho dòng máy {selectedMachine.code}
            </h2>

            <div className="mb-3">
              <label className="block text-xs font-medium mb-1">
                Tìm linh kiện (gõ mã / tên)
              </label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  value={searchPartText}
                  onChange={(e) => setSearchPartText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearchParts();
                    }
                  }}
                />
                <button
                  className="px-3 py-1.5 rounded border text-xs"
                  onClick={handleSearchParts}
                  type="button"
                >
                  {searchingParts ? "Đang tìm..." : "Tìm"}
                </button>
              </div>
            </div>

            <div className="mb-3 max-h-52 overflow-auto border rounded">
              {searchPartResults.length === 0 && !searchingParts && (
                <div className="p-2 text-xs text-gray-500">
                  Gõ từ khóa và bấm Tìm để hiện danh sách linh kiện.
                </div>
              )}
              {searchPartResults.map((it) => (
                <div
                  key={(it as any).id}
                  className={`px-2 py-1 text-xs border-b cursor-pointer ${
                    selectedPartItem &&
                    (selectedPartItem as any).id === (it as any).id
                      ? "bg-blue-50"
                      : "hover:bg-gray-50"
                  }`}
                  onClick={() => setSelectedPartItem(it)}
                >
                  <div className="font-medium">
                    {(it as any).sku} - {(it as any).name}
                  </div>
                  {((it as any).kind || (it as any).unit) && (
                    <div className="text-[11px] text-gray-500">
                      {((it as any).kind && `Loại: ${(it as any).kind}`) || ""}{" "}
                      {((it as any).unit &&
                        ` | ĐVT: ${(it as any).unit}`) || ""}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mb-4 flex gap-4 items-center">
              <div className="flex-1 text-xs">
                <div className="font-medium mb-1">Linh kiện đã chọn:</div>
                {selectedPartItem ? (
                  <div>
                    <div className="font-semibold text-sm">
                      {(selectedPartItem as any).sku} -{" "}
                      {(selectedPartItem as any).name}
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500">
                    Chưa chọn linh kiện. Bấm vào danh sách ở trên để chọn.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  SL/BOM (mỗi máy cần)
                </label>
                <input
                  type="number"
                  min={1}
                  className="w-24 border rounded px-2 py-1 text-sm"
                  value={qtyPerSet ?? ""}
                  onChange={(e) =>
                    setQtyPerSet(
                      e.target.value ? Number(e.target.value) || 1 : null,
                    )
                  }
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 rounded border text-sm"
                onClick={closeAddPart}
                type="button"
              >
                Hủy
              </button>
              <button
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-60"
                disabled={savingPart}
                onClick={handleSavePart}
                type="button"
              >
                {savingPart ? "Đang lưu..." : "Lưu linh kiện"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MachinesPage;
