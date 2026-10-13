// src/components/MachinePicker.tsx
// ✅ Ô "gõ tên máy" có gợi ý: gõ kiểu gì cũng được ("jl1000", "máy cắt rau JL-1000"...),
// BE dò ra đúng máy trong danh mục (GET /machine-videos/resolve-machine).
// Khi đã khớp -> hiện thẻ xanh "✓ JL-1000 – Máy cắt rau củ"; chưa khớp -> hiện gợi ý để bấm chọn.
import React, { useEffect, useRef, useState } from "react";
import api from "../api/client";

/** code = mã máy (vd "JL-1000") — BE lấy từ sku, hoặc từ tên máy nếu sku là mã tự sinh */
export type MachineRef = {
  id: string;
  sku: string;
  name: string;
  code: string;
  /** máy mới chưa có trong danh mục Item — người dùng tự xác nhận */
  isNew?: boolean;
};

type Props = {
  value: MachineRef | null;
  onChange: (m: MachineRef | null) => void;
  disabled?: boolean;
  /** gợi ý BE trả về khi init bị 422 (gõ sai) — đẩy vào để hiện cho người dùng chọn */
  externalSuggestions?: MachineRef[];
  autoFocus?: boolean;
};

const MachinePicker: React.FC<Props> = ({ value, onChange, disabled, externalSuggestions, autoFocus }) => {
  const [text, setText] = useState(value ? value.code : "");
  const [suggestions, setSuggestions] = useState<MachineRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const reqId = useRef(0);

  // Đồng bộ khi form được reset từ bên ngoài
  useEffect(() => {
    if (!value) return;
    setText(value.code);
  }, [value]);

  useEffect(() => {
    if (externalSuggestions?.length) setSuggestions(externalSuggestions);
  }, [externalSuggestions]);

  useEffect(() => {
    const q = text.trim();
    if (value && q === value.code) return; // vừa chọn xong, không tra lại
    if (q.length < 2) {
      setSuggestions([]);
      setNotFound(false);
      return;
    }
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get("/machine-videos/resolve-machine", { params: { q } });
        if (my !== reqId.current) return; // đã có lần gõ mới hơn
        const { match, suggestions: sug } = res.data || {};
        if (match) {
          onChange(match);
          setSuggestions([]);
          setNotFound(false);
        } else {
          onChange(null);
          setSuggestions(sug || []);
          setNotFound(!(sug || []).length);
        }
      } catch {
        if (my === reqId.current) setSuggestions([]);
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function pick(m: MachineRef) {
    onChange(m);
    setText(m.code);
    setSuggestions([]);
    setNotFound(false);
  }

  function pickAsNew() {
    const t = text.trim();
    onChange({ id: "", sku: "", name: t, code: t, isNew: true });
    setSuggestions([]);
    setNotFound(false);
  }

  function clear() {
    onChange(null);
    setText("");
    setSuggestions([]);
    setNotFound(false);
  }

  return (
    <div>
      <div className="relative mt-1">
        <input
          className={`block w-full rounded border px-3 py-2 pr-9 ${
            value?.isNew ? "border-amber-500 bg-amber-50" : value ? "border-green-500 bg-green-50" : ""
          }`}
          placeholder='Gõ mã hoặc tên máy, vd "JL-1000"'
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (value) onChange(null);
          }}
          disabled={disabled}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">…</span>
        )}
        {!loading && text && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-slate-400 hover:text-slate-600"
            aria-label="Xoá"
          >
            ×
          </button>
        )}
      </div>

      {value && !value.isNew && (
        <div className="mt-1 text-sm text-green-700">
          ✓ <b>{value.code}</b> – {value.name}
        </div>
      )}

      {value?.isNew && (
        <div className="mt-1 text-sm text-amber-700">
          ＋ Máy mới: <b>{value.name}</b> — chưa có trong danh mục. Video vẫn lưu bình thường (vào khu
          "máy mới"); khi đã thêm máy vào danh mục, sửa lại mã máy của video là file tự về đúng chỗ.
        </div>
      )}

      {!value && suggestions.length > 0 && (
        <div className="mt-1 rounded border bg-white shadow-sm">
          <div className="px-3 pt-2 text-xs text-slate-500">Có phải máy này?</div>
          {suggestions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m)}
              disabled={disabled}
              className="block w-full px-3 py-2.5 text-left text-sm hover:bg-indigo-50 active:bg-indigo-100"
            >
              <b>{m.code}</b> <span className="text-slate-500">– {m.name}</span>
            </button>
          ))}
        </div>
      )}

      {!value && notFound && !loading && (
        <div className="mt-1 text-xs text-amber-700">
          Không thấy máy nào khớp trong danh mục. Nếu có mã máy (vd "ZT-500") nên gõ cả mã.
        </div>
      )}

      {!value && !loading && text.trim().length >= 3 && (notFound || suggestions.length > 0) && (
        <button
          type="button"
          onClick={pickAsNew}
          disabled={disabled}
          className="mt-1 w-full rounded border border-dashed border-amber-400 px-3 py-2.5 text-left text-sm text-amber-800 hover:bg-amber-50 active:bg-amber-100"
        >
          ＋ Máy mới chưa có trong danh mục — dùng "<b>{text.trim()}</b>"
        </button>
      )}
    </div>
  );
};

export default MachinePicker;