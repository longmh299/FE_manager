// src/components/Layout.tsx
import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LowStockBell } from "./LowStockBell";
import { ChatWidget } from "./ChatWidget";
// ✅ Menu chia theo CÔNG VIỆC HẰNG NGÀY (không theo kỹ thuật):
//    Bán hàng → Kho hàng → Tiền & công nợ → Báo cáo → Tài liệu & marketing → Hệ thống
//    Quyền xem từng trang giữ nguyên như cũ, chỉ đổi chỗ + đổi tên cho dễ hiểu.
type NavItem = { to: string; label: string; hint?: string };
type NavGroup = { key: string; title: string; icon: IconName; links: NavItem[] };
type IconName = "sales" | "stock" | "money" | "report" | "docs" | "system" | "user";

const LS_KEY = "sidebar_open_group_v4"; // ✅ accordion: lưu 1 nhóm đang mở (v4: nhóm mới)

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  sales: (
    <>
      <path d="M6 3h12l1 5H5l1-5z" />
      <path d="M5 8v12h14V8" />
      <path d="M9 12h6" />
    </>
  ),
  stock: (
    <>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </>
  ),
  money: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  report: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  docs: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </>
  ),
  system: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
};
const NavIcon: React.FC<{ name: IconName; className?: string }> = ({ name, className = "h-[18px] w-[18px]" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICON_PATHS[name]}
  </svg>
);

