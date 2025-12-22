import React, { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type GroupKey =
  | "inventory"
  | "sales"
  | "partner"
  | "ops"
  | "reports"
  | "admin"
  | "account";

const LS_KEY = "sidebar_groups_v2";

const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const role = user?.role;

  const isAdmin = role === "admin";
  const isAccountant = role === "accountant";
  const isStaff = role === "staff";

  const canSeeAuditLogs = isAdmin || isAccountant;

  const location = useLocation();

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
      { to: "machines", label: "Linh kiện theo dòng máy" },
      { to: "machine-stocks", label: "Tồn máy móc" },
    ],
    []
  );

  const salesLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    // revenue chỉ admin/accountant
    list.push({ to: "revenue", label: "Báo cáo doanh thu" });
    list.push({ to: "invoices", label: "Quản lý hóa đơn" });
    if (isAdmin) list.push({ to: "/sales-returns", label: "Khách trả hàng" });
    list.push({ to: "/me/sales", label: "Doanh số cá nhân" });
    return list;
  }, [isAdmin]);

  const partnerLinks = useMemo(
    () => [{ to: "partners", label: "Khách hàng" }],
    []
  );

  // ✅ VẬN HÀNH: kiểm kê + tồn đầu
  const opsLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    if (isAdmin) list.push({ to: "stock-counts", label: "Kiểm kê tồn" });
    if (isAdmin)
      list.push({ to: "stock-import-opening", label: "Khởi tạo tồn đầu" });
    return list;
  }, [isAdmin]);

  // ✅ BÁO CÁO & CÔNG NỢ
  const reportLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    if (isAdmin) list.push({ to: "debts/by-sale", label: "Công Nợ" });
    if (isAdmin) list.push({ to: "/reports/ledger", label: "Sổ kho" });
    if (isAdmin)
      list.push({ to: "/reports/sales-ledger", label: "Bảng kê bán" });
    return list;
  }, [isAdmin]);

  // ✅ QUẢN TRỊ
  const adminLinks = useMemo(() => {
    const list: Array<{ to: string; label: string }> = [];
    if (isAdmin) list.push({ to: "users", label: "Quản lý tài khoản" });
    if (isAdmin)
      list.push({ to: "payment-accounts", label: "Thêm tài khoản thanh toán" });

    // ✅ AUDIT LOGS: admin + accountant
    if (canSeeAuditLogs) {
      list.push({ to: "audit-logs", label: "Lịch sử thao tác" });
    }

    return list;
  }, [isAdmin, canSeeAuditLogs]);

  // ✅ TÀI KHOẢN
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
  });

  // load persisted (admin/accountant)
  useEffect(() => {
    if (isStaff) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setOpenGroups((prev) => ({ ...prev, ...parsed }));
      }
    } catch {
      // ignore
    }
  }, [isStaff]);

  // persist
  useEffect(() => {
    if (isStaff) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(openGroups));
    } catch {
      // ignore
    }
  }, [openGroups, isStaff]);

  // ✅ luôn đóng mặc định; KHÔNG auto-open theo route
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
          <span>{title}</span>
          <span className={`transition-transform ${opened ? "rotate-90" : ""}`}>
            ▶
          </span>
        </button>

        {opened && (
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

  return (
    <div className="h-screen flex bg-slate-100 overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col sticky top-0 h-screen">
        <div className="p-4 border-b border-slate-700">
          <h1 className="font-bold text-lg">Quản Lý Kho</h1>
          <p className="text-xs text-slate-300 mt-1">MCBROTHER</p>
        </div>

        <nav className="flex-1 p-2 text-sm overflow-y-auto">
          {/* STAFF: phẳng, không group */}
          {isStaff ? (
            <div className="space-y-1">
              <NavLink to="part-stocks" end className={navCls}>
                Tồn linh kiện
              </NavLink>
              <NavLink to="machines" className={navCls}>
                Linh kiện theo dòng máy
              </NavLink>
              <NavLink to="machine-stocks" className={navCls}>
                Tồn máy móc
              </NavLink>

              {/* staff: ẩn revenue */}
              <NavLink to="invoices" className={navCls}>
                Quản lý hóa đơn
              </NavLink>

              <NavLink to="/me/sales" className={navCls}>
                Doanh số cá nhân
              </NavLink>

              <NavLink to="partners" className={navCls}>
                Khách hàng
              </NavLink>

              <NavLink to="change-password" className={navCls}>
                Đổi mật khẩu
              </NavLink>
            </div>
          ) : (
            <div>
              <Group k="inventory" title="Tồn kho" links={invLinks} />
              <Group k="sales" title="Bán hàng" links={salesLinks} />
              <Group k="partner" title="Đối tác" links={partnerLinks} />

              {/* ✅ tách 2 group theo yêu cầu */}
              <Group k="ops" title="Vận hành" links={opsLinks} />
              <Group k="reports" title="Báo cáo & công nợ" links={reportLinks} />

              <Group k="admin" title="Quản trị" links={adminLinks} />
              <Group k="account" title="Tài khoản" links={accountLinks} />
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-slate-700 text-xs">
          <div className="mb-2">
            Đăng nhập:{" "}
            <span className="font-semibold">
              {user?.fullName || user?.username}
            </span>{" "}
            ({user?.role})
          </div>
          <button
            onClick={logout}
            className="w-full text-left text-red-300 hover:text-red-200"
          >
            Đăng xuất
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col max-h-screen overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4">
          <h2 className="font-semibold text-slate-800 text-lg">
            Hệ thống quản lý kho
          </h2>
        </header>

        <div className="flex-1 p-4 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
