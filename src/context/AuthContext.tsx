import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<User | null>; // ✅ cho chỗ nào cần reload quyền/role
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStoredToken() {
  return localStorage.getItem("token") || sessionStorage.getItem("token");
}

function clearStoredToken() {
  localStorage.removeItem("token");
  sessionStorage.removeItem("token");
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // ✅ React 18 StrictMode dev sẽ chạy effect 2 lần -> chặn
  const didInitRef = useRef(false);

  // ✅ Dedup /auth/me: nếu đang gọi thì không gọi lại
  const meInflightRef = useRef<Promise<User> | null>(null);

  const logout = () => {
    clearStoredToken();
    setToken(null);
    setUser(null);
  };

  const fetchMe = async (): Promise<User> => {
    if (meInflightRef.current) return meInflightRef.current;

    meInflightRef.current = (async () => {
      const res = await api.get<User>("/auth/me");
      return res.data;
    })();

    try {
      const u = await meInflightRef.current;
      return u;
    } finally {
      meInflightRef.current = null;
    }
  };

  const refreshMe = async () => {
    const storedToken = readStoredToken();
    if (!storedToken) {
      logout();
      return null;
    }

    // đảm bảo state token có trước
    setToken(storedToken);

    try {
      const u = await fetchMe();
      setUser(u);
      return u;
    } catch (err: any) {
      // nếu token invalid -> logout
      const status = err?.response?.status;
      if (status === 401) logout();
      throw err;
    }
  };

  // Init on app load
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    const storedToken = readStoredToken();
    if (!storedToken) {
      setLoading(false);
      return;
    }

    setToken(storedToken);

    (async () => {
      try {
        const u = await fetchMe();
        setUser(u);
      } catch (err) {
        console.error("Failed /auth/me on init", err);
        logout();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (username: string, password: string, remember: boolean) => {
    setLoading(true);

    try {
      const res = await api.post("/auth/login", { username, password });

      const data: any = res.data;
      const newToken: string = data.token ?? data.accessToken ?? data.access_token ?? "";

      if (!newToken) throw new Error("Không lấy được token từ /auth/login");

      clearStoredToken();
      if (remember) localStorage.setItem("token", newToken);
      else sessionStorage.setItem("token", newToken);

      setToken(newToken);

      const u = await fetchMe();
      setUser(u);
    } catch (err) {
      console.error("Login failed", err);
      logout();
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, logout, refreshMe }),
    [user, token, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
