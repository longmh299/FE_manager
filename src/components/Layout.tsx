// src/components/Layout.tsx
import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LowStockBell } from "./LowStockBell";
import { ChatWidget } from "./ChatWidget";
type GroupKey =
  | "inventory"
  | "sales"
  | "partner"
  | "ops"
  | "reports"
  | "admin"
  | "account"
  | "quotes";


const LS_KEY = "sidebar_open_group_v3"; // ✅ accordion: lưu 1 nhóm đang mở

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

  // ===== define links =====
  const invLinks = useMemo(
    () => [
      { to: "part-stocks", label: "Tồn linh kiện" },
      { to: "machine-stocks", label: "Tồn máy móc" },
    ],
    []
  );

  // ✅ "Phiếu kho" nằm chung mục với "Quản lý hóa đơn" (sales group)
  const salesLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    list.push({ to: "invoices", label: "Quản lý hóa đơn" });

    // ✅ chỉ admin/accountant mới thấy
    if (canSeeMovements) list.push({ to: "movements", label: "Phiếu điều chỉnh" });

    if (isAdmin || isAccountant) list.push({ to: "/sales-returns", label: "Khách trả hàng" });
    return list;
  }, [isAdmin, canSeeMovements]);


  const opsLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    if (isAdmin || isAccountant) list.push({ to: "stock-counts", label: "Kiểm kê tồn" });
    if (isAdmin)
      list.push({ to: "stock-import-opening", label: "Khởi tạo tồn đầu" });
    if (isAdmin) list.push({ to: "/analytics", label: "Lượt truy cập Website" }); // ✅ chuyển từ Báo cáo sang Vận hành
    return list;
  }, [isAdmin, isAccountant]);

  const reportLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    list.push({ to: "revenue", label: "Báo cáo doanh thu" }); // ✅ chuyển từ nhóm Bán hàng qua đây
    list.push({ to: "/reports/invoice-trace", label: "Truy xuất hóa đơn" }); // ✅ NEW: tra cứu hóa đơn theo mã sản phẩm
    if (isAdmin || isAccountant) list.push({ to: "debts/by-sale", label: "Công Nợ" });
    if (isAdmin || isAccountant) list.push({ to: "/reports/ledger", label: "Sổ kho" });
    if (isAdmin || isAccountant) list.push({ to: "/reports/sales-ledger", label: "Bảng kê bán" });
    if (isAdmin || isAccountant)
      list.push({ to: "/reports/stock-inout", label: "Báo cáo XNT" });
    // ✅ chỉ admin xem được hàng bán chạy
    if (isAdmin) list.push({ to: "/reports/best-sellers", label: "Hàng bán chạy" });
    return list;
  }, [isAdmin, isAccountant]);

  // ✅ mục lớn riêng, đứng ngang hàng với Tồn kho / Bán hàng..., không nằm lồng trong nhóm nào
  // ✅ gộp chung "Kho báo giá" và "Kho video vận hành máy" vào cùng 1 group "quotes"
  const quoteLinks = useMemo(
    () => [
      { to: "quote-documents", label: "Kho báo giá" },
      { to: "machine-videos", label: "Video vận hành máy" },
      { to: "machine-images", label: "Kho ảnh máy móc, linh kiện" },
      { to: "translate", label: "Dịch tài liệu" },
      ...(isAdmin ? [{ to: "mkt", label: "Hàng chờ MKT" }] : []), // ✅ chỉ admin
    ],
    [isAdmin]
  );

  const adminLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    if (isAdmin) list.push({ to: "users", label: "Quản lý tài khoản" });
    if (isAdmin || isAccountant)
      list.push({ to: "payment-accounts", label: "Thêm tài khoản thanh toán" });
    if (canSeeAuditLogs)
      list.push({ to: "audit-logs", label: "Lịch sử thao tác" });
    // if (isAdmin)
    //   list.push({ to: "invoice-status", label: "Sửa trạng thái hóa đơn" });
    return list;
  }, [isAdmin, canSeeAuditLogs]);
  const partnerLinks = useMemo(
    () => [{ to: "partners", label: "Khách hàng" }],
    []
  );

  const accountLinks = useMemo(
    () => [{ to: "change-password", label: "Đổi mật khẩu" }],
    []
  );

  // ===== collapse state (admin/accountant only) =====
  const [openGroups, setOpenGroups] = useState<Record<GroupKey, boolean>>({
    inventory: false,
    sales: false,
    partner: false,
    ops: false,
    reports: false,
    admin: false,
    account: false,
    quotes: false,
  });

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

  // ✅ MỖI LẦN CHỈ MỞ 1 NHÓM (accordion)
  const ONLY = (k: GroupKey | null) =>
    ({
      inventory: false,
      sales: false,
      partner: false,
      ops: false,
      reports: false,
      admin: false,
      account: false,
      quotes: false,
      ...(k ? { [k]: true } : {}),
    }) as Record<GroupKey, boolean>;

  const groupLinks: Array<[GroupKey, Array<{ to: string }>]> = [
    ["inventory", invLinks],
    ["sales", salesLinks],
    ["reports", reportLinks],
    ["quotes", quoteLinks],
    ["ops", opsLinks],
    ["admin", adminLinks],
    ["partner", partnerLinks],
    ["account", accountLinks],
  ];

  // ✅ vào trang nào -> tự mở đúng nhóm chứa trang đó (các nhóm khác đóng)
  //    trang không thuộc nhóm nào (vd trang chủ) -> mở lại nhóm lần trước
  useEffect(() => {
    if (isStaff) return;
    const hit = groupLinks.find(([, links]) => groupHasActive(links));
    if (hit) {
      setOpenGroups(ONLY(hit[0]));
      return;
    }
    try {
      const last = localStorage.getItem(LS_KEY) as GroupKey | null;
      if (last && last in ONLY(null)) setOpenGroups(ONLY(last));
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isStaff, role]); // role: danh sách trang theo quyền chỉ có sau khi tải xong user

  // nhớ nhóm đang mở
  useEffect(() => {
    if (isStaff) return;
    const k = (Object.keys(openGroups) as GroupKey[]).find((x) => openGroups[x]);
    try {
      if (k) localStorage.setItem(LS_KEY, k);
    } catch { }
  }, [openGroups, isStaff]);

  const toggleGroup = (k: GroupKey) => setOpenGroups((prev) => ONLY(prev[k] ? null : k));

  const Group = ({
    k,
    title,
    links,
  }: {
    k: GroupKey;
    title: string;
    links: Array<{ to: string; label: string }>;
  }) => {
    if (!links.length) return null;

    const opened = openGroups[k];
    const active = groupHasActive(links);

    return (
      <div className="mb-0.5">
        <button
          type="button"
          onClick={() => toggleGroup(k)}
          className={[
            "w-full flex items-center justify-between px-3 py-2.5 rounded",
            "text-[12px] font-semibold uppercase tracking-wider transition-colors",
            opened || active ? "text-white" : "text-slate-300 hover:text-white",
            opened ? "bg-slate-800/60" : "hover:bg-slate-800/60",
          ].join(" ")}
          title={opened ? "Thu gọn" : "Mở rộng"}
          aria-expanded={opened}
        >
          <span className={desktopCollapsed ? "hidden md:inline-block md:truncate" : ""}>
            {title}
          </span>
          <span
            className={`text-[9px] text-slate-500 transition-transform duration-150 ${opened ? "rotate-90" : ""}`}
          >
            ▶
          </span>
        </button>

        {opened && !desktopCollapsed && (
          <div className="ml-4 mt-1 mb-2 pl-2 border-l border-slate-700 space-y-0.5">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={subNavCls}>
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
          Quản Lý Kho
        </h1>
        {!desktopCollapsed && <p className="text-xs text-slate-300 mt-1">MCBROTHER</p>}
      </div>

      <nav className="flex-1 p-2 text-sm overflow-y-auto">
        {isStaff ? (
          <div className="space-y-1">
            <NavLink to="part-stocks" end className={navCls}>
              {desktopCollapsed ? "LK" : "Tồn linh kiện"}
            </NavLink>

            <NavLink to="machine-stocks" className={navCls}>
              {desktopCollapsed ? "MM" : "Tồn máy móc"}
            </NavLink>

            <NavLink to="invoices" className={navCls}>
              {desktopCollapsed ? "HD" : "Quản lý hóa đơn"}
            </NavLink>

            {/* ✅ thứ tự mới: Bán hàng → Báo cáo (doanh số) → Kho báo giá */}
            <NavLink to="/me/sales" className={navCls}>
              {desktopCollapsed ? "DS" : "Doanh số cá nhân"}
            </NavLink>

            <NavLink to="quote-documents" className={navCls}>
              {desktopCollapsed ? "BG" : "Kho báo giá"}
            </NavLink>

            <NavLink to="machine-videos" className={navCls}>
              {desktopCollapsed ? "VD" : "Video vận hành máy"}
            </NavLink>
            <NavLink to="machine-images" className={navCls}>
              {desktopCollapsed ? "AM" : "Kho ảnh máy móc"}
            </NavLink>
            <NavLink to="translate" className={navCls}>
              {desktopCollapsed ? "DT" : "Dịch tài liệu"}
            </NavLink>
            {isAdmin && (
              <NavLink to="mkt" className={navCls}>
                {desktopCollapsed ? "MK" : "Hàng chờ MKT"}
              </NavLink>
            )}
            {/* ✅ staff KHÔNG thấy movements theo yêu cầu */}

            <NavLink to="partners" className={navCls}>
              {desktopCollapsed ? "KH" : "Khách hàng"}
            </NavLink>

            <NavLink to="change-password" className={navCls}>
              {desktopCollapsed ? "MK" : "Đổi mật khẩu"}
            </NavLink>
          </div>
        ) : (
          <div>
            {/* ✅ thứ tự mới: Tồn kho → Bán hàng → Báo cáo → Kho báo giá → Vận hành → Quản trị → Đối tác → Tài khoản */}
            <Group k="inventory" title={desktopCollapsed ? "TK" : "Tồn kho"} links={invLinks} />
            <Group k="sales" title={desktopCollapsed ? "BH" : "Bán hàng"} links={salesLinks} />
            <Group
              k="reports"
              title={desktopCollapsed ? "BC" : "Báo cáo & công nợ"}
              links={reportLinks}
            />
            <Group k="quotes" title={desktopCollapsed ? "BG" : "Kho báo giá & video"} links={quoteLinks} />
            <Group k="ops" title={desktopCollapsed ? "VH" : "Vận hành"} links={opsLinks} />
            <Group k="admin" title={desktopCollapsed ? "QT" : "Quản trị"} links={adminLinks} />
            <Group k="partner" title={desktopCollapsed ? "DT" : "Đối tác"} links={partnerLinks} />
            <Group k="account" title={desktopCollapsed ? "TK" : "Tài khoản"} links={accountLinks} />
          </div>
        )}
      </nav>

      <div className="p-3 pb-safe border-t border-slate-700 text-xs">
        {!desktopCollapsed && (
          <div className="mb-2">
            Đăng nhập:{" "}
            <span className="font-semibold">{user?.fullName || user?.username}</span>{" "}
            ({user?.role})
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