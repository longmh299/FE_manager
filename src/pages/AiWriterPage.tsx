// src/pages/AiWriterPage.tsx
// ✅ AI viết bài: sale chọn máy, model, kênh rồi bấm viết. Code soát lại bài trước khi cho copy.
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ToastHost, useToast } from "../components/Toast";

const ToastCtx = React.createContext<ReturnType<typeof useToast> | null>(null);
const usePageToast = () => useContext(ToastCtx)!;

type Spec = { label: string; value: string };
type ModelRow = { code: string; specs: Spec[]; missing?: string[] };
type Conflict = { field: string; summary: string; table: string; message: string };
type Profile = {
  id: string;
  slug: string | null;
  manual: boolean;
  name: string;
  sku: string | null;
  category: string | null;
  videoUrl: string | null;
  models: ModelRow[];
  warnings: string[];
  conflicts: Conflict[];
  blocked: boolean;
  conflictsResolvedAt: string | null;
  webChangedAt: string | null;
};
type Issue = { type: string; level: "error" | "warning"; text: string; message: string };
type Variant = { text: string; issues: Issue[]; errors: number; angle?: string; kind?: string };

const CHANNEL_LABEL: Record<string, string> = { facebook: "Facebook", zalo: "Zalo", tiktok: "TikTok", web: "Website" };
const PURPOSE_LABEL: Record<string, string> = { gioi_thieu: "Giới thiệu máy", ung_dung: "Ứng dụng theo ngành", khach_lap: "Khách vừa lắp máy" };
const EXPORT_SQL = `SELECT json_build_object(
  'slug', p.slug, 'name', p.name, 'sku', p.sku, 'category', c.name,
  'updatedAt', p."updatedAt", 'short', p.short, 'description', p.description,
  'dimensions', p.dimensions, 'functions', p.functions, 'material', p.material,
  'power', p.power, 'voltage', p.voltage, 'weight', p.weight, 'videoUrl', p."videoUrl"
) AS san_pham
FROM "Product" p LEFT JOIN "Category" c ON c.id = p."categoryId"
WHERE p.published = true;`;

const errMsg = (e: any) => e?.response?.data?.message || e?.message || "Có lỗi, thử lại.";
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";
const btnPrimary = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";

const IssueList: React.FC<{ issues: Issue[] }> = ({ issues }) =>
  issues.length === 0 ? (
    <p className="text-sm font-medium text-emerald-700">Soát xong, không thấy lỗi. Bạn vẫn cần đọc lại trước khi đăng.</p>
  ) : (
    <ul className="space-y-1 text-sm">
      {issues.map((i, k) => (
        <li key={k} className={i.level === "error" ? "text-rose-700" : "text-amber-700"}>
          <span className="font-semibold">“{i.text}”</span>: {i.message}
        </li>
      ))}
    </ul>
  );

// ✅ AI viết xong là copy: không có ô sửa, bài lỗi thì bấm Viết lại
const PostCard: React.FC<{ index: number; variant: Variant }> = ({ index, variant }) => {
  const toast = usePageToast();
  const errors = variant.issues.filter((i) => i.level === "error").length;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(variant.text);
      toast.push({ type: "success", title: "Đã copy", message: "Bài đã nằm trong bộ nhớ tạm." });
    } catch {
      toast.push({ type: "error", title: "Không copy được", message: "Hãy bôi đen rồi copy tay." });
    }
  };
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4" data-testid="post-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          {variant.kind === "short" ? "Bản siêu vắn tắt" : `Bản ${index + 1}`}
          {variant.kind !== "short" && variant.angle && <span className="ml-2 font-normal text-slate-500">{variant.angle}</span>}
        </h3>
        <button type="button" onClick={copy} disabled={errors > 0} className={btnPrimary}>
          {errors > 0 ? `Còn ${errors} lỗi` : "Copy bài"}
        </button>
      </div>
      <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{variant.text}</div>
      <div className="mt-3 border-t border-slate-100 pt-3">
        <IssueList issues={variant.issues} />
      </div>
    </article>
  );
};

