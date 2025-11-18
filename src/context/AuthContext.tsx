import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (
    username: string,
    password: string,
    remember: boolean
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Lần đầu load app: nếu có token thì gọi /auth/me để lấy user
  useEffect(() => {
    const storedToken =
      localStorage.getItem("token") || sessionStorage.getItem("token");

    if (!storedToken) {
      setLoading(false);
      return;
    }

    const init = async () => {
      try {
        // token đã nằm trong storage, axios interceptor sẽ tự gắn Authorization
        const res = await api.get<User>("/auth/me");
        setUser(res.data);
        setToken(storedToken);
      } catch (err) {
        console.error("Failed /auth/me on init", err);
        localStorage.removeItem("token");
        sessionStorage.removeItem("token");
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  // Login: lấy token từ /auth/login, lưu, rồi gọi /auth/me để lấy user
  const login = async (
    username: string,
    password: string,
    remember: boolean
  ) => {
    setLoading(true);

    const res = await api.post("/auth/login", { username, password });

    // linh động đọc token, phòng trường hợp API trả accessToken thay vì token
    const data: any = res.data;
    const token: string =
      data.token ?? data.accessToken ?? data.access_token ?? "";

    if (!token) {
      setLoading(false);
      throw new Error("Không lấy được token từ /auth/login");
    }

    // Lưu token vào storage
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    if (remember) {
      localStorage.setItem("token", token);
    } else {
      sessionStorage.setItem("token", token);
    }
    setToken(token);

    try {
      const meRes = await api.get<User>("/auth/me");
      setUser(meRes.data);
    } catch (err) {
      console.error("Failed /auth/me after login", err);
      localStorage.removeItem("token");
      sessionStorage.removeItem("token");
      setToken(null);
      setUser(null);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