const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const role = user?.role;

  const isAdmin = role === "admin";
  const isAccountant = role === "accountant";
  const isStaff = role === "staff";
  const canSeeAuditLogs = isAdmin || isAccountant;

  // ✅ chỉ admin/accountant thấy phiếu kho
  const canSeeMovements = isAdmin;

  const location = useLocation();

  // ✅ chặn route "Doanh số cá nhân" nếu không phải staff
  if (!isStaff && location.pathname.startsWith("/me/sales")) {
    return <Navigate to="/" replace />;
  }

  // ✅ chặn route "Phiếu kho" nếu không phải admin/accountant
  if (!canSeeMovements && location.pathname.startsWith("/movements")) {
    return <Navigate to="/" replace />;
  }

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `block rounded px-3 py-2 ${isActive ? "bg-slate-700" : "hover:bg-slate-800"
    }`;

  // ✅ trang con trong nhóm: chữ nhỏ hơn, dòng sát hơn; trang đang xem có vạch xanh đè lên đường kẻ dọc
  const subNavCls = ({ isActive }: { isActive: boolean }) =>
    [
      "block rounded-r py-1.5 text-[13px] leading-5 transition-colors",
      isActive
        ? "-ml-[9px] pl-[19px] pr-3 border-l-2 border-sky-400 bg-slate-800 text-white font-medium"
        : "px-3 text-slate-300 hover:text-white hover:bg-slate-800/60",
    ].join(" ");

  const linkMatch = (to: string) => {
    const p = location.pathname;
    if (to.startsWith("/")) return p.startsWith(to);
    return p.includes(`/${to}`);
  };

  const groupHasActive = (links: Array<{ to: string }>) =>
    links.some((l) => linkMatch(l.to));

  // ===== MENU (admin / kế toán) — chia theo việc hằng ngày =====
  const groups: NavGroup[] = useMemo(() => {
    const AA = isAdmin || isAccountant;
    const g: NavGroup[] = [
      {
        key: "sales",
        title: "Bán hàng",
        icon: "sales",
        links: [
          { to: "/invoices", label: "Hoá đơn bán / nhập", hint: "Lập, duyệt, thu tiền, in hoá đơn" },
          ...(AA ? [{ to: "/sales-returns", label: "Khách trả hàng" }] : []),
          { to: "/partners", label: "Khách hàng" },
          { to: "/reports/invoice-trace", label: "Tra hoá đơn theo mã máy" },
        ],
      },
      {
        key: "stock",
        title: "Kho hàng",
        icon: "stock",
        links: [
          { to: "/machine-stocks", label: "Tồn máy móc" },
          { to: "/part-stocks", label: "Tồn linh kiện" },
          ...(canSeeMovements ? [{ to: "/movements", label: "Điều chỉnh tồn / giá vốn" }] : []),
          ...(AA ? [{ to: "/stock-counts", label: "Kiểm kê kho" }] : []),
          ...(AA ? [{ to: "/reports/ledger", label: "Sổ kho (thẻ kho)" }] : []),
          ...(AA ? [{ to: "/reports/stock-inout", label: "Nhập – xuất – tồn" }] : []),
          ...(isAdmin ? [{ to: "/stock-import-opening", label: "Nhập tồn đầu kỳ (file)" }] : []),
        ],
      },
      {
        key: "money",
        title: "Tiền & công nợ",
        icon: "money",
        links: [
          ...(AA ? [{ to: "/cashbook", label: "Thu chi (sổ quỹ)" }] : []),
          ...(AA ? [{ to: "/debts/by-sale", label: "Công nợ khách hàng" }] : []),
          ...(isAdmin ? [{ to: "/payment-accounts", label: "Tài khoản nhận tiền" }] : []), // ✅ thêm/sửa TK: chỉ quản trị
        ],
      },
      {
        key: "reports",
        title: "Báo cáo",
        icon: "report",
        links: [
          { to: "/revenue", label: "Doanh thu" },
          ...(AA ? [{ to: "/reports/sales-ledger", label: "Bảng kê bán hàng" }] : []),
          ...(isAdmin ? [{ to: "/reports/best-sellers", label: "Hàng bán chạy" }] : []),
          ...(isAdmin ? [{ to: "/analytics", label: "Lượt truy cập website" }] : []),
        ],
      },
      {
        key: "docs",
        title: "Tài liệu & marketing",
        icon: "docs",
        links: [
          { to: "/quote-documents", label: "Kho báo giá" },
          { to: "/machine-videos", label: "Video vận hành máy" },
          { to: "/machine-images", label: "Kho ảnh máy, linh kiện" },
          { to: "/translate", label: "Dịch tài liệu" },
          ...(isAdmin ? [{ to: "/mkt", label: "Hàng chờ đăng MKT" }] : []),
        ],
      },
      {
        key: "system",
        title: "Hệ thống",
        icon: "system",
        links: [
          ...(isAdmin ? [{ to: "/users", label: "Nhân viên & phân quyền" }] : []),
          ...(canSeeAuditLogs ? [{ to: "/audit-logs", label: "Lịch sử thao tác" }] : []),
          { to: "/change-password", label: "Đổi mật khẩu" },
        ],
      },
    ];
    return g.filter((x) => x.links.length > 0);
  }, [isAdmin, isAccountant, canSeeMovements, canSeeAuditLogs]);

  // ===== MENU nhân viên bán hàng: ít trang -> liệt kê thẳng, chia mục có tiêu đề nhỏ =====
  const staffSections: Array<{ title: string; icon: IconName; links: NavItem[] }> = useMemo(
    () => [
      {
        title: "Bán hàng",
        icon: "sales",
        links: [
          { to: "/invoices", label: "Hoá đơn" },
          { to: "/partners", label: "Khách hàng" },
          { to: "/me/sales", label: "Doanh số của tôi" },
        ],
      },
      {
        title: "Kho hàng",
        icon: "stock",
        links: [
          { to: "/machine-stocks", label: "Tồn máy móc" },
          { to: "/part-stocks", label: "Tồn linh kiện" },
        ],
      },
      {
        title: "Tài liệu",
        icon: "docs",
        links: [
          { to: "/quote-documents", label: "Kho báo giá" },
          { to: "/machine-videos", label: "Video vận hành máy" },
          { to: "/machine-images", label: "Kho ảnh máy, linh kiện" },
          { to: "/translate", label: "Dịch tài liệu" },
        ],
      },
      { title: "Tài khoản", icon: "user", links: [{ to: "/change-password", label: "Đổi mật khẩu" }] },
    ],
    []
  );

  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // ✅ Mobile drawer + Desktop collapse
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  // ✅ track breakpoint reliably (fix rotate lag)
  // ⚠️ Dùng window.innerWidth (LUÔN bao gồm độ rộng thanh cuộn dọc nếu có)
  // thay vì matchMedia("(min-width: 768px)") — matchMedia đo theo viewport
  // CSS, ở 1 số trình duyệt viewport này BỊ TRỪ ĐI độ rộng thanh cuộn khi nó
  // xuất hiện. Hậu quả: trang có nhiều dữ liệu hơn (cần cuộn dọc) có thể bị
  // tính nhầm là "dưới 768px" dù cửa sổ trình duyệt không hề đổi kích thước,
  // khiến sidebar tự thu gọn như trên mobile chỉ vì trang đó dài hơn các
  // trang khác — đúng như hiện tượng bạn gặp ở trang video (13 dòng, cần
  // cuộn dọc, các trang khác ít dòng hơn thì không cần).
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      const next = window.innerWidth >= 768;
      setIsDesktop(next);

      // ✅ reset state when crossing breakpoint to avoid stuck/lag
      setMobileMenuOpen(false);
      // desktopCollapsed giữ nguyên (tuỳ bạn), nhưng mobile thì nó không ảnh hưởng width
    };

    handler();
    window.addEventListener("resize", handler);

    return () => {
      window.removeEventListener("resize", handler);
    };
  }, []);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // ✅ click 1 nút: mobile => toggle drawer | desktop => toggle collapse
  const onToggleMenu = () => {
    if (isDesktop) setDesktopCollapsed((v) => !v);
    else setMobileMenuOpen((v) => !v);
  };

  // Auto close drawer when route changed (mobile)
  useEffect(() => {
    closeMobileMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // ESC closes drawer (mobile)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobileMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ✅ vào trang nào -> tự mở đúng nhóm chứa trang đó; trang không thuộc nhóm nào -> mở lại nhóm lần trước
  useEffect(() => {
    if (isStaff) return;
    const hit = groups.find((g) => groupHasActive(g.links));
    if (hit) {
      setOpenGroup(hit.key);
      return;
    }
    try {
      const last = localStorage.getItem(LS_KEY);
      if (last && groups.some((g) => g.key === last)) setOpenGroup(last);
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isStaff, role]); // role: danh sách trang theo quyền chỉ có sau khi tải xong user

  // nhớ nhóm đang mở
  useEffect(() => {
    if (isStaff || !openGroup) return;
    try {
      localStorage.setItem(LS_KEY, openGroup);
    } catch { }
  }, [openGroup, isStaff]);

  const toggleGroup = (k: string) => {
    // menu đang thu nhỏ (chỉ còn icon): bấm icon -> mở rộng menu + mở nhóm đó
    if (desktopCollapsed) {
      setDesktopCollapsed(false);
      setOpenGroup(k);
      return;
    }
    setOpenGroup((prev) => (prev === k ? null : k));
  };

  const Group = ({ g }: { g: NavGroup }) => {
    const opened = openGroup === g.key && !desktopCollapsed;
    const active = groupHasActive(g.links);

    return (
      <div className="mb-0.5">
        <button
          type="button"
          onClick={() => toggleGroup(g.key)}
          className={[
            "w-full flex items-center gap-2.5 rounded-lg py-2 text-[14px] font-medium transition-colors",
            desktopCollapsed ? "justify-center px-0" : "px-3",
            active ? "text-white" : "text-slate-300 hover:text-white",
            opened || (desktopCollapsed && active) ? "bg-slate-800" : "hover:bg-slate-800/60",
          ].join(" ")}
          title={desktopCollapsed ? g.title : opened ? "Thu gọn" : "Mở rộng"}
          aria-expanded={opened}
        >
          <span className={active ? "text-sky-400" : "text-slate-400"}>
            <NavIcon name={g.icon} />
          </span>
          {!desktopCollapsed && (
            <>
              <span className="flex-1 truncate text-left">{g.title}</span>
              <svg
                viewBox="0 0 24 24"
                className={`h-3.5 w-3.5 text-slate-500 transition-transform duration-150 ${opened ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>

        {opened && (
          <div className="ml-[21px] mt-0.5 mb-2 pl-2 border-l border-slate-700 space-y-0.5">
            {g.links.map((l) => (
              <NavLink key={l.to} to={l.to} className={subNavCls} title={l.hint}>
                {l.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  };

  const SidebarContent = () => (
    <>
      <div className="p-4 border-b border-slate-700">
        <h1 className={`font-bold ${desktopCollapsed ? "text-base" : "text-lg"}`}>
          {desktopCollapsed ? "QLK" : "Quản Lý Kho"}
        </h1>
        {!desktopCollapsed && <p className="text-xs text-slate-300 mt-1">MCBROTHER</p>}
      </div>

      <nav className="flex-1 p-2 text-sm overflow-y-auto">
        {isStaff ? (
          <div className="space-y-3">
            {staffSections.map((sec) => (
              <div key={sec.title}>
                {!desktopCollapsed && (
                  <div className="flex items-center gap-2 px-3 pb-1 pt-1 text-[12px] font-medium text-slate-400">
                    <NavIcon name={sec.icon} className="h-4 w-4" />
                    {sec.title}
                  </div>
                )}
                <div className="space-y-0.5">
                  {sec.links.map((l) => (
                    <NavLink key={l.to} to={l.to} className={navCls} title={desktopCollapsed ? l.label : undefined}>
                      {desktopCollapsed ? (
                        <span className="flex justify-center">
                          <NavIcon name={sec.icon} className="h-4 w-4" />
                        </span>
                      ) : (
                        l.label
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div>
            {groups.map((g) => (
              <Group key={g.key} g={g} />
            ))}
          </div>
        )}
      </nav>

      <div className="p-3 pb-safe border-t border-slate-700 text-xs">
        {!desktopCollapsed && (
          <div className="mb-2">
            Đăng nhập:{" "}
            <span className="font-semibold">{user?.fullName || user?.username}</span>{" "}
            ({user?.role === "admin" ? "Quản trị" : user?.role === "accountant" ? "Kế toán" : user?.role === "staff" ? "Nhân viên" : user?.role})
          </div>
        )}
        <button
          onClick={logout}
          className="w-full text-left text-red-300 hover:text-red-200"
          title="Đăng xuất"
        >
          {desktopCollapsed ? "⎋" : "Đăng xuất"}
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex bg-slate-100 overflow-hidden">
      {/* MOBILE overlay */}
      {!isDesktop && mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={[
          "bg-slate-900 text-slate-100 flex flex-col h-screen pt-safe pl-safe",
          "transition-transform duration-200 ease-out",
          // desktop width collapse
          desktopCollapsed ? "md:w-20" : "md:w-64",
          // desktop position
          "md:sticky md:top-0 md:translate-x-0 md:z-auto",
          // mobile drawer base
          "fixed top-0 left-0 z-50 w-72 max-w-[85vw] md:static md:max-w-none",
          // ✅ ONLY ONE translate controller for mobile (fix rotate lag)
          !isDesktop && !mobileMenuOpen ? "-translate-x-full" : "translate-x-0",
        ].join(" ")}
      >
        <SidebarContent />
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col max-h-screen overflow-hidden min-w-0">
        <header className="min-h-14 pt-safe pl-safe pr-safe bg-white border-b border-slate-200 flex items-center px-4 gap-3">
          <button
            type="button"
            onClick={onToggleMenu}
            className="inline-flex items-center justify-center rounded px-3 py-2 border border-slate-200 hover:bg-slate-50"
            aria-label="Menu"
            title="Mở/thu nhỏ menu"
          >
            <span className="text-sm font-semibold">
              {isDesktop ? (desktopCollapsed ? "☰" : "☰") : mobileMenuOpen ? "✕" : "☰"}
            </span>
          </button>

          <h2 className="font-semibold text-slate-800 text-lg flex-1 truncate">
            Hệ thống quản lý kho
          </h2>

          <div className="flex items-center gap-2">
            <LowStockBell />
          </div>
          {/* ✅ Trang Dịch tài liệu / Hàng chờ MKT có thanh nút dưới đáy -> ẩn bong bóng chat chung để không che */}
          {!location.pathname.startsWith("/translate") && !location.pathname.startsWith("/mkt") && <ChatWidget />}
        </header>

        {/* ✅ pb-20 trên mobile để cuối trang (vd nút phân trang) không bị nút
            ChatWidget (fixed bottom-right, z cao) che mất; desktop giữ pb-4 như cũ.
            ⚠️ min-w-0 BẮT BUỘC phải có: đây là flex item trong <main> (flex flex-col).
            Mặc định flex item có min-width: auto (không phải 0), nghĩa là nếu nội
            dung bên trong (vd bảng nhiều cột/nút như trang video) rộng hơn khung,
            item này sẽ tự phình to theo nội dung thay vì cuộn ngang bên trong nó
            — kéo theo cả trang bị giãn/tràn ngang. min-w-0 buộc nó chịu ép đúng
            kích thước khung, để overflow-auto ở đây (và overflow-x-auto trong
            từng bảng) hoạt động đúng như mong đợi. */}
        <div className="flex-1 min-w-0 w-full p-4 pb-20 md:pb-4 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;