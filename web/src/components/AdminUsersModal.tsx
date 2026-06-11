import { useCallback, useEffect, useState } from 'react';
import type { AdminUsersResponse } from '../types';
import { apiFetch } from '../api';

type Props = {
  onClose: () => void;
};

/** Admin-only whitelist + member management. */
export function AdminUsersModal({ onClose }: Props) {
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch('/api/admin/users')
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); })
      .then((j) => setData(j as AdminUsersResponse))
      .catch((e) => setErr(String((e as Error).message || e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mutateAllowlist = async (value: string, remove: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch('/api/admin/allowlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry: value, remove }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? 'failed');
      setEntry('');
      load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const mutateUser = async (openId: string, patch: { role?: 'admin' | 'user'; disabled?: boolean }) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch('/api/admin/user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ openId, ...patch }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? 'failed');
      load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg border border-border bg-bg-surface shadow-pop animate-modal-in text-[13px]">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle shrink-0">
          <div className="text-text-primary font-medium">Team access</div>
          <button onClick={onClose} className="chip">Close</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {data?.allowedDomains && data.allowedDomains.length > 0 && (
          <div className="rounded bg-success/10 border border-success/30 px-3 py-2 text-[12px] text-text-secondary">
            ✓ 这些域名的飞书账号登录即自动开通，无需逐个添加：
            <span className="font-mono text-success"> {data.allowedDomains.map((d) => `@${d}`).join('、')}</span>
            <div className="text-text-muted text-[11px] mt-0.5">下面的白名单只用于加例外（外部协作者），停用某人用 Members 里的 disable。</div>
          </div>
        )}

        <div>
          <div className="text-text-secondary mb-1.5">Allowlist — Feishu email or open_id（域名外的例外）</div>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (entry.trim()) void mutateAllowlist(entry.trim(), false); }}
          >
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1 bg-bg-base border border-border rounded px-2 py-1.5 text-text-primary outline-none focus:border-accent"
            />
            <button type="submit" disabled={busy || !entry.trim()} className="chip disabled:opacity-50">Add</button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(data?.allowlist ?? []).map((a) => (
              <span key={a} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-raised border border-border-subtle text-[11px] text-text-secondary">
                {a}
                <button onClick={() => void mutateAllowlist(a, true)} className="text-text-muted hover:text-danger" title="Remove">×</button>
              </span>
            ))}
            {data && data.allowlist.length === 0 && (
              <span className="text-text-muted text-[11px]">No entries yet — add teammates before they log in.</span>
            )}
          </div>
          {data?.adminEmails && data.adminEmails.length > 0 && (
            <div className="mt-1.5 text-[10px] text-text-muted">
              Always-admin via env: {data.adminEmails.join(', ')}
            </div>
          )}
        </div>

        <div>
          <div className="text-text-secondary mb-1.5">Members</div>
          <div className="space-y-1.5">
            {(data?.users ?? []).map((u) => (
              <div key={u.openId} className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-raised/50 border border-border-subtle">
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary truncate">{u.name} {u.disabled && <span className="text-danger text-[10px]">(disabled)</span>}</div>
                  <div className="text-text-muted text-[11px] truncate">{u.email || u.openId} · {u.slug}</div>
                </div>
                <button
                  onClick={() => void mutateUser(u.openId, { role: u.role === 'admin' ? 'user' : 'admin' })}
                  disabled={busy}
                  className="chip text-[11px]"
                  title="Toggle role"
                >{u.role}</button>
                <button
                  onClick={() => void mutateUser(u.openId, { disabled: !u.disabled })}
                  disabled={busy}
                  className="chip text-[11px]"
                  title={u.disabled ? 'Re-enable' : 'Disable login'}
                >{u.disabled ? 'enable' : 'disable'}</button>
              </div>
            ))}
            {data && data.users.length === 0 && (
              <div className="text-text-muted text-[11px]">Nobody has logged in yet.</div>
            )}
          </div>
        </div>

        {err && <div className="text-danger text-[12px]">{err}</div>}
        </div>
      </div>
    </div>
  );
}
