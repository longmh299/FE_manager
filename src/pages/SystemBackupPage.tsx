// src/pages/SystemBackupPage.tsx
// ✅ "Sao lưu & hệ thống" (admin) — dùng tốt trên điện thoại
//  - Tình trạng: máy chủ, database, kho file R2, bản sao lưu gần nhất, mail báo cáo dự phòng
//  - Gửi ngay mail báo cáo dự phòng (Excel tồn kho, công nợ, hoá đơn 30 ngày)
//  - Danh sách bản sao lưu (30 ngày / 12 tháng / mỗi năm), tải về (cần mật khẩu cấp 2)
//  - Thao tác cần để ý 7 ngày gần nhất (xoá, mở lại hoá đơn, huỷ phiếu, chỉnh tồn...)
//  - Lối tắt sang Neon / Render / GitHub / Vercel khi cần xử lý sự cố
import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "../api/client";
import { PinActionDialog } from "../components/SecondPassword";

type Status = {
  now: string;
  server: { ok: boolean; uptimeSec: number; node: string; commit: string | null };
  db: { ok: boolean; ms: number; error?: string };
  r2: { ok: boolean; ms: number; error?: string; configured: boolean };
  backup: { configured: boolean; ok: boolean; at: string | null; ageHours: number | null; key: string | null; size: number | null; run: string | null; error?: string };
  dailyReport: { configured: boolean; enabled: boolean; lastSentAt: string | null };
};
type BackupFile = { key: string; group: "daily" | "monthly" | "yearly"; label: string; size: number; lastModified: string | null };
type Activity = { id: string; at: string; action: string; label: string; user: string | null; role: string | null; ref: string | null };

const fmtTime = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso))
    : "—";
