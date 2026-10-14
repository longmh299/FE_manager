// src/pages/MktPage.tsx
// ✅ HÀNG CHỜ MKT — clip AI cắt từ video thô + bài viết cho Facebook / TikTok / YouTube
//   - Xem clip, sửa caption từng kênh, chọn kênh, đổi giờ đăng
//   - Duyệt -> tự xếp lịch 1 clip/ngày khung 19h–21h (đổi giờ được) · Bỏ · Đăng ngay
//   - Facebook: máy công ty tự đăng. TikTok / YouTube: tải clip + copy caption để đăng tay
//   - Tab "Video thô": video nào AI đã / đang xử lý · "Làm lại từ đầu" = xoá clip chưa đăng + dựng lại
// Cũng duyệt được ngay trong nhóm Telegram (nút ✅ / ❌), nút ✏️ trên Telegram mở thẳng trang /mkt/:id.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";

type Channel = "facebook" | "tiktok" | "youtube";
type Captions = { facebook: { text: string }; tiktok: { text: string }; youtube: { title: string; description: string } };
type Result = { ok?: boolean; manual?: boolean; id?: string; url?: string; error?: string; at?: string };
type ClipRow = {
  id: string;
  status: string;
  machineCode: string | null;
  machineName: string | null;
  hook: string;
  durationSec: number;
  thumbUrl: string | null;
  channels: Channel[];
  scheduledAt: string | null;
  postedAt: string | null;
  results: Partial<Record<Channel, Result>> | null;
  reviewedBy: string | null;
  createdAt: string;
};
type ClipFull = ClipRow & {
  captions: Captions;
  previewUrl: string;
  clipUrl: string;
  startSec: number;
  endSec: number;
  aiNote: string | null;
  aiCost: number;
  sourceTitle: string | null;
  telegram: { chatId: number; messageId: number } | null;
};
type Source = {
  videoId: string;
  title: string;
  machineCode: string | null;
  fileSize: number;
  createdAt: string;
  status: string;
  clipCount: number;
  note: string | null;
  aiCost: number;
  updatedAt: string;
};
type Summary = {
  counts: Record<string, number>;
  processing: number;
  waitingVideos: number;
  totalRaw?: number;
  auto?: boolean;
  workerSeenAt: string | null;
  telegram: boolean;
};

const TABS = [
  { k: "cho_duyet", label: "Chờ duyệt" },
  { k: "da_len_lich", label: "Đã lên lịch" },
  { k: "da_dang", label: "Đã đăng" },
  { k: "loi", label: "Lỗi" },
  { k: "bo", label: "Đã bỏ" },
  { k: "sources", label: "Video thô" },
] as const;
type Tab = (typeof TABS)[number]["k"];

const CH_LABEL: Record<Channel, string> = { facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube" };
const CH_ICON: Record<Channel, string> = { facebook: "📘", tiktok: "🎵", youtube: "▶️" };
const AUTO: Channel[] = ["facebook"];
const STATUS: Record<string, { label: string; cls: string }> = {
  cho_duyet: { label: "Chờ duyệt", cls: "bg-amber-100 text-amber-800" },
  da_len_lich: { label: "Đã lên lịch", cls: "bg-indigo-100 text-indigo-800" },
  dang_dang: { label: "Đang đăng", cls: "bg-sky-100 text-sky-800" },
  da_dang: { label: "Đã đăng", cls: "bg-emerald-100 text-emerald-800" },
  bo: { label: "Đã bỏ", cls: "bg-slate-200 text-slate-600" },
  loi: { label: "Lỗi", cls: "bg-red-100 text-red-700" },
  dang_xu_ly: { label: "Đang xử lý", cls: "bg-sky-100 text-sky-800" },
  xong: { label: "Xong", cls: "bg-emerald-100 text-emerald-800" },
  cho_xu_ly: { label: "Chờ AI", cls: "bg-amber-100 text-amber-800" },
  uu_tien: { label: "Chờ AI (ưu tiên)", cls: "bg-indigo-100 text-indigo-800" },
  chua_xu_ly: { label: "Chưa xử lý", cls: "bg-slate-100 text-slate-600" },
  bo_qua: { label: "Không dùng được", cls: "bg-slate-200 text-slate-600" },
};

function errMsg(e: unknown) {
  const err = e as { message?: string; response?: { data?: { message?: string } } };
  return err?.response?.data?.message || err?.message || "Có lỗi xảy ra";
}
const p2 = (n: number) => String(n).padStart(2, "0");
/** "19:45 13/10" */
const fmt = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return `${p2(d.getHours())}:${p2(d.getMinutes())} ${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
};
const ago = (s: string | null) => {
  if (!s) return null;
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  return m < 1 ? "vừa xong" : m < 60 ? `${m} phút trước` : `${Math.round(m / 60)} giờ trước`;
};
/** Date -> giá trị cho <input type="datetime-local"> (giờ máy người dùng) */
const toLocalInput = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

const Badge: React.FC<{ s: string }> = ({ s }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[s]?.cls ?? "bg-slate-100"}`}>{STATUS[s]?.label ?? s}</span>
);

