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
      

const LS_KEY = "sidebar_groups_v2";

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
    `block rounded px-3 py-2 ${
      isActive ? "bg-slate-700" : "hover:bg-slate-800"
    }`;

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

    if (isAdmin|| isAccountant) list.push({ to: "/sales-returns", label: "Khách trả hàng" });
    return list;
  }, [isAdmin, canSeeMovements]);


  const opsLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    if (isAdmin|| isAccountant) list.push({ to: "stock-counts", label: "Kiểm kê tồn" });
    if (isAdmin)
      list.push({ to: "stock-import-opening", label: "Khởi tạo tồn đầu" });
    return list;
  }, [isAdmin]);

  const reportLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    list.push({ to: "revenue", label: "Báo cáo doanh thu" }); // ✅ chuyển từ nhóm Bán hàng qua đây
    if (isAdmin|| isAccountant) list.push({ to: "debts/by-sale", label: "Công Nợ" });
    if (isAdmin|| isAccountant) list.push({ to: "/reports/ledger", label: "Sổ kho" });
    if (isAdmin|| isAccountant) list.push({ to: "/reports/sales-ledger", label: "Bảng kê bán" });
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
      { to: "machine-videos", label: "Kho video vận hành máy" },
    ],
    []
  );

  const adminLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    if (isAdmin) list.push({ to: "users", label: "Quản lý tài khoản" });
    if (isAdmin|| isAccountant)
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
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = () => {
      const next = mq.matches;
      setIsDesktop(next);

      // ✅ reset state when crossing breakpoint to avoid stuck/lag
      setMobileMenuOpen(false);
      // desktopCollapsed giữ nguyên (tuỳ bạn), nhưng mobile thì nó không ảnh hưởng width
    };

    handler();
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
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

  // Load persisted groups (admin/accountant)
  useEffect(() => {
    if (isStaff) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object")
        setOpenGroups((prev) => ({ ...prev, ...parsed }));
    } catch {}
  }, [isStaff]);

  // Persist
  useEffect(() => {
    if (isStaff) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(openGroups));
    } catch {}
  }, [openGroups, isStaff]);

  const toggleGroup = (k: GroupKey) =>
    setOpenGroups((prev) => ({ ...prev, [k]: !prev[k] }));

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
      <div className="mb-2">
        <button
          type="button"
          onClick={() => toggleGroup(k)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs uppercase tracking-wide ${
            active ? "text-slate-200" : "text-slate-400"
          } hover:bg-slate-800`}
          title={opened ? "Thu gọn" : "Mở rộng"}
        >
          <span className={desktopCollapsed ? "hidden md:inline-block md:truncate" : ""}>
            {title}
          </span>
          <span className={`transition-transform ${opened ? "rotate-90" : ""}`}>▶</span>
        </button>

        {opened && !desktopCollapsed && (
          <div className="mt-1 space-y-1">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navCls}>
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

            <NavLink to="quote-documents" className={navCls}>
              {desktopCollapsed ? "BG" : "Kho báo giá"}
            </NavLink>

            <NavLink to="machine-videos" className={navCls}>
              {desktopCollapsed ? "VD" : "Kho video vận hành máy"}
            </NavLink>

            {/* ✅ staff KHÔNG thấy movements theo yêu cầu */}

            <NavLink to="/me/sales" className={navCls}>
              {desktopCollapsed ? "DS" : "Doanh số cá nhân"}
            </NavLink>

            <NavLink to="partners" className={navCls}>
              {desktopCollapsed ? "KH" : "Khách hàng"}
            </NavLink>

            <NavLink to="change-password" className={navCls}>
              {desktopCollapsed ? "MK" : "Đổi mật khẩu"}
            </NavLink>
          </div>
        ) : (
          <div>
            <Group k="inventory" title={desktopCollapsed ? "TK" : "Tồn kho"} links={invLinks} />
            <Group k="quotes" title={desktopCollapsed ? "BG" : "Kho báo giá & video"} links={quoteLinks} />
            <Group k="sales" title={desktopCollapsed ? "BH" : "Bán hàng"} links={salesLinks} />
            <Group
              k="reports"
              title={desktopCollapsed ? "BC" : "Báo cáo & công nợ"}
              links={reportLinks}
            />
             <Group k="ops" title={desktopCollapsed ? "VH" : "Vận hành"} links={opsLinks} />
            <Group k="admin" title={desktopCollapsed ? "QT" : "Quản trị"} links={adminLinks} />
             <Group k="partner" title={desktopCollapsed ? "DT" : "Đối tác"} links={partnerLinks} />
            <Group k="account" title={desktopCollapsed ? "TK" : "Tài khoản"} links={accountLinks} />
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-slate-700 text-xs">
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
          "bg-slate-900 text-slate-100 flex flex-col h-screen",
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
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3">
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
          <ChatWidget />
        </header>

        {/* ✅ pb-20 trên mobile để cuối trang (vd nút phân trang) không bị nút
            ChatWidget (fixed bottom-right, z cao) che mất; desktop giữ pb-4 như cũ */}
        <div className="flex-1 p-4 pb-20 md:pb-4 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;