const fmtSize = (b: number | null | undefined) => (b == null ? "—" : b >= 1048576 ? `${(b / 1048576).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtAge = (h: number | null | undefined) => (h == null ? "" : h < 1 ? "vừa xong" : h < 48 ? `${Math.round(h)} giờ trước` : `${Math.round(h / 24)} ngày trước`);
const fmtUptime = (s: number) => (s < 3600 ? `${Math.round(s / 60)} phút` : s < 172800 ? `${Math.round(s / 3600)} giờ` : `${Math.round(s / 86400)} ngày`);
const errMsg = (e: any) => e?.response?.data?.message || e?.message || "Có lỗi xảy ra";

const LINKS = [
  { href: "https://console.neon.tech", title: "Neon", sub: "Database: khôi phục về giờ trước (gói free lùi được 6 giờ)" },
  { href: "https://dashboard.render.com", title: "Render", sub: "Máy chủ BE: xem lỗi, khởi động lại, đổi biến môi trường" },
  { href: "https://github.com/longmh299/be_manager/actions", title: "GitHub Actions", sub: "Lịch sao lưu mỗi đêm, bấm chạy tay khi cần" },
  { href: "https://vercel.com/dashboard", title: "Vercel", sub: "Giao diện web (FE)" },
  { href: "https://dash.cloudflare.com", title: "Cloudflare R2", sub: "Kho file + nơi chứa bản sao lưu" },
];

const Dot: React.FC<{ tone: "ok" | "bad" | "off" }> = ({ tone }) => (
  <span
    aria-hidden
    className={`mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${tone === "ok" ? "bg-emerald-500" : tone === "bad" ? "bg-rose-500" : "bg-slate-300"}`}
  />
);

const Row: React.FC<{ tone: "ok" | "bad" | "off"; title: string; value: React.ReactNode; sub?: React.ReactNode }> = ({ tone, title, value, sub }) => (
  <div className="flex gap-3 border-b border-slate-100 py-3 last:border-0">
    <Dot tone={tone} />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium text-slate-800">{title}</span>
        <span className={`text-sm ${tone === "bad" ? "font-semibold text-rose-700" : "text-slate-600"}`}>{value}</span>
      </div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  </div>
);

const Card: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, right, children }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {right}
    </div>
    {children}
  </section>
);

const SystemBackupPage: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [files, setFiles] = useState<BackupFile[] | null>(null);
  const [filesErr, setFilesErr] = useState<string | null>(null);
  const [group, setGroup] = useState<BackupFile["group"]>("daily");
  const [showAll, setShowAll] = useState(false);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [pinFor, setPinFor] = useState<BackupFile | null>(null);
  const [download, setDownload] = useState<{ url: string; fileName: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setStatusErr(null);
    try {
      const r = await api.get("/system/status");
      setStatus(r.data?.data || null);
    } catch (e) {
      setStatusErr(errMsg(e));
    } finally {
      setLoading(false);
    }
    api
      .get("/system/backups")
      .then((r) => {
        setFiles(Array.isArray(r.data?.data) ? r.data.data : []);
        setFilesErr(null);
      })
      .catch((e) => setFilesErr(errMsg(e)));
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    setActivity(null);
    api
      .get("/system/activity", { params: { days } })
      .then((r) => setActivity(Array.isArray(r.data?.data?.rows) ? r.data.data.rows : []))
      .catch(() => setActivity([]));
  }, [days]);

  const groups = useMemo(() => {
    const g = { daily: [] as BackupFile[], monthly: [] as BackupFile[], yearly: [] as BackupFile[] };
    for (const f of files || []) g[f.group].push(f);
    return g;
  }, [files]);

  const sendReport = async () => {
    setSending(true);
    setNote(null);
    try {
      const r = await api.post("/system/daily-report/send");
      const to: string[] = r.data?.data?.to || [];
      setNote({ ok: true, text: `Đã gửi báo cáo dự phòng tới ${to.join(", ") || "hộp mail dự phòng"}.` });
      void loadStatus();
    } catch (e) {
      setNote({ ok: false, text: errMsg(e) });
    } finally {
      setSending(false);
    }
  };

  const s = status;
  const backupTone: "ok" | "bad" | "off" = !s ? "off" : !s.backup.configured ? "off" : s.backup.ok ? "ok" : "bad";
  const allOk = !!s && s.db.ok && s.r2.ok && s.backup.ok;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-4 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Sao lưu & hệ thống</h1>
          <p className="mt-0.5 text-sm text-slate-500">Kiểm tra web, tải bản sao lưu, xem ai vừa làm thao tác quan trọng.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={loading}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </button>
      </div>

      {s && (
        <div
          role="status"
          className={`rounded-2xl px-4 py-3 text-sm font-medium ${allOk ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}
        >
          {allOk ? "Mọi thứ đang ổn." : "Có mục cần kiểm tra, xem các dòng màu đỏ bên dưới."}
        </div>
      )}
      {statusErr && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">Không lấy được tình trạng: {statusErr}</div>}

      <Card title="Tình trạng">
        {!s ? (
          <div className="py-6 text-center text-sm text-slate-400">{loading ? "Đang kiểm tra…" : "—"}</div>
        ) : (
          <div>
            <Row tone="ok" title="Máy chủ (BE)" value="Đang chạy" sub={`Đã chạy liên tục ${fmtUptime(s.server.uptimeSec)} · Node ${s.server.node}${s.server.commit ? ` · bản ${s.server.commit}` : ""}`} />
            <Row tone={s.db.ok ? "ok" : "bad"} title="Database (Neon)" value={s.db.ok ? `Ổn · ${s.db.ms} ms` : "Lỗi kết nối"} sub={s.db.error} />
            <Row
              tone={!s.r2.configured ? "off" : s.r2.ok ? "ok" : "bad"}
              title="Kho file (Cloudflare R2)"
              value={!s.r2.configured ? "Chưa cài" : s.r2.ok ? `Ổn · ${s.r2.ms} ms` : "Lỗi kết nối"}
              sub={s.r2.error}
            />
            <Row
              tone={backupTone}
              title="Sao lưu database"
              value={s.backup.at ? `${fmtTime(s.backup.at)} (${fmtAge(s.backup.ageHours)})` : "Chưa có"}
              sub={
                s.backup.ok ? (
                  <>
                    Bản gần nhất {fmtSize(s.backup.size)}. Sao lưu tự chạy mỗi đêm.
                    {s.backup.run ? (
                      <>
                        {" "}
                        <a className="underline" href={s.backup.run} target="_blank" rel="noreferrer">
                          Xem lần chạy
                        </a>
                      </>
                    ) : null}
                  </>
                ) : (
                  s.backup.error || "Quá lâu chưa có bản sao lưu mới. Mở GitHub Actions xem lần chạy gần nhất có lỗi không."
                )
              }
            />
            <Row
              tone={!s.dailyReport.configured || !s.dailyReport.enabled ? "off" : "ok"}
              title="Mail báo cáo dự phòng"
              value={!s.dailyReport.configured ? "Chưa cài email" : !s.dailyReport.enabled ? "Đang tắt" : s.dailyReport.lastSentAt ? `Gửi lần cuối ${fmtTime(s.dailyReport.lastSentAt)}` : "Chưa gửi lần nào"}
              sub={
                s.dailyReport.configured
                  ? "Mỗi sáng (trừ chủ nhật) gửi Excel tồn kho, công nợ, hoá đơn 30 ngày về hộp mail dự phòng (riêng, không phải mail báo cáo tháng)."
                  : "Cài biến DAILY_REPORT_EMAIL_TO trên Render (email nhận riêng, vd 1 Gmail dự phòng) để bật."
              }
            />
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void sendReport()}
            disabled={sending || !s?.dailyReport.configured}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {sending ? "Đang gửi…" : "Gửi báo cáo dự phòng ngay"}
          </button>
          <span className="text-xs text-slate-500">Dùng trước khi làm việc lớn hoặc khi web có dấu hiệu lỗi.</span>
        </div>
        {note && (
          <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${note.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`} role="status">
            {note.text}
          </div>
        )}
      </Card>

      <Card
        title="Bản sao lưu"
        right={
          <div className="flex rounded-xl bg-slate-100 p-0.5 text-xs font-medium" role="tablist">
            {(
              [
                ["daily", "Theo ngày"],
                ["monthly", "Theo tháng"],
                ["yearly", "Theo năm"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={group === k}
                onClick={() => {
                  setGroup(k);
                  setShowAll(false);
                }}
                className={`rounded-lg px-2.5 py-1.5 ${group === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
              >
                {label} ({groups[k].length})
              </button>
            ))}
          </div>
        }
      >
        <p className="mb-2 text-xs text-slate-500">
          Giữ 30 ngày gần nhất, 12 tháng gần nhất và một bản mỗi năm. Đây là file database đầy đủ (.dump), chỉ người kỹ thuật dùng để khôi phục; xem số liệu hằng ngày thì dùng mail báo cáo dự phòng.
        </p>
        {filesErr ? (
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{filesErr}</div>
        ) : files === null ? (
          <div className="py-6 text-center text-sm text-slate-400">Đang tải…</div>
        ) : groups[group].length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">Chưa có bản sao lưu nào ở mục này.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(showAll ? groups[group] : groups[group].slice(0, 7)).map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800">{f.label}</div>
                  <div className="text-xs text-slate-500">
                    {fmtSize(f.size)} · lưu lúc {fmtTime(f.lastModified)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDownload(null);
                    setPinFor(f);
                  }}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Tải về
                </button>
              </li>
            ))}
          </ul>
        )}
        {!showAll && groups[group].length > 7 && (
          <button type="button" onClick={() => setShowAll(true)} className="mt-1 w-full rounded-lg py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Xem thêm {groups[group].length - 7} bản cũ hơn
          </button>
        )}
        {download && (
          <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Link tải sẵn sàng (hết hạn sau 10 phút):{" "}
            <a className="font-semibold underline" href={download.url} download={download.fileName}>
              {download.fileName}
            </a>
          </div>
        )}
      </Card>

      <Card
        title="Thao tác cần để ý"
        right={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
            aria-label="Khoảng thời gian"
          >
            <option value={1}>Hôm nay</option>
            <option value={7}>7 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
        }
      >
        <p className="mb-2 text-xs text-slate-500">Xoá, mở lại hoá đơn đã duyệt, huỷ phiếu thu chi, chỉnh tồn, nhập file, gộp khách, đặt lại mật khẩu… Số liệu sai thì xem ở đây trước.</p>
        {activity === null ? (
          <div className="py-6 text-center text-sm text-slate-400">Đang tải…</div>
        ) : activity.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">Không có thao tác nào trong khoảng này.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activity.map((a) => (
              <li key={a.id} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium text-slate-800">{a.label}</span>
                  <span className="text-xs text-slate-500">{fmtTime(a.at)}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {a.user || "?"}
                  {a.ref ? ` · ${a.ref}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Khi web gặp sự cố">
        <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Vẫn cần tra tồn kho, công nợ: mở mail "Báo cáo dự phòng" mới nhất, file Excel đính kèm.</li>
          <li>Web không vào được: mở Render xem máy chủ có lỗi không, bấm khởi động lại (Manual Deploy / Restart).</li>
          <li>Lỡ xoá hay sửa sai trong vài giờ gần đây: vào Neon, khôi phục về thời điểm trước lúc lỗi.</li>
          <li>Lỗi phát hiện muộn hơn: nhờ người kỹ thuật dùng bản sao lưu ở trên để khôi phục.</li>
        </ol>
        <div className="grid gap-2 sm:grid-cols-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-200 px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="text-sm font-medium text-slate-800">{l.title} ↗</div>
              <div className="text-xs text-slate-500">{l.sub}</div>
            </a>
          ))}
        </div>
      </Card>

      <PinActionDialog
        open={!!pinFor}
        title="Tải bản sao lưu database"
        confirmLabel="Tạo link tải"
        onClose={() => setPinFor(null)}
        onSubmit={async (pin) => {
          const r = await api.post("/system/backups/download", { key: pinFor?.key, pin });
          const d = r.data?.data;
          setPinFor(null);
          if (d?.url) {
            setDownload({ url: d.url, fileName: d.fileName });
            window.location.assign(d.url);
          }
        }}
      >
        {pinFor && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {pinFor.label} · {fmtSize(pinFor.size)}
            <div className="mt-1 text-xs text-slate-500">File chứa toàn bộ dữ liệu công ty. Không gửi cho người ngoài.</div>
          </div>
        )}
      </PinActionDialog>
    </div>
  );
};

export default SystemBackupPage;