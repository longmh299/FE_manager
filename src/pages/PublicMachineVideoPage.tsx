// src/pages/PublicMachineVideoPage.tsx
// ✅ Trang CÔNG KHAI — khách bấm vào link chia sẻ vào thẳng đây, KHÔNG cần đăng nhập.
// Không có nút tải xuống. Chặn chuột phải/kéo-thả để hạn chế tải dễ dàng
// (không phải DRM tuyệt đối — khách vẫn có thể quay màn hình, đây là giới hạn
// chung của mọi giải pháp phát video trên web không dùng DRM chuyên dụng).
//
// Hướng thiết kế: "tấm nhãn thông số máy" (equipment nameplate) — nền graphite
// tối như xưởng máy, khung góc kỹ thuật quanh khung hình video, mã máy trình
// bày như tem/plate kim loại chữ mono. Đa số khách xem trên điện thoại (đặc
// biệt iPhone) nên trang này tối ưu mobile-first: né tai thỏ/Dynamic Island,
// nền tối phủ kín kể cả khi Safari bounce-scroll, chiều cao tính theo dvh.
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";

type ShareData = {
  title: string;
  machineCode?: string | null;
  note?: string | null;
  mimeType: string;
  url: string;
};

const PAGE_BG = "#0B0F14";

// ✅ 4 góc khung kỹ thuật quanh video — mô-típ duy nhất lặp lại nhất quán
// (viewfinder / bản vẽ kỹ thuật), không thêm hiệu ứng nào khác.
const CornerBrackets: React.FC = () => (
  <>
    <span className="pointer-events-none absolute -top-px -left-px h-5 w-5 border-l-2 border-t-2 border-[#F2A93B]/70 sm:h-6 sm:w-6" />
    <span className="pointer-events-none absolute -top-px -right-px h-5 w-5 border-r-2 border-t-2 border-[#F2A93B]/70 sm:h-6 sm:w-6" />
    <span className="pointer-events-none absolute -bottom-px -left-px h-5 w-5 border-b-2 border-l-2 border-[#F2A93B]/70 sm:h-6 sm:w-6" />
    <span className="pointer-events-none absolute -bottom-px -right-px h-5 w-5 border-b-2 border-r-2 border-[#F2A93B]/70 sm:h-6 sm:w-6" />
  </>
);

const PublicMachineVideoPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/public/machine-videos/${token}`);
        if (!cancelled) setData(res.data);
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.response?.data?.message ||
              "Không xem được video này. Link có thể đã hết hạn hoặc bị thu hồi."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (token) load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // nhẹ nhàng fade-in đúng 1 lần khi nội dung sẵn sàng, tôn trọng reduced-motion
  useEffect(() => {
    if (!loading) requestAnimationFrame(() => setMounted(true));
  }, [loading]);

  // ✅ Tab trình duyệt của khách không nên hiện "Quản Lý Kho - MCBROTHER" (tên
  // app nội bộ) khi họ đang xem 1 video sản phẩm — đổi tiêu đề đúng theo video,
  // trả lại tiêu đề cũ khi rời trang (phòng trường hợp app vẫn chạy nền/SPA).
  useEffect(() => {
    const prevTitle = document.title;
    if (data?.title) {
      document.title = `${data.title} - MCBROTHER`;
    } else if (error) {
      document.title = "Video không khả dụng - MCBROTHER";
    }
    return () => {
      document.title = prevTitle;
    };
  }, [data, error]);

  // ✅ Trang này đứng ngoài Layout của app (không có body nền sáng bọc sẵn).
  // Tự set màu nền cho <html>/<body> trong lúc trang này mở, để không lộ màu
  // sáng ở mép/khi Safari iOS bounce-scroll, rồi trả lại như cũ lúc rời trang.
  useEffect(() => {
    const html = document.documentElement;
    const prevHtmlBg = html.style.backgroundColor;
    const prevBodyBg = document.body.style.backgroundColor;
    html.style.backgroundColor = PAGE_BG;
    document.body.style.backgroundColor = PAGE_BG;
    return () => {
      html.style.backgroundColor = prevHtmlBg;
      document.body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  return (
    <div
      className="relative min-h-[100dvh] overflow-hidden"
      style={{
        backgroundColor: PAGE_BG,
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.045) 1px, transparent 0)",
        backgroundSize: "22px 22px",
        // ✅ né tai thỏ / Dynamic Island / home indicator, cộng thêm khoảng đệm cơ bản
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.75rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.75rem)",
        paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
        paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
      }}
    >
      {/* vệt sáng dịu phía trên, gợi ánh đèn xưởng — tĩnh, không animate */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-40 h-80 opacity-40"
        style={{
          background:
            "radial-gradient(60% 100% at 50% 0%, rgba(242,169,59,0.14), transparent 70%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-3xl">
        {/* eyebrow / thương hiệu */}
        <div className="mb-5 flex items-center justify-center gap-2 sm:mb-6 sm:gap-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#F2A93B]" />
          <span
            className="text-center text-[10px] font-semibold uppercase text-[#8A94A3] sm:text-[11px]"
            style={{ letterSpacing: "0.18em" }}
          >
            MCBROTHER · Video hướng dẫn vận hành
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#223142] bg-[#131A22] px-6 py-16 sm:py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2C394A] border-t-[#F2A93B]" />
            <div className="mt-4 text-sm text-[#8A94A3]">Đang tải video...</div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[#3A2A1F] bg-[#1A1512] px-6 py-14 text-center sm:py-16">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#E0954D"
              strokeWidth="1.6"
              className="mb-3"
            >
              <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.3 2.25h17.76a1.5 1.5 0 0 0 1.3-2.25L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
            </svg>
            <div className="text-sm text-[#D8B199]">{error}</div>
          </div>
        ) : data ? (
          <div
            className={[
              "rounded-2xl border border-[#223142] bg-[#131A22] p-3 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] transition-all duration-500 motion-reduce:transition-none sm:p-6",
              mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
            ].join(" ")}
          >
            {/* tiêu đề + tem mã máy kiểu nhãn kim loại */}
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2 px-1 sm:mb-4 sm:gap-3 sm:px-0">
              <h1 className="text-base font-semibold leading-snug text-[#ECEFF3] sm:text-xl">
                {data.title}
              </h1>
              {data.machineCode && (
                <span
                  className="shrink-0 rounded-md border border-[#3A4656] bg-[#0F151C] px-2.5 py-1 text-xs font-medium text-[#F2A93B]"
                  style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.04em" }}
                >
                  {data.machineCode}
                </span>
              )}
            </div>

            {/* khung video + 4 góc kỹ thuật, tự co theo tỉ lệ video thật (không kéo dãn) */}
            <div className="relative flex items-center justify-center rounded-lg bg-black p-px">
              <CornerBrackets />
              <div
                className="relative select-none"
                onContextMenu={(e) => e.preventDefault()} // ✅ chặn chuột phải -> "Lưu video"
              >
                <video
                  src={data.url}
                  controls
                  playsInline
                  controlsList="nodownload noremoteplayback" // ✅ ẩn nút tải / cast trên trình duyệt hỗ trợ
                  disablePictureInPicture // ✅ chặn 1 đường tải phụ qua cửa sổ PiP
                  onContextMenu={(e) => e.preventDefault()}
                  className="block max-h-[62dvh] max-w-full rounded-lg sm:max-h-[68dvh]"
                  style={{ width: "auto", height: "auto" }}
                />

                {/* ✅ Watermark — phủ đè bằng CSS, KHÔNG nằm trong file thật (nên video
                    tải qua F12 sẽ không có watermark). Lặp chéo góc khắp khung hình
                    (không chỉ 1 góc) để nếu ai quay màn hình rồi cắt crop bớt khung
                    hình, watermark vẫn còn dính lại — mờ nhẹ, không cản trở xem nội
                    dung. Không phải giải pháp chống sao chép tuyệt đối, chỉ giảm giá
                    trị của bản quay lại + nhắc đây là nội dung riêng tư. */}
                <div
                  className="pointer-events-none absolute inset-0 select-none rounded-lg"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='130' height='90'%3E%3Ctext x='65' y='48' transform='rotate(-28 65 48)' font-family='sans-serif' font-size='10' font-weight='600' fill='white' fill-opacity='0.16' text-anchor='middle'%3EMCBROTHER%3C/text%3E%3C/svg%3E\")",
                    backgroundRepeat: "repeat",
                    backgroundSize: "130px 90px",
                  }}
                />
              </div>
            </div>

            {data.note && (
              <p className="mt-4 border-t border-[#1E2733] px-1 pt-3 text-sm leading-relaxed text-[#8A94A3] sm:px-0">
                {data.note}
              </p>
            )}
          </div>
        ) : null}

        {/* ===== chân trang: nhắc bảo mật nhẹ + thông tin công ty ===== */}
        <div className="mt-7 flex flex-col items-center gap-4 text-center sm:mt-8">
          <p className="text-xs text-[#4F5A68]">
            Video chia sẻ riêng cho bạn — vui lòng không sao chép hoặc phát tán lại.
          </p>

          <div className="flex w-full max-w-xs items-center gap-3">
            <span className="h-px flex-1 bg-[#1E2733]" />
            <span className="h-1 w-1 rounded-full bg-[#2C394A]" />
            <span className="h-px flex-1 bg-[#1E2733]" />
          </div>

          <div className="flex flex-col items-center gap-1">
            <span
              className="text-xs font-semibold uppercase text-[#8A94A3]"
              style={{ letterSpacing: "0.16em" }}
            >
              MCBROTHER
            </span>
            <a
              href="https://mcbrother.com.vn"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#F2A93B] underline-offset-4 hover:underline"
            >
              mcbrother.com.vn
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicMachineVideoPage;