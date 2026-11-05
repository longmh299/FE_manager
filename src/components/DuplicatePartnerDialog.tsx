// src/components/DuplicatePartnerDialog.tsx
// ✅ Trước khi tạo khách mới: báo khách đã có để dùng lại, tránh tạo trùng
import React from "react";

export type DupPartner = { id: string; code?: string | null; name: string; taxCode?: string | null; phone?: string | null; address?: string | null };
export type DupInfo = { taxMatches: DupPartner[]; phoneMatches: DupPartner[]; nameMatches: DupPartner[] };

const Row: React.FC<{ p: DupPartner; why: string; onUse: (p: DupPartner) => void }> = ({ p, why, onUse }) => (
  <li className="flex items-center justify-between gap-3 border-t border-slate-100 py-2">
    <div className="min-w-0 text-sm">
      <div className="font-medium text-slate-900">
        {p.code ? `${p.code} · ` : ""}
        {p.name}
      </div>
      <div className="text-xs text-slate-500">{[why, p.taxCode ? `MST ${p.taxCode}` : "", p.phone || "", p.address || ""].filter(Boolean).join(" · ")}</div>
    </div>
    <button type="button" onClick={() => onUse(p)} className="shrink-0 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800">
      Dùng khách này
    </button>
  </li>
);

const DuplicatePartnerDialog: React.FC<{
  info: DupInfo | null;
  onUse: (p: DupPartner) => void;
  onCreateAnyway: () => void;
  onClose: () => void;
}> = ({ info, onUse, onCreateAnyway, onClose }) => {
  if (!info) return null;
  const blocked = info.taxMatches.length > 0;
  return (
    <div role="dialog" aria-modal="true" aria-label="Khách có thể đã có" className="fixed inset-0 z-[100000] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl">
        <h2 className="text-lg font-semibold text-slate-900">{blocked ? "Mã số thuế này đã có khách" : "Khách này có thể đã có"}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {blocked ? "Không tạo mới được khi trùng mã số thuế. Hãy dùng khách đã có." : "Kiểm tra lại trước khi tạo mới. Nếu đúng là người khác thì vẫn tạo được."}
        </p>
        <ul className="mt-3">
          {info.taxMatches.map((p) => <Row key={p.id} p={p} why="Trùng MST" onUse={onUse} />)}
          {info.phoneMatches.map((p) => <Row key={p.id} p={p} why="Trùng SĐT" onUse={onUse} />)}
          {info.nameMatches.map((p) => <Row key={p.id} p={p} why="Tên gần giống" onUse={onUse} />)}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">
            Đóng
          </button>
          {!blocked && (
            <button type="button" onClick={onCreateAnyway} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Vẫn tạo khách mới
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DuplicatePartnerDialog;
