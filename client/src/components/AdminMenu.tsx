import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../authContext";
import { logout } from "../api";
import { Cog6ToothIcon } from "./icons/Cog6ToothIcon";
import { ArrowLeftOnRectangleIcon } from "./icons/ArrowLeftOnRectangleIcon";
import { ArrowRightOnRectangleIcon } from "./icons/ArrowRightOnRectangleIcon";
import { QuestionMarkCircleIcon } from "./icons/QuestionMarkCircleIcon";

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
          <>
            <NavLink to="/faq" className={({ isActive }) => `icon-btn${isActive ? " active" : ""}`}>
              <QuestionMarkCircleIcon className="icon-btn-icon" />
              FAQ
            </NavLink>
            <a href="/api/auth/discord" className="icon-btn">
              <ArrowLeftOnRectangleIcon className="icon-btn-icon" />
              Log in with Discord
            </a>
          </>
        ) : (
          <>
            {user.isAdmin && (
              <NavLink to="/admin" className={({ isActive }) => `icon-btn${isActive ? " active" : ""}`}>
                <Cog6ToothIcon className="icon-btn-icon" />
                Admin
              </NavLink>
            )}
            {!user.isAdmin && <span className="nav-username">{user.username}</span>}
            <NavLink to="/faq" className={({ isActive }) => `icon-btn${isActive ? " active" : ""}`}>
              <QuestionMarkCircleIcon className="icon-btn-icon" />
              FAQ
            </NavLink>
            <a href="#" className="icon-btn" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
              <ArrowRightOnRectangleIcon className="icon-btn-icon" />
              Log out
            </a>
          </>
        )}
      </nav>
    </div>
  );
}
