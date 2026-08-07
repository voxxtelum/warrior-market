import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../authContext";
import { logout } from "../api";

export function AdminMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { user, loading, refetch } = useAuth();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  async function handleLogout() {
    await logout();
    refetch();
    setOpen(false);
  }

  return (
    <div className="nav-wrapper" ref={menuRef}>
      <button
        className="nav-toggle"
        aria-label="Toggle admin menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ☰
      </button>
      <nav id="nav-menu" className={open ? "open" : undefined}>
        {loading ? null : !user ? (
          <a href="/api/auth/discord">Log in with Discord</a>
        ) : (
          <>
            {user.isAdmin && (
              <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : undefined)}>
                Admin
              </NavLink>
            )}
            {!user.isAdmin && <span className="nav-username">{user.username}</span>}
            <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
              Log out
            </a>
          </>
        )}
      </nav>
    </div>
  );
}
