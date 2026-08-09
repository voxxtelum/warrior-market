import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronDownIcon } from "./icons/ChevronDownIcon";

export interface TabNavLink {
  to: string;
  label: string;
  end?: boolean;
}

export function TabNav({ links }: { links: TabNavLink[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const current = links.find((l) => l.to === location.pathname)?.to ?? links[0].to;

  return (
    <>
      <nav className="sub-nav">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => (isActive ? "active" : undefined)}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="sub-nav-mobile-wrap">
        <select
          className="sub-nav-select"
          value={current}
          onChange={(e) => navigate(e.target.value)}
        >
          {links.map((link) => (
            <option key={link.to} value={link.to}>
              {link.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="sub-nav-select-chevron" />
      </div>
    </>
  );
}
