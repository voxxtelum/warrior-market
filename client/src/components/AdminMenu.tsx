import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

export function AdminMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
        <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : undefined)}>
          Admin
        </NavLink>
      </nav>
    </div>
  );
}
