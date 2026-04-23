import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WsClient, type ConnectionState } from './ws';
import { applyEvent, applyStateDelta, initialState, addSystem, addUserOptimistic, withReady, type ChatState } from './reducer';
import type { PermissionMode, SdkEvent, ServerMessage, ServerPermissionRequest, ServerPlanProposed, StoredSession } from './types';
import { modeLabel, MODE_ORDER } from './types';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { PermissionModal } from './components/PermissionModal';
import { PlanApprovalModal } from './components/PlanApprovalModal';
import { InputBar } from './components/InputBar';
import { TopBar } from './components/TopBar';
import { EmptyState } from './components/EmptyState';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
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
  const [nonEditPermReq, setNonEditPermReq] = useState<ServerPermissionRequest | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Map<string, ServerPermissionRequest>>(new Map());
  const [planProposed, setPlanProposed] = useState<ServerPlanProposed | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string>('');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const connected = connection === 'open';
  const [sessionTitle, setSessionTitle] = useState<string | undefined>(undefined);
  const lastEventAtRef = useRef<number>(Date.now());
  const [secondsSinceLastEvent, setSecondsSinceLastEvent] = useState(0);
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inputSeed, setInputSeed] = useState<string | undefined>(undefined);
  const wsRef = useRef<WsClient | null>(null);

  // rAF-coalesced event queue: high-frequency SDK events (especially stream_event
  // text deltas) get collapsed to one setState per animation frame, not per message.
  const pendingRef = useRef<Array<{ id: number; event: SdkEvent }>>([]);
  const rafScheduled = useRef(false);
  const flushEvents = useCallback(() => {
    rafScheduled.current = false;
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];
    setState((s) => pending.reduce((acc, { id, event }) => applyEvent(acc, event, id), s));
  }, []);
  const enqueueEvent = useCallback((id: number, event: SdkEvent) => {
    pendingRef.current.push({ id, event });
    lastEventAtRef.current = Date.now();
    if (!rafScheduled.current) {
      rafScheduled.current = true;
      requestAnimationFrame(flushEvents);
    }
  }, [flushEvents]);

  // Tick every second while busy so the StatusBar's "no activity for Ns" counter
  // updates without needing a prop change from each event.
  useEffect(() => {
    const t = setInterval(() => {
      setSecondsSinceLastEvent(Math.floor((Date.now() - lastEventAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

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
        pendingRef.current = [];
        lastEventAtRef.current = Date.now();
        setState(() => withReady({ ...initialState }, m.state));
        setPendingEdits(new Map());
        setNonEditPermReq(null);
        setPlanProposed(null);
      } else if (m.type === 'state_update') {
        setState((s) => applyStateDelta(s, m.state));
      } else if (m.type === 'sdk_event') {
        enqueueEvent(m.id, m.event);
      } else if (m.type === 'sdk_events_batch') {
        // Batch replay from the server: fold the whole set into one setState to
        // avoid 900× renders on attach to a long session.
        const evs = m.events;
        setState((s) => evs.reduce((acc, { id, event }) => applyEvent(acc, event, id), s));
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
    client.onConnectionChange((s) => setConnection(s));
    client.connect();
    client.onOpen(() => client.send({ type: 'hello' }));
    return () => { client.close(); };
  }, [authed, token, toast, enqueueEvent]);

  const newSession = useCallback((opts?: { cwd?: string; resumeClaudeId?: string; model?: string; mode?: PermissionMode; title?: string; viewerMode?: boolean }) => {
    pendingRef.current = [];
    setState(initialState);
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
      viewerMode: opts?.viewerMode,
    });
  }, []);

  const sendUser = useCallback((text: string) => {
    if (!text.trim()) return;
    setState((s) => (s.state ? addUserOptimistic(s, text) : s));
    wsRef.current?.send({ type: 'user', text });
  }, []);

  const onAcceptEdit = useCallback((reqId: string) => {
    setPendingEdits((prev) => {
      let targetTuid: string | undefined;
      for (const [k, v] of prev) if (v.reqId === reqId) { targetTuid = k; break; }
      if (!targetTuid) return prev;
      wsRef.current?.send({ type: 'permission_response', reqId, decision: 'allow' });
      const n = new Map(prev); n.delete(targetTuid); return n;
    });
  }, []);
  const onRejectEdit = useCallback((reqId: string) => {
    setPendingEdits((prev) => {
      let targetTuid: string | undefined;
      for (const [k, v] of prev) if (v.reqId === reqId) { targetTuid = k; break; }
      if (!targetTuid) return prev;
      wsRef.current?.send({ type: 'permission_response', reqId, decision: 'deny' });
      const n = new Map(prev); n.delete(targetTuid); return n;
    });
  }, []);

  const onPlanApprove = useCallback(() => {
    if (!planProposed) return;
    wsRef.current?.send({ type: 'plan_response', reqId: planProposed.reqId, decision: 'approve' });
    setPlanProposed(null);
  }, [planProposed]);
  const onPlanReject = useCallback(() => {
    if (!planProposed) return;
    wsRef.current?.send({ type: 'plan_response', reqId: planProposed.reqId, decision: 'reject' });
    setPlanProposed(null);
  }, [planProposed]);

  const setMode = useCallback((mode: PermissionMode) => {
    // Optimistic: update UI immediately. Server will ACK via state_update
    // shortly; on failure a red toast surfaces from the error handler.
    setState((s) => applyStateDelta(s, { permissionMode: mode }));
    wsRef.current?.send({ type: 'set_permission_mode', mode });
    toast.push(`Mode: ${modeLabel(mode)}`, { level: 'success' });
  }, [toast]);
  const setModel = useCallback((model: string) => {
    setState((s) => applyStateDelta(s, { model }));
    wsRef.current?.send({ type: 'set_model', model });
    toast.push(`Model: ${model}`, { level: 'success' });
  }, [toast]);

  const cycleMode = useCallback((next: PermissionMode) => setMode(next), [setMode]);

  const openRename = useCallback(() => {
    setSessionTitle(sessionTitle ?? 'Rename this session');
  }, [sessionTitle]);

  const handlePaletteAction = useCallback((a: CommandAction) => {
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
  }, [newSession, openRename, state.state?.cwd, setModel, setMode, sessions]);

  const onSlash = useCallback((a: SlashAction) => {
    if (a.kind === 'new') newSession({ cwd: state.state?.cwd });
    else if (a.kind === 'cwd') setCwdPickerOpen(true);
    else if (a.kind === 'model') setModel(a.id);
    else if (a.kind === 'mode') setMode(a.mode);
    else if (a.kind === 'history') { /* sidebar always visible */ }
  }, [newSession, state.state?.cwd, setModel, setMode]);

  useKeyboard(useCallback((e: KeyboardEvent) => {
    if (e.key === 'k' && isMod(e)) { e.preventDefault(); setPaletteOpen((v) => !v); return; }
    if (e.key === 'n' && isMod(e)) { e.preventDefault(); newSession({ cwd: state.state?.cwd }); return; }
    if (e.key === 'o' && isMod(e)) { e.preventDefault(); setCwdPickerOpen(true); return; }
    if (e.shiftKey && e.key === 'Tab' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      const cur = state.state?.permissionMode ?? 'default';
      const idx = MODE_ORDER.indexOf(cur);
      const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
      cycleMode(next);
    }
  }, [state.state?.permissionMode, state.state?.cwd, cycleMode, newSession]));

  const renameCurrent = useCallback(async (title: string) => {
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
  }, [state.state?.claudeSessionId, state.state?.cwd, token, toast]);

  const renameInList = useCallback(async (claudeSessionId: string, newTitle: string) => {
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
  }, [state.state?.cwd, token, toast]);

  const pendingByToolUseId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [tuid, req] of pendingEdits) m.set(tuid, req.reqId);
    return m;
  }, [pendingEdits]);

  const showEmpty = state.items.length === 0 && !state.busy && !state.streamingText;

  const firstPendingEditToolUseId = useMemo(() => {
    for (const [tuid] of pendingEdits) return tuid;
    return undefined;
  }, [pendingEdits]);

  const focusPending = useCallback(() => {
    if (firstPendingEditToolUseId) {
      const el = document.getElementById(`diff-${firstPendingEditToolUseId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [firstPendingEditToolUseId]);

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
        onView={(claudeId, title) => newSession({ cwd: state.state?.cwd, resumeClaudeId: claudeId, title, viewerMode: true })}
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
          onContinueWriting={state.state?.viewerMode && state.state?.claudeSessionId
            ? () => newSession({ cwd: state.state?.cwd, resumeClaudeId: state.state!.claudeSessionId, title: sessionTitle })
            : undefined}
          onRefreshHistory={state.state?.viewerMode
            ? () => wsRef.current?.send({ type: 'refresh_history' })
            : undefined}
          sessionTitle={sessionTitle}
          connected={connected}
        />
        {showEmpty ? (
          <EmptyState cwd={state.state?.cwd ?? defaultCwd} onUsePrompt={(t) => setInputSeed(t)} />
        ) : (
          <MessageList
            items={state.items}
            busy={state.busy}
            streamingText={state.streamingText}
            pendingByToolUseId={pendingByToolUseId}
            onAcceptEdit={onAcceptEdit}
            onRejectEdit={onRejectEdit}
          />
        )}
        <div className="px-4 pb-1 pt-0">
          <StatusBar
            connection={connection}
            busy={state.busy}
            streamingText={state.streamingText}
            items={state.items}
            hasPermReq={!!nonEditPermReq}
            pendingEditCount={pendingEdits.size}
            hasPlan={!!planProposed}
            secondsSinceLastEvent={secondsSinceLastEvent}
            onFocusPending={firstPendingEditToolUseId ? focusPending : undefined}
          />
        </div>
        <InputBar
          token={token!}
          cwd={state.state?.cwd ?? defaultCwd}
          mode={state.state?.permissionMode ?? 'default'}
          busy={state.busy}
          ready={connected && !!state.state && !state.state?.viewerMode}
          readOnly={!!state.state?.viewerMode}
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
          onAllow={(scope) => { wsRef.current?.send({ type: 'permission_response', reqId: nonEditPermReq.reqId, decision: 'allow', scope }); setNonEditPermReq(null); }}
          onDeny={() => { wsRef.current?.send({ type: 'permission_response', reqId: nonEditPermReq.reqId, decision: 'deny' }); setNonEditPermReq(null); }}
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
