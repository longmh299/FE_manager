import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";

const LoginPage: React.FC = () => {
    
  const { login } = useAuth();
  const [username, setUsername] = useState("123");
  const [password, setPassword] = useState("123");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
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

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotMessage(null);
    try {
      // TODO: cần implement POST /auth/forgot-password ở backend nếu muốn dùng thật
      await api.post("/auth/forgot-password", { username: forgotUsername });
      setForgotMessage(
        "Nếu tài khoản tồn tại, hệ thống sẽ gửi hướng dẫn đặt lại mật khẩu."
      );
    } catch {
      setForgotMessage("Không gửi được yêu cầu. Vui lòng thử lại.");
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

        {showForgot && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
              <h2 className="font-semibold mb-3 text-slate-800">
                Quên mật khẩu
              </h2>
              <form onSubmit={handleForgot} className="space-y-3 text-sm">
                <div>
                  <label className="block mb-1 text-slate-700">
                    Tên đăng nhập
                  </label>
                  <input
                    className="w-full border rounded px-3 py-2 outline-none focus:ring focus:ring-blue-100 focus:border-blue-500"
                    value={forgotUsername}
                    onChange={(e) => setForgotUsername(e.target.value)}
                  />
                </div>
                {forgotMessage && (
                  <div className="text-xs text-slate-700 bg-slate-50 border rounded px-2 py-1">
                    {forgotMessage}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowForgot(false)}
                    className="px-3 py-1 rounded border text-xs"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 rounded bg-slate-900 text-white text-xs"
                  >
                    Gửi yêu cầu
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
