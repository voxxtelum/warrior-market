import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChartBarIcon } from './icons/ChartBarIcon';
import { FireIcon } from './icons/FireIcon';
import { HelpCircleIcon } from './icons/HelpCircleIcon';
import { Cog6ToothIcon } from './icons/Cog6ToothIcon';
import { Bars3Icon } from './icons/Bars3Icon';
import { useAuth } from '../authContext';
import { logout } from '../api';
import { ConfirmModal } from './ConfirmModal';

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `icon-btn${isActive ? ' active' : ''}`;
}

function NavItems({ onNavigate }: { onNavigate: () => void }) {
  const { user, loading, refetch } = useAuth();
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  async function handleLogout() {
    await logout();
    refetch();
    setConfirmingLogout(false);
    onNavigate();
  }

  const displayName = user?.linkedWarrior?.playerName ?? user?.username;

  return (
    <>
      <NavLink to="/market" className={navLinkClass} onClick={onNavigate}>
        <ChartBarIcon className="icon-btn-icon" />
        Market
      </NavLink>
      <NavLink to="/warriors" className={navLinkClass} onClick={onNavigate}>
        <FireIcon className="icon-btn-icon icon-fire" />
        Warriors
      </NavLink>
      <NavLink to="/faq" className={navLinkClass} onClick={onNavigate}>
        <HelpCircleIcon className="icon-btn-icon" />
        FAQ
      </NavLink>
      {user?.isAdmin && (
        <NavLink to="/admin" className={navLinkClass} onClick={onNavigate}>
          <Cog6ToothIcon className="icon-btn-icon" />
          Admin
        </NavLink>
      )}
      {!loading &&
        (user ? (
          <button
            type="button"
            className="nav-identity"
            onClick={() => setConfirmingLogout(true)}
          >
            {user.avatar ? (
              <img className="user-avatar" src={user.avatar} alt="" width={24} height={24} />
            ) : (
              <span className="user-avatar user-avatar-placeholder" />
            )}
            <span>{displayName}</span>
          </button>
        ) : (
          <a href="/api/auth/discord" className="icon-btn" onClick={onNavigate}>
            Log in with Discord
          </a>
        ))}
      {confirmingLogout && (
        <ConfirmModal
          title="Log out?"
          body={<p>You'll need to log back in with Discord to trade or manage your account.</p>}
          confirmLabel="Log out"
          onConfirm={handleLogout}
          onClose={() => setConfirmingLogout(false)}
        />
      )}
    </>
  );
}

export function MainNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [open]);

  return (
    <>
      <nav className="main-nav">
        <NavItems onNavigate={() => {}} />
      </nav>

      <div className="nav-wrapper main-nav-mobile" ref={menuRef}>
        <button
          className="nav-toggle"
          aria-label="Toggle navigation menu"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <Bars3Icon className="icon-btn-icon" />
        </button>
        <nav className={`nav-dropdown${open ? ' open' : ''}`}>
          <NavItems onNavigate={() => setOpen(false)} />
        </nav>
      </div>
    </>
  );
}
