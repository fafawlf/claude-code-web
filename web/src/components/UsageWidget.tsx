import { useEffect, useRef, useState } from 'react';
import type { ClaudeAuthMode, UsageResponse } from '../types';
import { apiFetch } from '../api';
import { TopbarMenuPortal } from './TopbarMenuPortal';

const POLL_MS = 60_000;

/** Shared-subscription usage meter. Everyone sees the same Max account, so
 *  everyone gets to see how much of it is left. */
export function UsageWidget({
  apiFallbackAvailable = false,
  claudeAuthMode,
  onContinueWithApi,
}: {
  apiFallbackAvailable?: boolean;
  claudeAuthMode?: ClaudeAuthMode;
  onContinueWithApi?: () => void;
}) {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiFetch('/api/usage')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (!cancelled && j) setUsage(j as UsageResponse); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const shared = usage?.shared;
  const five = shared?.fiveHour?.utilization;
  const week = shared?.sevenDay?.utilization;
  const headline = shared?.available && week !== undefined ? `${Math.round(week)}%` : '—';
  const high = Math.max(five ?? 0, week ?? 0, shared?.sevenDayOpus?.utilization ?? 0) >= 70;
  const exhausted = Math.max(five ?? 0, week ?? 0, shared?.sevenDayOpus?.utilization ?? 0) >= 90;

  return (
    <div className="topbar-menu relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="chip"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Shared Claude usage"
      >
        <MiniBar value={week} />
        <span className="font-mono text-[10px]">{headline}</span>
      </button>
      {open && (
        <TopbarMenuPortal anchorRef={buttonRef} onClose={() => setOpen(false)} width={300}>
          <div className="p-3 space-y-3 text-[12px]">
            <div className="text-text-secondary font-medium">
              Shared {shared?.plan === 'max' ? 'Claude Max' : 'Claude'} usage
            </div>
            {shared?.available ? (
              <div className="space-y-2">
                <UsageRow label="5-hour window" value={five} resetsAt={shared?.fiveHour?.resetsAt} />
                <UsageRow label="Weekly" value={week} resetsAt={shared?.sevenDay?.resetsAt} />
                {shared?.sevenDayOpus?.utilization !== undefined && (
                  <UsageRow label="Weekly (Opus)" value={shared.sevenDayOpus.utilization} resetsAt={shared.sevenDayOpus.resetsAt} />
                )}
              </div>
            ) : (
              <div className="text-text-muted">
                Account quota unavailable{shared?.reason ? ` — ${shared.reason}` : ''}.
              </div>
            )}
            {usage && usage.perUser.length > 0 && (
              <div>
                <div className="text-text-muted mb-1.5">Tokens by teammate · last 7 days</div>
                <div className="space-y-1">
                  {usage.perUser.map((u) => (
                    <div key={u.slug} className="flex items-center justify-between gap-2">
                      <span className="truncate text-text-secondary">{u.name}</span>
                      <span className="font-mono text-[10px] text-text-muted shrink-0">
                        {compactTokens(u.tokensIn + u.tokensOut)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(high || claudeAuthMode === 'api') && (
              <div className="rounded-md border border-border-subtle bg-bg-base/45 p-2.5">
                <div className="text-[11px] text-text-secondary">
                  {claudeAuthMode === 'api'
                    ? 'This chat is using Claude API billing.'
                    : exhausted
                      ? 'Quota is high. You can continue with API billing.'
                      : 'API fallback is available when quota gets tight.'}
                </div>
                <button
                  type="button"
                  disabled={!apiFallbackAvailable || claudeAuthMode === 'api'}
                  onClick={() => { onContinueWithApi?.(); setOpen(false); }}
                  className="mt-2 w-full rounded-sm px-2.5 py-1.5 text-xs font-medium bg-bg-hover text-text-primary hover:bg-bg-surface disabled:opacity-45 disabled:cursor-not-allowed transition-colors duration-hover"
                >
                  {claudeAuthMode === 'api'
                    ? 'Using Claude API'
                    : apiFallbackAvailable
                      ? 'Continue with API'
                      : 'API key not configured'}
                </button>
              </div>
            )}
          </div>
        </TopbarMenuPortal>
      )}
    </div>
  );
}

function UsageRow({ label, value, resetsAt }: { label: string; value?: number; resetsAt?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-text-secondary">{label}</span>
        <span className="font-mono text-[10px] text-text-muted">
          {value !== undefined ? `${Math.round(value)}%` : '—'}{resetsAt ? ` · resets ${shortTime(resetsAt)}` : ''}
        </span>
      </div>
      <Bar value={value} />
    </div>
  );
}

function Bar({ value }: { value?: number }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="h-1.5 rounded-full bg-bg-raised overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-success'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MiniBar({ value }: { value?: number }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <span className="inline-block w-7 h-1.5 rounded-full bg-bg-raised overflow-hidden align-middle">
      <span
        className={`block h-full rounded-full ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-success'}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
