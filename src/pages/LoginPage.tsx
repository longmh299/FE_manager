import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";

const LoginPage: React.FC = () => {
    
  const { login } = useAuth();
  // ✅ ô trống khi mở trang (trước đây điền sẵn chữ "username" / "password")
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);

  const navigate = useNavigate();
  const location = useLocation() as any;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password, remember);
      const from = location.state?.from?.pathname || "/";
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error(err);
      setError(err?.response?.data?.message || "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white shadow-lg rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center text-slate-800">
          Đăng nhập hệ thống kho
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1 text-slate-700">
              Tên đăng nhập
            </label>
            <input
              className="w-full border rounded px-3 py-2 text-sm outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm mb-1 text-slate-700">
              Mật khẩu
            </label>
            <input
              type="password"
              className="w-full border rounded px-3 py-2 text-sm outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className="flex items-center justify-between text-xs">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>Ghi nhớ đăng nhập</span>
            </label>
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-blue-600 hover:underline"
            >
              Quên mật khẩu?
            </button>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white rounded py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>

        {/* ✅ Quên mật khẩu: hệ thống chưa gửi mail đặt lại, nên hướng dẫn nhờ quản trị (trước đây form gửi tới API không tồn tại, luôn báo lỗi) */}
        {showForgot && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowForgot(false)}>
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-semibold mb-3 text-slate-800">Quên mật khẩu</h2>
              <p className="text-sm text-slate-600">
                Liên hệ quản trị hệ thống để được hỗ trợ lấy lại mật khẩu. Đăng nhập được rồi thì vào <b>Hệ thống → Đổi mật khẩu</b> để đổi sang mật khẩu của riêng bạn.
              </p>
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={() => setShowForgot(false)} className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm">
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
