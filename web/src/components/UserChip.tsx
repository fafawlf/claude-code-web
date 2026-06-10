import { useRef, useState } from 'react';
import type { MeInfo } from '../types';
import { apiFetch } from '../api';
import { appUrl } from '../appUrl';
import { TopbarMenuPortal } from './TopbarMenuPortal';
import { AdminUsersModal } from './AdminUsersModal';

type Props = {
  me: MeInfo;
};

/** Logged-in identity chip (feishu mode only): avatar, role, admin tools, logout. */
export function UserChip({ me }: Props) {
  const [open, setOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const user = me.user;

  const logout = async () => {
    try { await apiFetch('/logout', { method: 'POST' }); } catch { /* best effort */ }
    window.location.href = appUrl('/login');
  };

  return (
    <div className="topbar-menu relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="chip"
        aria-expanded={open}
        aria-haspopup="menu"
        title={user.email || user.name}
      >
        <Avatar name={user.name} avatarUrl={user.avatarUrl} />
        <span className="max-w-[96px] truncate text-[11px]">{user.name}</span>
      </button>
      {open && (
        <TopbarMenuPortal anchorRef={buttonRef} onClose={() => setOpen(false)} width={232}>
          <div className="p-2 text-[12px]">
            <div className="px-2 py-1.5">
              <div className="text-text-primary font-medium truncate">{user.name}</div>
              <div className="text-text-muted text-[11px] truncate">{user.email || user.slug}</div>
              <div className="text-text-muted text-[10px] mt-0.5">
                {user.role === 'admin' ? 'Admin' : 'Member'} · workspace {user.slug}
              </div>
            </div>
            <div className="border-t border-border-subtle my-1" />
            {user.role === 'admin' && (
              <button
                onClick={() => { setOpen(false); setAdminOpen(true); }}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors duration-hover"
              >Manage users…</button>
            )}
            <button
              onClick={logout}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-bg-hover text-text-secondary hover:text-danger transition-colors duration-hover"
            >Log out</button>
          </div>
        </TopbarMenuPortal>
      )}
      {adminOpen && <AdminUsersModal onClose={() => setAdminOpen(false)} />}
    </div>
  );
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="w-4.5 h-4.5 w-[18px] h-[18px] rounded-full object-cover" referrerPolicy="no-referrer" />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="w-[18px] h-[18px] rounded-full bg-accent/20 text-accent text-[10px] font-semibold inline-flex items-center justify-center">
      {initial}
    </span>
  );
}
