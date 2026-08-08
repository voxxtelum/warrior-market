import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { ChartBarIcon } from './icons/ChartBarIcon';
import { ScaleIcon } from './icons/ScaleIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { Squares2X2Icon } from './icons/Squares2X2Icon';
import { FireIcon } from './icons/FireIcon';

const LINKS: {
  to: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { to: '/market', label: 'Market', Icon: ChartBarIcon },
  { to: '/compare', label: 'Compare', Icon: ScaleIcon },
  { to: '/trends', label: 'Trends', Icon: ArrowTrendingUpIcon },
  { to: '/overview', label: 'Raids', Icon: Squares2X2Icon },
  { to: '/warriors', label: 'Warriors', Icon: FireIcon },
];

export function MainNav() {
  return (
    <nav className="main-nav">
      {LINKS.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `icon-btn${isActive ? ' active' : ''}`}
        >
          <Icon className="icon-btn-icon" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