// ================================================================ trang
const MktPage: React.FC = () => {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("cho_duyet");
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ClipRow[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [srcQ, setSrcQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, list] = await Promise.all([
        api.get("/mkt/summary"),
        tab === "sources" ? api.get("/mkt/sources", { params: { q: srcQ.trim() || undefined } }) : api.get("/mkt/clips", { params: { status: tab === "da_dang" ? "da_dang,dang_dang" : tab } }),
      ]);
      setSum(s.data);
      if (tab === "sources") setSources(list.data.items);
      else setRows(list.data.items);
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [tab, srcQ]);

  useEffect(() => {
    if (id) return;
    const t = setTimeout(load, tab === "sources" && srcQ ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, id, tab, srcQ]);

  /** "Cho AI làm": đưa video thô lên đầu hàng chờ, máy công ty làm ở lượt kiểm tra tới */
  async function queue(list: Source[]) {
    const ids = list.filter((s) => ["cho_xu_ly", "chua_xu_ly", "loi", "bo_qua"].includes(s.status)).map((s) => s.videoId);
    if (!ids.length) return setToast("Không có video nào cần làm");
    if (list.length > 1 && !window.confirm(`Cho AI làm ${ids.length} video thô này?`)) return;
    try {
      const { data } = await api.post("/mkt/sources/queue", { videoIds: ids });
      setToast(`Đã đưa ${data.queued} video lên đầu hàng chờ — máy công ty làm trong vài phút tới`);
      load();
    } catch (e) {
      setToast(errMsg(e));
    }
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  /** Admin: gạt chế độ Tự động / Bán tự động */
  async function setAuto(on: boolean) {
    if (!sum || (sum.auto !== false) === on) return;
    if (!window.confirm(on ? "Bật TỰ ĐỘNG: mọi video thô đang chờ và upload mới sẽ được AI tự làm. Tiếp tục?" : "Chuyển BÁN TỰ ĐỘNG: AI chỉ làm video bạn bấm “Cho AI làm”. Tiếp tục?")) return;
    try {
      await api.post("/mkt/settings/auto", { auto: on });
      setToast(on ? "Đã bật chế độ Tự động" : "Đã chuyển sang Bán tự động");
      load();
    } catch (e) {
      const err = e as { response?: { status?: number } };
      setToast(err?.response?.status === 403 ? "Chỉ admin được đổi chế độ" : errMsg(e));
    }
  }

  /** Admin: nối webhook Telegram (làm 1 lần sau khi đặt biến môi trường trên Render) */
  async function connectTelegram() {
    try {
      await api.post("/mkt/telegram/setup");
      setToast("Đã kết nối — bot vừa gửi tin nhắn thử vào nhóm");
    } catch (e) {
      setToast(errMsg(e));
    }
  }

  /** Làm lại từ đầu: xoá hết clip CHƯA ĐĂNG của video này (cả file R2) rồi đưa video về hàng chờ dựng lại */
  async function resetSource(s: Source) {
    if (
      !window.confirm(
        `Làm lại từ đầu "${s.title}"?\n\n• Xoá hết clip chưa đăng của video này (cả file trên R2)\n• Clip đã đăng giữ nguyên\n• Video thô gốc KHÔNG bị xoá\n• Máy công ty sẽ dựng lại ở lượt kiểm tra tới (tốn tiền AI lần nữa)`
      )
    )
      return;
    try {
      const { data } = await api.post(`/mkt/sources/${s.videoId}/reset`);
      setToast(`Đã xoá ${data.deleted} clip · video đã về hàng chờ dựng lại`);
      load();
    } catch (e) {
      setToast(errMsg(e));
    }
  }

  if (id) {
    return (
      <>
        <ClipDetail
          id={id}
          onBack={() => (window.history.length > 1 ? nav(-1) : nav("/mkt"))}
          onDone={(msg) => {
            setToast(msg);
            nav("/mkt");
          }}
          onToast={setToast}
        />
        {toast && <Toast text={toast} />}
      </>
    );
  }

  const workerAgo = ago(sum?.workerSeenAt ?? null);
  const workerOk = sum?.workerSeenAt && Date.now() - new Date(sum.workerSeenAt).getTime() < 30 * 60000;

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-24 pt-3 md:px-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">Hàng chờ MKT</h1>
          <p className="text-xs text-slate-500">AI cắt clip từ video thô + viết bài · duyệt xong tự xếp lịch 1 clip/ngày, 19h–21h</p>
        </div>
        <button onClick={load} disabled={loading} className="shrink-0 rounded-full border bg-white px-3 py-1.5 text-sm active:bg-slate-100 disabled:opacity-50">
          {loading ? "…" : "↻"}
        </button>
      </div>

      {sum && (
        <div className="mb-3 grid gap-2 text-xs md:grid-cols-3">
          <div className={`rounded-xl border px-3 py-2 ${workerOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            🖥️ Máy công ty: {workerOk ? `đang chạy (${workerAgo})` : workerAgo ? `không thấy liên lạc từ ${workerAgo}` : "chưa kết nối từ lúc server khởi động"}
          </div>
          <div className="rounded-xl border bg-white px-3 py-2 text-slate-600">
            🎞️ {sum.waitingVideos} video thô chờ AI · {sum.processing} đang xử lý{sum.totalRaw !== undefined ? ` · tổng ${sum.totalRaw}` : ""}
          </div>
          <div className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${sum.telegram ? "bg-white text-slate-600" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            <span>✈️ Telegram: {sum.telegram ? "đã cấu hình" : "chưa cấu hình (chỉ duyệt trên CRM)"}</span>
            {sum.telegram && (
              <button onClick={connectTelegram} className="shrink-0 rounded-full border bg-white px-2 py-0.5 text-[11px] active:bg-slate-100" title="Chỉ admin">
                Kết nối bot
              </button>
            )}
          </div>
        </div>
      )}

      {sum && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-white px-3 py-2">
          <span className="text-sm font-medium text-slate-700">⚙️ Chế độ</span>
          <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-sm">
            {(
              [
                [true, "Tự động"],
                [false, "Bán tự động"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                onClick={() => setAuto(v)}
                className={`rounded-full px-3 py-1 ${sum.auto !== false === v ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">
            {sum.auto !== false
              ? "Video thô mới upload là AI tự làm."
              : "AI chỉ làm video được bấm “Cho AI làm” ở tab Video thô."}{" "}
            Clip làm xong vẫn chờ duyệt rồi mới đăng.
          </span>
        </div>
      )}

      <div className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 pb-1 md:mx-0 md:px-0">
        {TABS.map((t) => {
          const n = t.k === "sources" ? undefined : t.k === "da_dang" ? (sum?.counts.da_dang ?? 0) + (sum?.counts.dang_dang ?? 0) : sum?.counts[t.k];
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${tab === t.k ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}
            >
              {t.label}
              {n ? <span className="ml-1 opacity-80">({n})</span> : null}
            </button>
          );
        })}
      </div>

      {tab === "sources" ? (
        <div className="space-y-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {sum?.auto === false
              ? "Đang TẮT tự động: máy công ty chỉ làm video được bấm “Cho AI làm”."
              : "Video thô mới upload sẽ được máy công ty TỰ ĐỘNG làm (khoảng 10 phút / lượt). Muốn làm ngay video nào thì bấm “Cho AI làm” — video đó được ưu tiên lên đầu."}
          </div>
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-[16px] md:text-sm"
              placeholder="Tìm theo tên máy / mã máy…"
              value={srcQ}
              onChange={(e) => setSrcQ(e.target.value)}
            />
            {srcQ.trim() && sources.some((s) => ["cho_xu_ly", "chua_xu_ly", "loi", "bo_qua"].includes(s.status)) && (
              <button onClick={() => queue(sources)} className="shrink-0 rounded-xl bg-indigo-600 px-3 text-sm font-medium text-white active:bg-indigo-700">
                Cho AI làm tất cả
              </button>
            )}
          </div>
          <div className="divide-y overflow-hidden rounded-xl border bg-white">
            {sources.map((s) => (
              <div key={s.videoId} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium">{s.title}</span>
                    <Badge s={s.status} />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {[s.machineCode, `upload ${fmt(s.createdAt)}`, `${Math.round(s.fileSize / 1048576)} MB`, s.clipCount ? `${s.clipCount} clip` : null, s.aiCost ? `AI $${s.aiCost.toFixed(3)}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {s.note && <div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{s.note}</div>}
                </div>
                {["cho_xu_ly", "chua_xu_ly", "loi", "bo_qua"].includes(s.status) && (
                  <button onClick={() => queue([s])} className="shrink-0 rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white active:bg-indigo-700">
                    ▶ Cho AI làm
                  </button>
                )}
                {(s.status === "xong" || s.status === "bo_qua") && (
                  <button onClick={() => resetSource(s)} className="shrink-0 rounded-full border px-3 py-1 text-xs active:bg-slate-100">
                    ↻ Làm lại từ đầu
                  </button>
                )}
              </div>
            ))}
            {!sources.length && !loading && (
              <div className="px-3 py-6 text-center text-sm text-slate-400">{srcQ ? "Không có video thô nào khớp" : "Chưa có video thô nào (upload ở trang Video vận hành máy → loại video chạy máy)"}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((r) => (
            <button key={r.id} onClick={() => nav(`/mkt/${r.id}`)} className="overflow-hidden rounded-xl border bg-white text-left active:bg-slate-50">
              <div className="relative aspect-[9/16] max-h-64 w-full bg-slate-900">
                {r.thumbUrl && <img src={r.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">{Math.round(r.durationSec)}s</span>
              </div>
              <div className="space-y-1 p-2">
                <div className="truncate text-[13px] font-medium">{r.machineCode || r.machineName || "Chưa rõ máy"}</div>
                <div className="line-clamp-2 text-xs text-slate-600">{r.hook}</div>
                {r.status === "da_len_lich" && <div className="text-[11px] font-medium text-indigo-700">🕖 {fmt(r.scheduledAt)}</div>}
                {(r.status === "da_dang" || r.status === "dang_dang" || r.status === "loi") && (
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {r.channels.map((c) => {
                      const res = r.results?.[c];
                      return (
                        <span key={c} className={res?.ok ? "text-emerald-700" : res?.ok === false ? "text-red-600" : "text-slate-500"}>
                          {CH_ICON[c]}
                          {res?.ok ? "✓" : res?.ok === false ? "✕" : res?.manual ? "tay" : "…"}
                        </span>
                      );
                    })}
                  </div>
                )}
                {r.status === "cho_duyet" && <div className="text-[11px] text-slate-400">{fmt(r.createdAt)}</div>}
              </div>
            </button>
          ))}
          {!rows.length && !loading && (
            <div className="col-span-full rounded-xl border bg-white px-3 py-8 text-center text-sm text-slate-400">Không có clip nào</div>
          )}
        </div>
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
};

const Toast: React.FC<{ text: string }> = ({ text }) => (
  <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8">
    <div className="rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg">{text}</div>
  </div>
);

// ================================================================ chi tiết 1 clip
const inputCls = "block w-full rounded-xl border px-3 py-2.5 text-[16px] outline-none focus:border-indigo-400 md:text-sm";

function CopyBtn({ text, onToast }: { text: string; onToast: (m: string) => void }) {
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        onToast("Đã copy");
      }}
      className="rounded-full border px-2.5 py-0.5 text-xs active:bg-slate-100"
    >
      Copy
    </button>
  );
}

function ClipDetail({ id, onBack, onDone, onToast }: { id: string; onBack: () => void; onDone: (m: string) => void; onToast: (m: string) => void }) {
  const [c, setC] = useState<ClipFull | null>(null);
  const [caps, setCaps] = useState<Captions | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [when, setWhen] = useState("");
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/mkt/clips/${id}`);
      setC(data);
      setCaps(data.captions);
      setChannels(data.channels);
      setWhen(toLocalInput(data.scheduledAt));
      if (data.status === "cho_duyet" || data.status === "loi") {
        const s = await api.get("/mkt/next-slot");
        setSlot(s.data.at);
      }
    } catch (e) {
      setErr(errMsg(e));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => !!c && (JSON.stringify(caps) !== JSON.stringify(c.captions) || JSON.stringify(channels) !== JSON.stringify(c.channels) || (c.status === "da_len_lich" && when !== toLocalInput(c.scheduledAt))),
    [c, caps, channels, when]
  );
  const editable = !!c && ["cho_duyet", "da_len_lich", "loi"].includes(c.status);

  async function save(silent = false) {
    if (!c || !caps) return;
    await api.patch(`/mkt/clips/${id}`, {
      captions: caps,
      channels,
      ...(c.status === "da_len_lich" && when ? { scheduledAt: new Date(when).toISOString() } : {}),
    });
    if (!silent) {
      onToast("Đã lưu");
      load();
    }
  }

  async function act(kind: "approve" | "reject" | "post-now" | "unschedule" | "delete" | "save") {
    if (!c) return;
    if (kind === "post-now" && !window.confirm("Đăng clip này ngay bây giờ (trong vài phút tới)?")) return;
    if (kind === "reject" && !window.confirm("Bỏ clip này? (không đăng)")) return;
    if (kind === "delete" && !window.confirm("Xoá hẳn clip này khỏi hệ thống và R2?")) return;
    setBusy(kind);
    setErr(null);
    try {
      if (kind === "save") return await save();
      if (dirty && editable) await save(true);
      if (kind === "approve") {
        const r = await api.post(`/mkt/clips/${id}/approve`, when && c.status !== "da_len_lich" ? { scheduledAt: new Date(when).toISOString() } : {});
        onDone(`Đã duyệt · đăng lúc ${fmt(r.data.scheduledAt)}`);
      } else if (kind === "post-now") {
        await api.post(`/mkt/clips/${id}/post-now`);
        onDone("Máy công ty sẽ đăng trong vài phút tới");
      } else if (kind === "reject") {
        await api.post(`/mkt/clips/${id}/reject`);
        onDone("Đã bỏ clip");
      } else if (kind === "unschedule") {
        await api.post(`/mkt/clips/${id}/unschedule`);
        onToast("Đã huỷ lịch, clip về Chờ duyệt");
        load();
      } else if (kind === "delete") {
        await api.delete(`/mkt/clips/${id}`);
        onDone("Đã xoá clip");
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  if (err && !c) return <div className="p-4 text-sm text-red-700">{err}</div>;
  if (!c || !caps) return <div className="p-4 text-sm text-slate-500">Đang tải…</div>;

  const setCap = (ch: Channel, field: string, v: string) => setCaps((cur) => (cur ? { ...cur, [ch]: { ...cur[ch], [field]: v } } : cur));
  const manualOnes = channels.filter((ch) => !AUTO.includes(ch));

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-32 pt-3 md:px-4 md:pb-10">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full text-2xl text-slate-700 active:bg-slate-200" aria-label="Quay lại">
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold md:text-lg">{c.machineName || c.machineCode || "Clip"}</h1>
            <Badge s={c.status} />
          </div>
          <div className="truncate text-xs text-slate-500">
            {c.machineCode && `${c.machineCode} · `}
            {Math.round(c.durationSec)}s · cắt từ {c.sourceTitle || "video thô"} ({c.startSec}–{c.endSec}s)
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        {/* ---------- clip ---------- */}
        <div className="space-y-2">
          <video src={c.previewUrl} poster={c.thumbUrl ?? undefined} controls playsInline className="mx-auto aspect-[9/16] max-h-[70dvh] w-full rounded-xl bg-black object-contain" />
          <a href={c.clipUrl} className="block rounded-xl border bg-white py-2 text-center text-sm active:bg-slate-50">
            ⬇ Tải clip gốc 1080×1920
          </a>
          {(c.status === "cho_duyet" || c.status === "loi") && (
            <button
              onClick={async () => {
                try {
                  await api.post(`/mkt/clips/${id}/telegram`);
                  onToast("Đã gửi clip vào nhóm Telegram");
                  load();
                } catch (e) {
                  onToast(errMsg(e));
                }
              }}
              className="block w-full rounded-xl border bg-white py-2 text-center text-sm active:bg-slate-50"
            >
              ✈️ {c.telegram ? "Gửi lại" : "Gửi"} lên Telegram để duyệt
            </button>
          )}
          {c.aiNote && <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">🤖 {c.aiNote}</div>}
          <div className="text-[11px] text-slate-400">
            Chữ trên clip: “{c.hook}” · AI ${c.aiCost.toFixed(4)}
            {c.reviewedBy && ` · duyệt/bỏ: ${c.reviewedBy}`}
          </div>
        </div>

        {/* ---------- bài viết ---------- */}
        <div className="space-y-3">
          {c.status === "da_dang" || c.status === "dang_dang" || (c.status === "loi" && c.results) ? (
            <div className="rounded-xl border bg-white p-3 text-sm">
              <div className="mb-1 font-medium">Kết quả đăng {c.postedAt && <span className="font-normal text-slate-500">· {fmt(c.postedAt)}</span>}</div>
              {c.channels.map((ch) => {
                const r = c.results?.[ch];
                return (
                  <div key={ch} className="flex items-center gap-2 py-0.5">
                    <span>{CH_ICON[ch]}</span>
                    <span className="w-20">{CH_LABEL[ch]}</span>
                    {r?.ok ? (
                      r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="truncate text-indigo-600 underline">
                          Đã đăng — mở bài
                        </a>
                      ) : (
                        <span className="text-emerald-700">Đã đăng</span>
                      )
                    ) : r?.ok === false ? (
                      <span className="text-red-600">Lỗi: {r.error}</span>
                    ) : r?.manual ? (
                      <span className="text-slate-500">Đăng tay (đã gửi clip + caption vào Telegram)</span>
                    ) : (
                      <span className="text-slate-400">đang đăng…</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="rounded-xl border bg-white p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">Đăng lên kênh</div>
            <div className="flex flex-wrap gap-2">
              {(["facebook", "tiktok", "youtube"] as Channel[]).map((ch) => (
                <label key={ch} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${channels.includes(ch) ? "border-indigo-300 bg-indigo-50" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={channels.includes(ch)}
                    onChange={(e) => setChannels((cur) => (e.target.checked ? [...cur, ch] : cur.filter((x) => x !== ch)))}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  {CH_ICON[ch]} {CH_LABEL[ch]}
                  <span className="text-[10px] text-slate-500">{AUTO.includes(ch) ? "tự đăng" : "đăng tay"}</span>
                </label>
              ))}
            </div>
            {manualOnes.length > 0 && (
              <div className="mt-2 text-[11px] text-slate-500">
                {manualOnes.map((m) => CH_LABEL[m]).join(", ")}: tới giờ đăng bot gửi clip + caption vào Telegram để nhân viên đăng tay (chờ xin duyệt API).
              </div>
            )}
          </div>

          <CapBox title="📘 Facebook" value={caps.facebook.text} max={5000} rows={10} disabled={!editable} onChange={(v) => setCap("facebook", "text", v)} onToast={onToast} />
          <CapBox title="🎵 TikTok" value={caps.tiktok.text} max={2200} rows={4} disabled={!editable} onChange={(v) => setCap("tiktok", "text", v)} onToast={onToast} />
          <div className="rounded-xl border bg-white p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">▶️ YouTube Shorts</span>
              <CopyBtn text={`${caps.youtube.title}\n\n${caps.youtube.description}`} onToast={onToast} />
            </div>
            <input className={inputCls} value={caps.youtube.title} maxLength={100} disabled={!editable} onChange={(e) => setCap("youtube", "title", e.target.value)} placeholder="Tiêu đề" />
            <div className="mb-2 mt-0.5 text-right text-[11px] text-slate-400">{caps.youtube.title.length}/100</div>
            <textarea className={`${inputCls} min-h-[110px]`} value={caps.youtube.description} disabled={!editable} onChange={(e) => setCap("youtube", "description", e.target.value)} />
          </div>

          {editable && (
            <div className="rounded-xl border bg-white p-3">
              <div className="mb-1 text-sm font-medium text-slate-700">Giờ đăng</div>
              {c.status === "da_len_lich" ? (
                <input type="datetime-local" className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} />
              ) : (
                <>
                  <div className="mb-2 text-xs text-slate-500">
                    Bấm Duyệt sẽ tự xếp vào khung trống kế tiếp{slot ? `: ${fmt(slot)}` : ""}. Muốn giờ khác thì chọn:
                  </div>
                  <input type="datetime-local" className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} />
                </>
              )}
            </div>
          )}
          {err && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        </div>
      </div>

      {/* ---------- nút dưới đáy ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 md:static md:mt-4 md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-2">
          {(c.status === "cho_duyet" || c.status === "loi") && (
            <>
              <button onClick={() => act("reject")} disabled={!!busy} className="h-12 flex-1 rounded-xl border text-[15px] font-medium text-red-600 active:bg-red-50 disabled:opacity-50">
                ❌ Bỏ
              </button>
              <button onClick={() => act("approve")} disabled={!!busy || !channels.length} className="h-12 flex-[2] rounded-xl bg-emerald-600 text-[15px] font-semibold text-white active:bg-emerald-700 disabled:opacity-50">
                {busy === "approve" ? "Đang duyệt…" : "✅ Duyệt & xếp lịch"}
              </button>
              <button onClick={() => act("post-now")} disabled={!!busy || !channels.length} className="w-full text-center text-xs text-slate-500 underline md:w-auto md:px-3">
                Đăng ngay, không chờ lịch
              </button>
            </>
          )}
          {c.status === "da_len_lich" && (
            <>
              <button onClick={() => act("unschedule")} disabled={!!busy} className="h-12 flex-1 rounded-xl border text-[15px] font-medium active:bg-slate-100 disabled:opacity-50">
                Huỷ lịch
              </button>
              <button onClick={() => act("save")} disabled={!!busy || !dirty} className="h-12 flex-1 rounded-xl bg-indigo-600 text-[15px] font-semibold text-white active:bg-indigo-700 disabled:opacity-40">
                {busy === "save" ? "Đang lưu…" : "Lưu thay đổi"}
              </button>
              <button onClick={() => act("post-now")} disabled={!!busy} className="w-full text-center text-xs text-slate-500 underline md:w-auto md:px-3">
                Đăng ngay
              </button>
            </>
          )}
          {c.status === "bo" && (
            <button onClick={() => act("delete")} disabled={!!busy} className="h-12 flex-1 rounded-xl border text-[15px] font-medium text-red-600 active:bg-red-50 disabled:opacity-50">
              🗑 Xoá hẳn clip
            </button>
          )}
          {(c.status === "da_dang" || c.status === "dang_dang") && (
            <button onClick={onBack} className="h-12 flex-1 rounded-xl border text-[15px] font-medium active:bg-slate-100">
              Quay lại
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CapBox(p: { title: string; value: string; max: number; rows: number; disabled: boolean; onChange: (v: string) => void; onToast: (m: string) => void }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{p.title}</span>
        <CopyBtn text={p.value} onToast={p.onToast} />
      </div>
      <textarea className={inputCls} rows={p.rows} value={p.value} maxLength={p.max} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} />
      <div className={`mt-0.5 text-right text-[11px] ${p.value.length > p.max * 0.95 ? "text-red-600" : "text-slate-400"}`}>
        {p.value.length}/{p.max}
      </div>
    </div>
  );
}

export default MktPage;