import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const role = user?.role;
  const isAdmin = role === "admin";
  const isAccountant = role === "accountant";

  return (
    <div className="min-h-screen flex bg-slate-100">
      {/* SIDEBAR */}
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h1 className="font-bold text-lg">Quản Lý Kho</h1>
          <p className="text-xs text-slate-300 mt-1">MCBROTHER</p>
        </div>

        <nav className="flex-1 p-2 space-y-1 text-sm">
          <NavLink
            to="part-stocks"
            end
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${
                isActive ? "bg-slate-700" : "hover:bg-slate-800"
              }`
            }
          >
            Tồn linh kiện
          </NavLink>

          <NavLink
            to="machines"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${
                isActive ? "bg-slate-700" : "hover:bg-slate-800"
              }`
            }
          >
            Linh kiện theo dòng máy
          </NavLink>

          <NavLink
            to="machine-stocks"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${
                isActive ? "bg-slate-700" : "hover:bg-slate-800"
              }`
            }
          >
            Tồn máy móc
          </NavLink>

        
           <NavLink
            to="revenue"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${
                isActive ? "bg-slate-700" : "hover:bg-slate-800"
              }`
            }
          >
            Báo cáo doanh thu
          </NavLink>
          {/* Quản lý hóa đơn: admin + accountant */}
          {(isAdmin || isAccountant) && (
            <NavLink
              to="invoices"
              className={({ isActive }) =>
                `block rounded px-3 py-2 ${
                  isActive ? "bg-slate-700" : "hover:bg-slate-800"
                }`
              }
            >
              Quản lý hóa đơn
            </NavLink>
          )}

          {/* Kiểm kê tồn: chỉ admin */}
          {isAdmin && (
            <NavLink
              to="stock-counts"
              className={({ isActive }) =>
                `block rounded px-3 py-2 ${
                  isActive ? "bg-slate-700" : "hover:bg-slate-800"
                }`
              }
            >
              Kiểm kê tồn
            </NavLink>
          )}

          {/* Khởi tạo tồn đầu: chỉ admin */}
          {isAdmin && (
            <NavLink
              to="stock-import-opening"
              className={({ isActive }) =>
                `block rounded px-3 py-2 ${
                  isActive ? "bg-slate-700" : "hover:bg-slate-800"
                }`
              }
            >
              Khởi tạo tồn đầu
            </NavLink>
          )}

          <NavLink
            to="partners"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${
                isActive ? "bg-slate-700" : "hover:bg-slate-800"
              }`
            }
          >
            Khách hàng
          </NavLink>
          {isAdmin && (
            <NavLink
              to="users"
              className={({ isActive }) =>
                `block rounded px-3 py-2 ${
                  isActive ? "bg-slate-700" : "hover:bg-slate-800"
                }`
              }
            >
             Quản lý tài khoản
            </NavLink>
          )}


          <NavLink
            to="change-password"
            className={({ isActive }) =>
              `block rounded px-3 py-2 ${
                isActive ? "bg-slate-700" : "hover:bg-slate-800"
              }`
            }
          >
            Đổi mật khẩu
          </NavLink>
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
      <main className="flex-1 flex flex-col">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4">
          <h2 className="font-semibold text-slate-800 text-lg">
            Hệ thống quản lý kho
          </h2>
        </header>

        <div className="flex-1 p-4">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
