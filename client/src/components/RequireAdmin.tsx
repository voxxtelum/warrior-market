import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../authContext";

// Client-side guard only, for UX (don't flash admin UI at a logged-out
// visitor, redirect them away cleanly). The real enforcement is the
// requireAdmin middleware on the API - a bypassed guard just means every
// admin API call comes back 401/403.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user || !user.isAdmin) return <Navigate to="/stock" replace />;

  return <>{children}</>;
}
