import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WsClient } from './ws';
import { applyEvent, applyStateDelta, initialState, addSystem, withReady, type ChatState } from './reducer';
import type { ChatItem, PermissionMode, ServerMessage, ServerPermissionRequest, ServerPlanProposed, StoredSession } from './types';
import { modeLabel, MODE_ORDER } from './types';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { PermissionModal } from './components/PermissionModal';
import { PlanApprovalModal } from './components/PlanApprovalModal';
import { InputBar } from './components/InputBar';
import { TopBar } from './components/TopBar';
import { EmptyState } from './components/EmptyState';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { useKeyboard, isMod } from './hooks/useKeyboard';
import { useToast } from './components/Toast';
import type { SlashAction } from './components/SlashPalette';

const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function getToken(): string | null {
  const url = new URL(window.location.href);
  const t = url.searchParams.get('t');
  if (t) {
    sessionStorage.setItem('ccw_token', t);
    url.searchParams.delete('t');
    window.history.replaceState({}, '', url.toString());
    return t;
  }
  return sessionStorage.getItem('ccw_token');
}

export function App() {
  const token = getToken();
  const toast = useToast();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [state, setState] = useState<ChatState>(initialState);
  const [localItems, setLocalItems] = useState<ChatItem[]>([]);
  const [nonEditPermReq, setNonEditPermReq] = useState<ServerPermissionRequest | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Map<string, ServerPermissionRequest>>(new Map());
  const [planProposed, setPlanProposed] = useState<ServerPlanProposed | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [sessionTitle, setSessionTitle] = useState<string | undefined>(undefined);
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inputSeed, setInputSeed] = useState<string | undefined>(undefined);
  const wsRef = useRef<WsClient | null>(null);

  // Auth probe
  useEffect(() => {
    if (!token) { setAuthed(false); return; }
    fetch(`/auth-check?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => setAuthed(!!j.ok))
      .catch(() => setAuthed(false));
  }, [token]);

  useEffect(() => {
    if (!authed || !token) return;
    fetch(`/api/info?t=${encodeURIComponent(token)}`).then((r) => r.json()).then((j) => setDefaultCwd(j.cwd ?? ''));
    refreshSessions(state.state?.cwd);
  }, [authed, token]);

  useEffect(() => {
    if (!authed || !token) return;
    refreshSessions(state.state?.cwd);
  }, [state.state?.cwd, authed, token]);

  const refreshSessions = (cwd?: string) => {
    if (!token) return;
    const url = `/api/sessions?t=${encodeURIComponent(token)}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ''}`;
    fetch(url).then((r) => r.json()).then((j) => setSessions(j.sessions ?? [])).catch(() => {});
  };

  useEffect(() => {
    if (!authed || !token) return;
    const onMessage = (m: ServerMessage) => {
      if (m.type === 'ready') {
        setState((s) => withReady(s, m.state));
        setConnected(true);
        setLocalItems([]);
        setPendingEdits(new Map());
        setNonEditPermReq(null);
        setPlanProposed(null);
      } else if (m.type === 'state_update') {
        setState((s) => applyStateDelta(s, m.state));
      } else if (m.type === 'sdk_event') {
        setState((s) => applyEvent(s, m.event, m.id));
      } else if (m.type === 'permission_request') {
        if (EDIT_LIKE.has(m.toolName) && m.toolUseId) {
          setPendingEdits((prev) => new Map(prev).set(m.toolUseId!, m));
        } else {
          setNonEditPermReq(m);
        }
      } else if (m.type === 'plan_proposed') {
        setPlanProposed(m);
      } else if (m.type === 'error') {
        setState((s) => addSystem(s, m.message, 'error'));
        toast.push(m.message, { level: 'error' });
      }
    };
    const client = new WsClient(token, onMessage);
    wsRef.current = client;
    client.connect();
    client.onOpen(() => client.send({ type: 'hello' }));
    return () => { client.close(); };
  }, [authed, token, toast]);

  const newSession = (opts?: { cwd?: string; resumeClaudeId?: string; model?: string; mode?: PermissionMode; title?: string }) => {
    setState(initialState);
    setLocalItems([]);
    setPendingEdits(new Map());
    setNonEditPermReq(null);
    setPlanProposed(null);
    setSessionTitle(opts?.title);
    wsRef.current?.send({
      type: 'hello',
      cwd: opts?.cwd,
      resumeClaudeId: opts?.resumeClaudeId,
      model: opts?.model,
      permissionMode: opts?.mode,
    });
  };

  const sendUser = (text: string) => {
    if (!text.trim() || !state.state) return;
    setLocalItems((prev) => [...prev, { kind: 'user', id: Math.random().toString(36).slice(2), text }]);
    wsRef.current?.send({ type: 'user', text });
  };

  const respond = (req: ServerPermissionRequest | null, decision: 'allow' | 'deny', scope?: 'once' | 'session') => {
    if (!req) return;
    wsRef.current?.send({ type: 'permission_response', reqId: req.reqId, decision, scope });
  };

  const onAcceptEdit = (reqId: string) => {
    const entry = [...pendingEdits.entries()].find(([, v]) => v.reqId === reqId);
    if (!entry) return;
    wsRef.current?.send({ type: 'permission_response', reqId, decision: 'allow' });
    setPendingEdits((prev) => { const n = new Map(prev); n.delete(entry[0]); return n; });
  };
  const onRejectEdit = (reqId: string) => {
    const entry = [...pendingEdits.entries()].find(([, v]) => v.reqId === reqId);
    if (!entry) return;
    wsRef.current?.send({ type: 'permission_response', reqId, decision: 'deny' });
    setPendingEdits((prev) => { const n = new Map(prev); n.delete(entry[0]); return n; });
  };

  const onPlanApprove = () => {
    if (!planProposed) return;
    wsRef.current?.send({ type: 'plan_response', reqId: planProposed.reqId, decision: 'approve' });
    setPlanProposed(null);
  };
  const onPlanReject = () => {
    if (!planProposed) return;
    wsRef.current?.send({ type: 'plan_response', reqId: planProposed.reqId, decision: 'reject' });
    setPlanProposed(null);
  };

  const setMode = (mode: PermissionMode) => {
    wsRef.current?.send({ type: 'set_permission_mode', mode });
    toast.push(`Mode: ${modeLabel(mode)}`, { level: 'success' });
  };
  const setModel = (model: string) => {
    wsRef.current?.send({ type: 'set_model', model });
    toast.push(`Model: ${model}`, { level: 'success' });
  };

  const cycleMode = useCallback((next: PermissionMode) => {
    setMode(next);
  }, []);

  const openRename = () => {
    // Trigger TopBar's inline rename: set a transient title, then let TopBar pick it up.
    setSessionTitle(sessionTitle ?? 'Rename this session');
  };

  const handlePaletteAction = (a: CommandAction) => {
    switch (a.kind) {
      case 'new-chat': newSession({ cwd: state.state?.cwd }); break;
      case 'open-cwd': setCwdPickerOpen(true); break;
      case 'rename': openRename(); break;
      case 'refresh': refreshSessions(state.state?.cwd); break;
      case 'set-model': setModel(a.id); break;
      case 'set-mode': setMode(a.mode); break;
      case 'resume': {
        const s = sessions.find((x) => x.sessionId === a.claudeSessionId);
        const title = s?.customTitle ?? s?.summary ?? s?.firstPrompt;
        newSession({ cwd: state.state?.cwd, resumeClaudeId: a.claudeSessionId, title });
        break;
      }
    }
  };

  const onSlash = (a: SlashAction) => {
    if (a.kind === 'new') newSession({ cwd: state.state?.cwd });
    else if (a.kind === 'cwd') setCwdPickerOpen(true);
    else if (a.kind === 'model') setModel(a.id);
    else if (a.kind === 'mode') setMode(a.mode);
    else if (a.kind === 'history') { /* sidebar is always visible */ }
  };

  // Global keyboard
  useKeyboard(useCallback((e: KeyboardEvent) => {
    // Cmd/Ctrl + K
    if (e.key === 'k' && isMod(e)) { e.preventDefault(); setPaletteOpen((v) => !v); return; }
    // Cmd/Ctrl + N for new chat
    if (e.key === 'n' && isMod(e)) { e.preventDefault(); newSession({ cwd: state.state?.cwd }); return; }
    // Cmd/Ctrl + O to open folder
    if (e.key === 'o' && isMod(e)) { e.preventDefault(); setCwdPickerOpen(true); return; }
    // Shift+Tab from anywhere outside a textarea cycles mode too — but we already handle it inside InputBar.
    if (e.shiftKey && e.key === 'Tab' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      const cur = state.state?.permissionMode ?? 'default';
      const idx = MODE_ORDER.indexOf(cur);
      const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
      cycleMode(next);
    }
  }, [state.state?.permissionMode, state.state?.cwd, cycleMode]));

  const renameCurrent = async (title: string) => {
    if (!state.state?.claudeSessionId || !token) return;
    setSessionTitle(title);
    try {
      await fetch(`/api/session/rename?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claudeSessionId: state.state.claudeSessionId, title, cwd: state.state.cwd }),
      });
      refreshSessions(state.state.cwd);
      toast.push('Session renamed', { level: 'success' });
    } catch { toast.push('Rename failed', { level: 'error' }); }
  };

  const renameInList = async (claudeSessionId: string, newTitle: string) => {
    if (!token) return;
    try {
      await fetch(`/api/session/rename?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claudeSessionId, title: newTitle, cwd: state.state?.cwd }),
      });
      refreshSessions(state.state?.cwd);
      toast.push('Session renamed', { level: 'success' });
    } catch { toast.push('Rename failed', { level: 'error' }); }
  };

  const pendingByToolUseId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [tuid, req] of pendingEdits) m.set(tuid, req.reqId);
    return m;
  }, [pendingEdits]);

  const items = useMemo(() => [...localItems, ...state.items], [localItems, state.items]);
  const showEmpty = items.length === 0 && !state.busy && !state.streamingText;

  if (authed === null) return <Centered>checking auth…</Centered>;
  if (authed === false) return (
    <Centered>
      <div className="text-center space-y-2">
        <div className="text-danger">Missing or invalid token.</div>
        <div className="text-text-muted text-sm">Open the URL the server printed on launch (includes <code className="font-mono text-xs">?t=…</code>).</div>
      </div>
    </Centered>
  );

  return (
    <div className="flex h-full">
      <Sidebar
        cwd={state.state?.cwd ?? defaultCwd}
        sessions={sessions}
        activeId={state.state?.claudeSessionId ?? null}
        onNew={() => newSession({ cwd: state.state?.cwd })}
        onResume={(claudeId, title) => newSession({ cwd: state.state?.cwd, resumeClaudeId: claudeId, title })}
        onRefresh={() => refreshSessions(state.state?.cwd)}
        onRename={renameInList}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        connected={connected}
      />
      <main className="flex-1 flex flex-col min-w-0 relative">
        <TopBar
          state={state.state}
          token={token!}
          cwdPickerOpen={cwdPickerOpen}
          setCwdPickerOpen={setCwdPickerOpen}
          onSelectCwd={(cwd) => newSession({ cwd })}
          onSelectModel={setModel}
          onSelectMode={setMode}
          onRename={renameCurrent}
          sessionTitle={sessionTitle}
          connected={connected}
        />
        {showEmpty ? (
          <EmptyState cwd={state.state?.cwd ?? defaultCwd} onUsePrompt={(t) => setInputSeed(t)} />
        ) : (
          <MessageList
            items={items}
            busy={state.busy}
            streamingText={state.streamingText}
            pendingByToolUseId={pendingByToolUseId}
            onAcceptEdit={onAcceptEdit}
            onRejectEdit={onRejectEdit}
          />
        )}
        <InputBar
          token={token!}
          cwd={state.state?.cwd ?? defaultCwd}
          mode={state.state?.permissionMode ?? 'default'}
          busy={state.busy}
          ready={connected && !!state.state}
          initialText={inputSeed}
          onSend={(t) => { sendUser(t); setInputSeed(undefined); }}
          onStop={() => wsRef.current?.send({ type: 'interrupt' })}
          onSlashAction={onSlash}
          onCycleMode={cycleMode}
        />
      </main>
      {nonEditPermReq && (
        <PermissionModal
          req={nonEditPermReq}
          onAllow={(scope) => { respond(nonEditPermReq, 'allow', scope); setNonEditPermReq(null); }}
          onDeny={() => { respond(nonEditPermReq, 'deny'); setNonEditPermReq(null); }}
        />
      )}
      {planProposed && <PlanApprovalModal plan={planProposed.plan} onApprove={onPlanApprove} onReject={onPlanReject} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        state={state.state}
        sessions={sessions}
        onAction={handlePaletteAction}
      />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center text-text-secondary">{children}</div>;
}