const WriterTab: React.FC<{ profiles: Profile[]; phone: string | null; channels: string[]; purposes: string[] }> = ({ profiles, phone, channels, purposes }) => {
  const toast = usePageToast();
  const [q, setQ] = useState("");
  const [profileId, setProfileId] = useState("");
  const [modelCode, setModelCode] = useState("");
  const [channel, setChannel] = useState("facebook");
  const [purpose, setPurpose] = useState("gioi_thieu");
  const [industry, setIndustry] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ variants: Variant[]; key: number } | null>(null);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = !t ? profiles : profiles.filter((p) => `${p.name} ${p.sku ?? ""} ${p.models.map((m) => m.code).join(" ")}`.toLowerCase().includes(t));
    return rows.slice(0, 60);
  }, [q, profiles]);
  const profile = profiles.find((p) => p.id === profileId);
  const model = profile?.models.find((m) => m.code === modelCode);

  const choose = (p: Profile) => {
    setProfileId(p.id);
    setModelCode(p.models.length === 1 ? p.models[0].code : "");
    setResult(null);
  };

  const write = async () => {
    if (!profile || !modelCode) return;
    setBusy(true);
    try {
      const r = await api.post("/ai-writer/generate", { profileId, modelCode, channel, purpose, industry, extra });
      setResult({ variants: r.data.variants, key: Date.now() });
    } catch (e) {
      toast.push({ type: "error", title: "Chưa viết được", message: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm font-medium text-slate-700">
          Máy
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc mã máy" className={`${field} mt-1`} />
        </label>
        <ul className="max-h-56 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200" aria-label="Danh sách máy">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => choose(p)} aria-pressed={p.id === profileId} className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${p.id === profileId ? "bg-indigo-50 font-medium text-indigo-800" : "text-slate-700"}`}>
                {p.name}
                <span className="ml-1 text-xs text-slate-500">{p.models.map((m) => m.code).join(", ").slice(0, 40)}</span>
                {p.blocked && <span className="ml-1 text-xs font-medium text-rose-700">Thông số lệch</span>}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Không có máy nào khớp.</li>}
        </ul>

        {profile && (
          <label className="block text-sm font-medium text-slate-700">
            Model
            <select value={modelCode} onChange={(e) => { setModelCode(e.target.value); setResult(null); }} className={`${field} mt-1`}>
              {profile.models.length > 1 && <option value="">Chọn model</option>}
              {profile.models.map((m) => <option key={m.code} value={m.code}>{m.code}</option>)}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            Kênh
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${field} mt-1`}>
              {channels.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c] ?? c}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Mục đích
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} className={`${field} mt-1`}>
              {purposes.map((c) => <option key={c} value={c}>{PURPOSE_LABEL[c] ?? c}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Ngành <span className="font-normal text-slate-500">(không bắt buộc)</span>
          <input value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={100} placeholder="VD: cà phê, thuỷ sản" className={`${field} mt-1`} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Ý riêng <span className="font-normal text-slate-500">(không bắt buộc)</span>
          <textarea value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={500} rows={3} placeholder="VD: vừa lắp ở Long An cho xưởng thực phẩm" className={`${field} mt-1`} />
        </label>

        {!phone && (
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            Bạn chưa có số điện thoại nên bài sẽ không có dòng liên hệ. <Link to="/change-password" className="font-medium underline">Thêm số</Link>
          </p>
        )}
        {profile?.blocked && (
          <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">
            <p className="font-medium">Máy này có thông số đang lệch, chưa viết được:</p>
            <ul className="mt-1 list-disc pl-5">
              {profile.conflicts.map((c, i) => <li key={i}>{c.field}: ô tóm tắt ghi {c.summary}, bảng ghi {c.table}.</li>)}
            </ul>
          </div>
        )}
        {model && (model.missing?.length ?? 0) > 0 && (
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
            {model.code} thiếu: {model.missing!.join(", ")}. Bài sẽ không nhắc tới các mục này, nên hỏi kỹ thuật nếu khách cần.
          </p>
        )}
        {profile && profile.warnings.length > 0 && (
          <ul className="list-disc rounded-lg bg-amber-50 p-2 pl-6 text-sm text-amber-800">
            {profile.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        <button type="button" onClick={write} disabled={busy || !profile || !modelCode || !!profile?.blocked} className={`${btnPrimary} w-full`}>
          {busy ? "AI đang viết…" : "Viết bài"}
        </button>
      </section>

      <section className="space-y-3">
        {model && (
          <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm" open={!result}>
            <summary className="cursor-pointer font-semibold text-slate-800">Thông số AI được dùng: {model.code}</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {model.specs.map((s, i) => (
                <div key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1">
                  <dt className="text-slate-500">{s.label}</dt>
                  <dd className="text-right font-medium text-slate-800">{s.value}</dd>
                </div>
              ))}
            </dl>
            {profile?.videoUrl && (
              <p className="mt-2">
                <a href={profile.videoUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">Xem video của máy</a> để đăng kèm.
              </p>
            )}
          </details>
        )}
        {result?.variants.map((v, i) => (
          <PostCard key={`${result.key}-${i}`} index={i} variant={v} />
        ))}
        {result && (
          <button type="button" onClick={write} disabled={busy} className={btnGhost}>
            {busy ? "AI đang viết…" : "Viết lại các bản khác"}
          </button>
        )}
        {!model && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Chọn máy và model để bắt đầu.</p>}
      </section>
    </div>
  );
};

const ProfilesTab: React.FC<{ profiles: Profile[]; reload: () => Promise<void> }> = ({ profiles, reload }) => {
  const toast = usePageToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [editing, setEditing] = useState<{ id: string | null; name: string; models: ModelRow[] } | null>(null);
  const [filter, setFilter] = useState<"all" | "blocked" | "missing">("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await f.text());
      const r = await api.post("/ai-writer/import", data);
      setReport(r.data);
      await reload();
      toast.push({ type: "success", title: "Đã nạp", message: `Mới ${r.data.created}, cập nhật ${r.data.updated}, giữ nguyên ${r.data.unchanged}.` });
    } catch (e) {
      toast.push({ type: "error", title: "Không nạp được", message: e instanceof SyntaxError ? "File không phải JSON." : errMsg(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await api.put(`/ai-writer/profiles/${editing.id}`, { name: editing.name, models: editing.models });
      else await api.post("/ai-writer/profiles", { name: editing.name, models: editing.models });
      setEditing(null);
      await reload();
      toast.push({ type: "success", title: "Đã lưu hồ sơ", message: "Sale dùng được thông số mới ngay." });
    } catch (e) {
      toast.push({ type: "error", title: "Chưa lưu được", message: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (id: string) => {
    try {
      await api.post(`/ai-writer/profiles/${id}/resolve`);
      await reload();
    } catch (e) {
      toast.push({ type: "error", title: "Lỗi", message: errMsg(e) });
    }
  };
  const remove = async (p: Profile) => {
    if (!window.confirm(`Xoá hồ sơ nhập tay "${p.name}"?`)) return;
    try {
      await api.delete(`/ai-writer/profiles/${p.id}`);
      await reload();
    } catch (e) {
      toast.push({ type: "error", title: "Lỗi", message: errMsg(e) });
    }
  };
  const missingOf = (p: Profile) => p.models.some((m) => (m.missing?.length ?? 0) > 0);
  const rows = profiles.filter((p) => (filter === "blocked" ? p.blocked : filter === "missing" ? missingOf(p) : true));
  const setModel = (i: number, m: ModelRow) => editing && setEditing({ ...editing, models: editing.models.map((x, k) => (k === i ? m : x)) });

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Chọn file sản phẩm" />
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Đang xử lý…" : "Nạp file sản phẩm từ web"}</button>
          <button type="button" className={btnGhost} onClick={() => setEditing({ id: null, name: "", models: [{ code: "", specs: [{ label: "Công suất", value: "" }, { label: "Điện áp", value: "" }, { label: "Kích thước", value: "" }, { label: "Trọng lượng", value: "" }] }] })}>Thêm máy không có trên web</button>
        </div>
        <details className="mt-3 text-slate-600">
          <summary className="cursor-pointer">Cách lấy file từ DB web</summary>
          <p className="mt-2">Mở SQL Editor của project web trên Neon, chạy câu dưới rồi tải kết quả dạng JSON:</p>
          <pre className="mt-1 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{EXPORT_SQL}</pre>
        </details>
        {report && (
          <p className="mt-3 text-slate-700">
            Lần nạp vừa rồi: mới {report.created}, cập nhật {report.updated}, không đổi {report.unchanged}, giữ bản sửa tay {report.keptEdited}, bỏ qua {report.skipped}. Có {report.blocked.length} máy lệch thông số.
          </p>
        )}
      </section>

      {editing && (
        <section className="space-y-3 rounded-xl border border-indigo-200 bg-white p-4 text-sm" aria-label="Sửa hồ sơ">
          <label className="block font-medium text-slate-700">
            Tên máy
            <input aria-label="Tên máy" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={`${field} mt-1`} />
          </label>
          {editing.models.map((m, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <label className="block font-medium text-slate-700">
                Mã model
                <input aria-label="Mã model" value={m.code} onChange={(e) => setModel(i, { ...m, code: e.target.value })} className={`${field} mt-1`} />
              </label>
              <div className="mt-2 space-y-2">
                {m.specs.map((s, k) => (
                  <div key={k} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input aria-label="Tên thông số" value={s.label} onChange={(e) => setModel(i, { ...m, specs: m.specs.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} className={field} />
                    <input aria-label={`Giá trị ${s.label}`} value={s.value} onChange={(e) => setModel(i, { ...m, specs: m.specs.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} className={field} />
                    <button type="button" aria-label={`Bỏ dòng ${s.label}`} className={btnGhost} onClick={() => setModel(i, { ...m, specs: m.specs.filter((_, j) => j !== k) })}>Bỏ</button>
                  </div>
                ))}
              </div>
              <button type="button" className={`${btnGhost} mt-2`} onClick={() => setModel(i, { ...m, specs: [...m.specs, { label: "", value: "" }] })}>Thêm dòng</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={() => setEditing({ ...editing, models: [...editing.models, { code: "", specs: [{ label: "", value: "" }] }] })}>Thêm model</button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={save}>Lưu hồ sơ</button>
            <button type="button" className={btnGhost} onClick={() => setEditing(null)}>Huỷ</button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 text-sm">
          {([["all", `Tất cả (${profiles.length})`], ["blocked", `Lệch thông số (${profiles.filter((p) => p.blocked).length})`], ["missing", `Thiếu thông số (${profiles.filter(missingOf).length})`]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 font-medium ${filter === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>{l}</button>
          ))}
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{p.name}{p.manual && <span className="ml-2 text-xs text-slate-500">Nhập tay</span>}</p>
                  <p className="text-xs text-slate-500">{p.models.map((m) => m.code).join(", ")}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {p.blocked && <button type="button" className={btnGhost} onClick={() => resolve(p.id)}>Dùng theo bảng</button>}
                  <button type="button" className={btnGhost} onClick={() => setEditing({ id: p.id, name: p.name, models: p.models.map((m) => ({ code: m.code, specs: m.specs })) })}>Sửa</button>
                  {p.manual && <button type="button" className={btnGhost} onClick={() => remove(p)}>Xoá</button>}
                </div>
              </div>
              {p.blocked && p.conflicts.map((c, i) => <p key={i} className="mt-1 text-rose-700">{c.field}: ô tóm tắt ghi {c.summary}, bảng ghi {c.table}. {c.message}</p>)}
              {p.webChangedAt && <p className="mt-1 text-amber-700">Web đã đổi sau khi hồ sơ được sửa tay, nên xem lại.</p>}
              {p.models.filter((m) => (m.missing?.length ?? 0) > 0).slice(0, 3).map((m) => <p key={m.code} className="mt-1 text-amber-700">{m.code} thiếu: {m.missing!.join(", ")}</p>)}
            </li>
          ))}
          {rows.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Chưa có hồ sơ nào.</li>}
        </ul>
      </section>
    </div>
  );
};

const AiWriterPage: React.FC = () => {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = String((user as any)?.role) === "admin";
  const [tab, setTab] = useState<"write" | "profiles">("write");
  const [data, setData] = useState<{ profiles: Profile[]; phone: string | null; channels: string[]; purposes: string[] } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/ai-writer/profiles");
      setData(r.data);
      setError("");
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <ToastCtx.Provider value={toast}>
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <ToastHost toasts={toast.toasts} onClose={toast.remove} />
      <div>
        <h1 className="text-xl font-semibold text-slate-900">AI viết bài</h1>
        <p className="text-sm text-slate-600">AI chỉ dùng hồ sơ của đúng model bạn chọn, và viết khác với bài đồng nghiệp vừa dùng cho cùng máy. Bạn vẫn cần đọc lại trước khi đăng.</p>
      </div>
      {isAdmin && (
        <div className="flex gap-2 text-sm">
          {([["write", "Viết bài"], ["profiles", "Hồ sơ máy"]] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 font-medium ${tab === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>{l}</button>
          ))}
        </div>
      )}
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-500">Đang tải…</p>}
      {data && tab === "write" && data.profiles.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Chưa có hồ sơ máy. {isAdmin ? "Vào tab Hồ sơ máy để nạp dữ liệu." : "Nhờ quản trị nạp dữ liệu máy."}
        </p>
      )}
      {data && tab === "write" && data.profiles.length > 0 && <WriterTab profiles={data.profiles} phone={data.phone} channels={data.channels} purposes={data.purposes} />}
      {data && tab === "profiles" && isAdmin && <ProfilesTab profiles={data.profiles} reload={load} />}
    </div>
    </ToastCtx.Provider>
  );
};

export default AiWriterPage;
