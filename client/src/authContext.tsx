import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getMe, type AuthUser } from "./api";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, refetch: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    setLoading(true);
    getMe()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  useEffect(refetch, [refetch]);

  return <AuthContext.Provider value={{ user, loading, refetch }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
