import { useState } from 'react';
import type { ClaudeAuthInfo, ClaudeExecutableInfo, ServerRuntimeInfo } from '../types';
import { Icon } from './Icon';

type Props = {
  cwd: string;
  home?: string;
  auth?: ClaudeAuthInfo | null;
  claude?: ClaudeExecutableInfo;
  server?: ServerRuntimeInfo;
  onDone: () => void;
  onOpenProject: () => void;
};

type Mode = 'local' | 'remote';

export function InitialSetup({ cwd, home, auth, claude, server, onDone, onOpenProject }: Props) {
  const [mode, setMode] = useState<Mode>(() => readPreferredMode());

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-bg-base/72 px-4 backdrop-blur-[10px]" role="dialog" aria-modal="true" aria-label="Initial setup">
      <div className="w-full max-w-[760px] overflow-hidden rounded-lg border border-border-subtle bg-bg-surface shadow-modal">
        <div className="border-b border-border-subtle bg-bg-raised/70 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-base text-accent-hi">
              <Icon name="terminal" size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-text-primary">Set up Claude Code Web</h2>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                This web app controls Claude Code on the machine where this server is running. Pick the mental model once, then use projects and chats normally.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-[1.15fr_.85fr]">
          <div className="space-y-3">
            <SetupMode
              active={mode === 'local'}
              icon="terminal"
              title="Local Claude Code"
              body="Run claudecode-web on your own computer. The folder picker, Bash, and file edits are local."
              command="cd /path/to/project && claudecode-web"
              onPick={() => { writePreferredMode('local'); setMode('local'); }}
            />
            <SetupMode
              active={mode === 'remote'}
              icon="shield"
              title="Remote server over SSH"
              body="Run claudecode-web on the remote box. Your browser connects through an SSH tunnel; folders and commands are remote."
              command="ssh -L 8080:127.0.0.1:8080 user@host"
              onPick={() => { writePreferredMode('remote'); setMode('remote'); }}
            />
          </div>

          <div className="rounded-md border border-border-subtle bg-bg-base/45 p-4">
            <div className="text-xs font-medium uppercase tracking-[0.08em] text-text-muted">Detected here</div>
            <div className="mt-3 space-y-3">
              <InfoRow label="Claude Code" value={claude?.label ?? 'Checking'} detail={claudeDetail(claude)} tone={claude?.source === 'missing' ? 'danger' : 'normal'} />
              <InfoRow label="Auth" value={auth?.label ?? 'Checking'} detail={auth?.detail} tone={auth?.source === 'none' ? 'danger' : 'normal'} />
              <InfoRow label="Workspace" value={compact(cwd || home || '~', home)} detail={cwd} mono />
              <InfoRow label="Server" value={serverLabel(server)} detail={server?.node} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-bg-raised/40 px-5 py-4">
          <p className="max-w-[460px] text-xs leading-5 text-text-muted">
            You can use the same UI for local Claude Code or a remote Claude Code host. The only difference is where this server process is running.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenProject}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-3 text-sm text-text-secondary transition-colors duration-hover hover:border-border hover:bg-bg-hover hover:text-text-primary"
            >
              <Icon name="folder" size={14} />
              Choose project
            </button>
            <button
              type="button"
              onClick={onDone}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-text-inverse transition-colors duration-hover hover:bg-accent-hi"
            >
              <Icon name="check" size={14} />
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupMode({
  active,
  icon,
  title,
  body,
  command,
  onPick,
}: {
  active: boolean;
  icon: 'terminal' | 'shield';
  title: string;
  body: string;
  command: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full rounded-md border p-4 text-left transition-colors duration-hover ${
        active ? 'border-accent/45 bg-bg-accent-soft/75' : 'border-border-subtle bg-bg-base/35 hover:border-border hover:bg-bg-hover'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${active ? 'bg-accent text-text-inverse' : 'bg-bg-raised text-text-secondary'}`}>
          <Icon name={icon} size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-text-primary">{title}</div>
            {active && <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-hi">Selected</span>}
          </div>
          <p className="mt-1 text-sm leading-5 text-text-secondary">{body}</p>
          <code className="mt-3 block overflow-x-auto rounded-sm border border-border-subtle bg-bg-raised px-2.5 py-2 font-mono text-[11px] leading-5 text-text-secondary">
            {command}
          </code>
        </div>
      </div>
    </button>
  );
}

function InfoRow({
  label,
  value,
  detail,
  tone = 'normal',
  mono = false,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'normal' | 'danger';
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className={`${mono ? 'font-mono text-xs' : 'text-sm'} ${tone === 'danger' ? 'text-danger' : 'text-text-primary'} truncate`} title={detail ?? value}>
        {value}
      </div>
      {detail && detail !== value && <div className="truncate text-[11px] text-text-muted" title={detail}>{detail}</div>}
    </div>
  );
}

function readPreferredMode(): Mode {
  try {
    return window.localStorage.getItem('ccw_setup_mode') === 'local' ? 'local' : 'remote';
  } catch {
    return 'remote';
  }
}

function writePreferredMode(mode: Mode) {
  try {
    window.localStorage.setItem('ccw_setup_mode', mode);
  } catch {
    // localStorage can be unavailable in private contexts.
  }
}

function claudeDetail(info?: ClaudeExecutableInfo): string | undefined {
  if (!info) return undefined;
  if (info.source === 'missing') return info.detail;
  return info.path ?? info.detail;
}

function serverLabel(server?: ServerRuntimeInfo): string {
  if (!server) return 'Checking';
  const host = server.port ? `${server.host ?? '127.0.0.1'}:${server.port}` : server.host;
  return [server.platform, server.arch, host].filter(Boolean).join(' / ');
}

function compact(p: string, home?: string): string {
  let s = p;
  if (home && s.startsWith(home)) s = '~' + s.slice(home.length);
  const parts = s.split('/').filter(Boolean);
  if (parts.length <= 4) return s;
  return (s.startsWith('~') ? '~/' : '/') + '.../' + parts.slice(-3).join('/');
}
