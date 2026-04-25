import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WsClient, type ConnectionState } from './ws';
import { applyEvent, applyStateDelta, initialState, addSystem, addUserOptimistic, withReady, type ChatState } from './reducer';
import { cachedLastEventId, rememberChatState } from './sessionCache';
import { buildReconnectHello } from './reconnect';
import { deriveActivitySessions, deriveActivitySummary } from './activity';
import type { ClaudeAuthInfo, PermissionMode, SdkEvent, ServerInfo, ServerMessage, ServerPermissionRequest, ServerPlanProposed, SessionStateSnapshot, StoredSession } from './types';
import { modeLabel, MODE_ORDER } from './types';
import { Sidebar } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { PermissionModal } from './components/PermissionModal';
import { PlanApprovalModal } from './components/PlanApprovalModal';
import { ProjectLauncher } from './components/ProjectLauncher';
import { InputBar } from './components/InputBar';
import { TopBar } from './components/TopBar';
import { EmptyState } from './components/EmptyState';
import { InitialSetup } from './components/InitialSetup';
import { CommandPalette, type CommandAction } from './components/CommandPalette';
import { StatusBar } from './components/StatusBar';
import { useKeyboard, isMod } from './hooks/useKeyboard';
import { useToast } from './components/Toast';
import type { SlashAction } from './components/SlashPalette';
import { normalizeProjectPath, readPinnedProjects, readRecentProjects, rememberProject, togglePinnedProject, type ProjectEntry } from './projectHistory';
import { readSkin, skinById, writeSkin, type SkinId } from './skins';

const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SETUP_SEEN_KEY = 'ccw_setup_seen_v1';

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
  const stateRef = useRef<ChatState>(initialState);
  const cacheRef = useRef<Map<string, ChatState>>(new Map());
  const activeSessionIdRef = useRef<string | null>(null);
  const liveStatusRef = useRef<Map<string, SessionStateSnapshot['runtimeStatus']>>(new Map());
  const [nonEditPermReq, setNonEditPermReq] = useState<ServerPermissionRequest | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Map<string, ServerPermissionRequest>>(new Map());
  const [planProposed, setPlanProposed] = useState<ServerPlanProposed | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [projectSessions, setProjectSessions] = useState<Record<string, StoredSession[]>>({});
  const [liveSessions, setLiveSessions] = useState<SessionStateSnapshot[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string>('');
  const [authInfo, setAuthInfo] = useState<ClaudeAuthInfo | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const connected = connection === 'open';
  const [sessionTitle, setSessionTitle] = useState<string | undefined>(undefined);
  const lastEventAtRef = useRef<number>(Date.now());
  const [secondsSinceLastEvent, setSecondsSinceLastEvent] = useState(0);
  const [projectLauncherOpen, setProjectLauncherOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectEntry[]>(() => readRecentProjects());
  const [pinnedProjects, setPinnedProjects] = useState<string[]>(() => readPinnedProjects());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inputSeed, setInputSeed] = useState<string | undefined>(undefined);
  const [setupSeen, setSetupSeen] = useState<boolean>(() => readSetupSeen());
  const [skin, setSkinState] = useState<SkinId>(() => safeReadSkin());
  const wsRef = useRef<WsClient | null>(null);

  const commitState = useCallback((nextState: ChatState | ((prev: ChatState) => ChatState)) => {
    setState((prev) => {
      const next = typeof nextState === 'function' ? nextState(prev) : nextState;
      stateRef.current = next;
      rememberChatState(cacheRef.current, activeSessionIdRef.current, next);
      return next;
    });
  }, []);

  // rAF-coalesced event queue: high-frequency SDK events (especially stream_event
  // text deltas) get collapsed to one setState per animation frame, not per message.
  const pendingRef = useRef<Array<{ id: number; event: SdkEvent }>>([]);
  const rafScheduled = useRef(false);
  const flushEvents = useCallback(() => {
    rafScheduled.current = false;
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];
    commitState((s) => pending.reduce((acc, { id, event }) => applyEvent(acc, event, id), s));
  }, [commitState]);
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
    document.documentElement.dataset.skin = skin;
  }, [skin]);

  useEffect(() => {
    if (!token) { setAuthed(false); return; }
    fetch(`/auth-check?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => setAuthed(!!j.ok))
      .catch(() => setAuthed(false));
  }, [token]);

  const refreshProjectSessions = useCallback((cwd: string, primary = false) => {
    if (!token || !cwd) return;
    const normalized = normalizeProjectPath(cwd);
    const url = `/api/sessions?t=${encodeURIComponent(token)}&cwd=${encodeURIComponent(normalized)}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        const list = j.sessions ?? [];
        setProjectSessions((prev) => ({ ...prev, [normalized]: list }));
        if (primary) setSessions(list);
      })
      .catch(() => {});
  }, [token]);

  const refreshSessions = useCallback((cwd?: string) => {
    const target = cwd ?? stateRef.current.state?.cwd ?? defaultCwd;
    if (!target) return;
    refreshProjectSessions(target, true);
  }, [defaultCwd, refreshProjectSessions]);

  const refreshProjects = useCallback((projects: ProjectEntry[], activeProject: string) => {
    for (const project of projects) refreshProjectSessions(project.path, project.path === activeProject);
  }, [refreshProjectSessions]);

  const projectEntries = useMemo(() => buildProjectEntries({
    current: state.state?.cwd,
    fallback: defaultCwd,
    recents: recentProjects,
    pinned: pinnedProjects,
  }), [defaultCwd, pinnedProjects, recentProjects, state.state?.cwd]);

  const currentCwd = state.state?.cwd ?? defaultCwd;

  const allKnownSessions = useMemo(() => {
    const byId = new Map<string, StoredSession>();
    for (const list of Object.values(projectSessions)) {
      for (const s of list) byId.set(s.sessionId, s);
    }
    for (const s of sessions) byId.set(s.sessionId, s);
    return [...byId.values()];
  }, [projectSessions, sessions]);

  const sessionProject = useMemo(() => {
    const byId = new Map<string, string>();
    for (const [cwd, list] of Object.entries(projectSessions)) {
      for (const s of list) byId.set(s.sessionId, cwd);
    }
    return byId;
  }, [projectSessions]);

  useEffect(() => {
    if (!authed || !token) return;
    fetch(`/api/info?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => {
        const info = j as ServerInfo;
        setServerInfo(info);
        setDefaultCwd(info.cwd ?? '');
        setAuthInfo(info.auth ?? null);
        if (info.home) (window as unknown as { __ccw_home__?: string }).__ccw_home__ = info.home;
      });
  }, [authed, token]);

  useEffect(() => {
    if (!authed || !token) return;
    refreshSessions(state.state?.cwd);
  }, [state.state?.cwd, authed, token, refreshSessions]);

  useEffect(() => {
    if (!authed || !token || projectEntries.length === 0) return;
    for (const project of projectEntries.slice(0, 12)) {
      if (projectSessions[project.path] === undefined) {
        refreshProjectSessions(project.path, project.path === currentCwd);
      }
    }
  }, [authed, currentCwd, projectEntries, projectSessions, refreshProjectSessions, token]);

  useEffect(() => {
    if (!authed || !token) return;
    const onMessage = (m: ServerMessage) => {
      if (m.type === 'ready') {
        pendingRef.current = [];
        lastEventAtRef.current = Date.now();
        activeSessionIdRef.current = m.state.sessionId;
        const cached = cacheRef.current.get(m.state.sessionId) ?? { ...initialState };
        commitState(() => withReady(cached, m.state));
        setRecentProjects(rememberProject(m.state.cwd));
        setPendingEdits(new Map());
        setNonEditPermReq(null);
        setPlanProposed(null);
      } else if (m.type === 'state_update') {
        commitState((s) => applyStateDelta(s, m.state));
      } else if (m.type === 'heartbeat') {
        if (m.noActivityMs !== undefined) {
          lastEventAtRef.current = Date.now() - m.noActivityMs;
          setSecondsSinceLastEvent(Math.floor(m.noActivityMs / 1000));
        }
        if (m.session && m.session.sessionId === activeSessionIdRef.current) {
          commitState((s) => applyStateDelta(s, m.session!));
        }
      } else if (m.type === 'sdk_event') {
        enqueueEvent(m.id, m.event);
      } else if (m.type === 'sdk_events_batch') {
        // Batch replay from the server: fold the whole set into one setState to
        // avoid 900× renders on attach to a long session.
        const evs = m.events;
        commitState((s) => evs.reduce((acc, { id, event }) => applyEvent(acc, event, id), s));
      } else if (m.type === 'sessions_update') {
        const previous = liveStatusRef.current;
        const activeId = activeSessionIdRef.current;
        const completed = m.sessions.find((s) => {
          const prev = previous.get(s.sessionId);
          return s.sessionId !== activeId
            && s.runtimeStatus === 'idle'
            && (prev === 'running' || prev === 'waiting_permission' || prev === 'waiting_plan');
        });
        liveStatusRef.current = new Map(m.sessions.map((s) => [s.sessionId, s.runtimeStatus]));
        setLiveSessions(m.sessions);
        if (completed) refreshSessions(completed.cwd);
      } else if (m.type === 'pending_control') {
        if (m.sessionId !== activeSessionIdRef.current) return;
        if (m.control.kind === 'permission') {
          const { kind, ...req } = m.control;
          if (EDIT_LIKE.has(req.toolName) && req.toolUseId) {
            setPendingEdits((prev) => new Map(prev).set(req.toolUseId!, { type: 'permission_request', ...req }));
          } else {
            setNonEditPermReq({ type: 'permission_request', ...req });
          }
        } else {
          setPlanProposed({ type: 'plan_proposed', reqId: m.control.reqId, plan: m.control.plan });
        }
      } else if (m.type === 'permission_request') {
        if (EDIT_LIKE.has(m.toolName) && m.toolUseId) {
          setPendingEdits((prev) => new Map(prev).set(m.toolUseId!, m));
        } else {
          setNonEditPermReq(m);
        }
      } else if (m.type === 'plan_proposed') {
        setPlanProposed(m);
      } else if (m.type === 'error') {
        commitState((s) => addSystem(s, m.message, 'error'));
        toast.push(m.message, { level: 'error' });
      }
    };
    const client = new WsClient(token, onMessage);
    wsRef.current = client;
    client.onConnectionChange((s) => setConnection(s));
    client.connect();
    client.onOpen(() => {
      const activeId = activeSessionIdRef.current;
      client.send(buildReconnectHello(
        activeId,
        stateRef.current,
        activeId ? cachedLastEventId(cacheRef.current, activeId) : 0
      ));
    });
    return () => { client.close(); };
  }, [authed, token, toast, enqueueEvent, commitState, refreshSessions]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const newSession = useCallback((opts?: { cwd?: string; resumeClaudeId?: string; model?: string; mode?: PermissionMode; title?: string; viewerMode?: boolean }) => {
    pendingRef.current = [];
    activeSessionIdRef.current = null;
    commitState(initialState);
    setPendingEdits(new Map());
    setNonEditPermReq(null);
    setPlanProposed(null);
    setSessionTitle(opts?.title);
    if (opts?.cwd) setRecentProjects(rememberProject(opts.cwd));
    wsRef.current?.send({
      type: 'hello',
      cwd: opts?.cwd,
      resumeClaudeId: opts?.resumeClaudeId,
      model: opts?.model,
      permissionMode: opts?.mode,
      viewerMode: opts?.viewerMode,
    });
  }, [commitState]);

  const attachLiveSession = useCallback((sessionId: string, title?: string) => {
    pendingRef.current = [];
    activeSessionIdRef.current = sessionId;
    const cached = cacheRef.current.get(sessionId) ?? { ...initialState };
    commitState(cached);
    setPendingEdits(new Map());
    setNonEditPermReq(null);
    setPlanProposed(null);
    setSessionTitle(title);
    wsRef.current?.send({ type: 'hello', sessionId, lastEventId: cachedLastEventId(cacheRef.current, sessionId) });
  }, [commitState]);

  const closeLiveSession = useCallback((sessionId: string) => {
    wsRef.current?.send({ type: 'session_close', sessionId });
    cacheRef.current.delete(sessionId);
    setLiveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    if (activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current = null;
      commitState(initialState);
      setPendingEdits(new Map());
      setNonEditPermReq(null);
      setPlanProposed(null);
      setSessionTitle(undefined);
    }
  }, [commitState]);

  const sendUser = useCallback((text: string) => {
    if (!text.trim()) return;
    commitState((s) => (s.state ? addUserOptimistic(s, text) : s));
    wsRef.current?.send({ type: 'user', text });
  }, [commitState]);

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
    commitState((s) => applyStateDelta(s, { permissionMode: mode }));
    wsRef.current?.send({ type: 'set_permission_mode', mode });
    toast.push(`Mode: ${modeLabel(mode)}`, { level: 'success' });
  }, [toast, commitState]);
  const setModel = useCallback((model: string) => {
    commitState((s) => applyStateDelta(s, { model }));
    wsRef.current?.send({ type: 'set_model', model });
    toast.push(`Model: ${model}`, { level: 'success' });
  }, [toast, commitState]);
  const setSkin = useCallback((next: SkinId) => {
    setSkinState(next);
    try { writeSkin(next); } catch { /* localStorage can be unavailable */ }
    toast.push(`Skin: ${skinById(next).label}`, { level: 'success', icon: 'palette' });
  }, [toast]);

  const cycleMode = useCallback((next: PermissionMode) => setMode(next), [setMode]);

  const openRename = useCallback(() => {
    setSessionTitle(sessionTitle ?? 'Rename this session');
  }, [sessionTitle]);

  const handlePaletteAction = useCallback((a: CommandAction) => {
    switch (a.kind) {
      case 'new-chat': newSession({ cwd: state.state?.cwd }); break;
      case 'open-cwd': setSidebarOpen(false); setProjectLauncherOpen(true); break;
      case 'rename': openRename(); break;
      case 'refresh': refreshSessions(state.state?.cwd); break;
      case 'set-model': setModel(a.id); break;
      case 'set-skin': setSkin(a.id); break;
      case 'set-mode': setMode(a.mode); break;
      case 'resume': {
        const s = allKnownSessions.find((x) => x.sessionId === a.claudeSessionId);
        const title = s?.customTitle ?? s?.summary ?? s?.firstPrompt;
        newSession({ cwd: sessionProject.get(a.claudeSessionId) ?? state.state?.cwd, resumeClaudeId: a.claudeSessionId, title });
        break;
      }
    }
  }, [allKnownSessions, newSession, openRename, sessionProject, state.state?.cwd, setModel, setSkin, setMode, refreshSessions]);

  const onSlash = useCallback((a: SlashAction) => {
    if (a.kind === 'new') newSession({ cwd: state.state?.cwd });
    else if (a.kind === 'cwd') { setSidebarOpen(false); setProjectLauncherOpen(true); }
    else if (a.kind === 'model') setModel(a.id);
    else if (a.kind === 'mode') setMode(a.mode);
    else if (a.kind === 'history') setSidebarOpen(true);
  }, [newSession, state.state?.cwd, setModel, setMode]);

  useKeyboard(useCallback((e: KeyboardEvent) => {
    if (e.key === 'k' && isMod(e)) { e.preventDefault(); setPaletteOpen((v) => !v); return; }
    if (e.key === 'n' && isMod(e)) { e.preventDefault(); newSession({ cwd: state.state?.cwd }); return; }
    if (e.key === 'o' && isMod(e)) { e.preventDefault(); setSidebarOpen(false); setProjectLauncherOpen(true); return; }
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
  }, [state.state?.claudeSessionId, state.state?.cwd, token, toast, refreshSessions]);

  const renameInList = useCallback(async (claudeSessionId: string, newTitle: string, cwd?: string) => {
    if (!token) return;
    const targetCwd = cwd ?? state.state?.cwd;
    try {
      await fetch(`/api/session/rename?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claudeSessionId, title: newTitle, cwd: targetCwd }),
      });
      refreshSessions(targetCwd);
      toast.push('Session renamed', { level: 'success' });
    } catch { toast.push('Rename failed', { level: 'error' }); }
  }, [state.state?.cwd, token, toast, refreshSessions]);

  const pendingByToolUseId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [tuid, req] of pendingEdits) m.set(tuid, req.reqId);
    return m;
  }, [pendingEdits]);

  const activitySessions = useMemo(
    () => deriveActivitySessions({
      liveSessions,
      activeSessionId: state.state?.sessionId ?? null,
      cache: cacheRef.current,
      storedSessions: allKnownSessions,
    }),
    [allKnownSessions, liveSessions, state.state?.sessionId, state.items, state.lastEventId]
  );
  const activitySummary = useMemo(() => deriveActivitySummary(activitySessions), [activitySessions]);
  const activeDraftTitle = useMemo(() => {
    if (sessionTitle) return sessionTitle;
    const firstUser = state.items.find((it) => it.kind === 'user' && it.text.trim());
    return firstUser?.kind === 'user' ? firstUser.text : undefined;
  }, [sessionTitle, state.items]);

  const toggleProjectPin = useCallback((path: string) => {
    setPinnedProjects(togglePinnedProject(path));
  }, []);

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

  const stopCurrent = useCallback(() => {
    wsRef.current?.send({ type: 'interrupt' });
  }, []);

  const dismissSetup = useCallback(() => {
    rememberSetupSeen();
    setSetupSeen(true);
  }, []);

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
    <div className="app-shell flex h-full">
      <div
        className={`mobile-sidebar-backdrop ${sidebarOpen ? 'is-open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />
      <div className={`sidebar-shell ${sidebarOpen ? 'is-open' : ''}`}>
        <Sidebar
          cwd={currentCwd}
          projects={projectEntries}
          projectSessions={projectSessions}
          activeId={state.state?.claudeSessionId ?? null}
          activeSession={state.state}
          activeDraftTitle={activeDraftTitle}
          activitySummary={activitySummary}
          activitySessions={activitySessions}
          onNewInProject={(cwd) => { setSidebarOpen(false); newSession({ cwd }); }}
          onResume={(claudeId, title, cwd) => { setSidebarOpen(false); newSession({ cwd, resumeClaudeId: claudeId, title }); }}
          onView={(claudeId, title, cwd) => { setSidebarOpen(false); newSession({ cwd, resumeClaudeId: claudeId, title, viewerMode: true }); }}
          onOpenActivity={(sessionId, title) => { setSidebarOpen(false); attachLiveSession(sessionId, title); }}
          onEndActivity={closeLiveSession}
          onRefresh={() => refreshProjects(projectEntries, currentCwd)}
          onRename={renameInList}
          onOpenCommandPalette={() => { setSidebarOpen(false); setPaletteOpen(true); }}
          onOpenProject={() => { setSidebarOpen(false); setProjectLauncherOpen((v) => !v); }}
          connected={connected}
          skin={skin}
        />
      </div>
      {projectLauncherOpen && (
        <ProjectLauncher
          token={token!}
          current={currentCwd || defaultCwd || '/root'}
          recents={recentProjects}
          pinned={pinnedProjects}
          busy={state.busy}
          onClose={() => setProjectLauncherOpen(false)}
          onPick={(cwd) => { setSidebarOpen(false); newSession({ cwd }); }}
          onTogglePin={toggleProjectPin}
        />
      )}
      <main className="flex-1 flex flex-col min-w-0 relative">
        <TopBar
          state={state.state}
          cwd={currentCwd}
          auth={authInfo}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenProject={() => { setSidebarOpen(false); setProjectLauncherOpen((v) => !v); }}
          onSelectModel={setModel}
          skin={skin}
          onSelectSkin={setSkin}
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
          <EmptyState skin={skin} cwd={currentCwd} onUsePrompt={(t) => setInputSeed(t)} onOpenProject={() => setProjectLauncherOpen(true)} />
        ) : (
          <MessageList
            token={token!}
            cwd={currentCwd}
            skin={skin}
            items={state.items}
            busy={state.busy}
            streamingText={state.streamingText}
            pendingByToolUseId={pendingByToolUseId}
            secondsSinceLastEvent={secondsSinceLastEvent}
            activeTool={state.state?.activeTool}
            onAcceptEdit={onAcceptEdit}
            onRejectEdit={onRejectEdit}
            onStop={stopCurrent}
          />
        )}
        <div className="px-4 pb-1 pt-0">
          <StatusBar
            connection={connection}
            busy={state.busy}
            streamingText={state.streamingText}
            items={state.items}
            activeTool={state.state?.activeTool}
            hasPermReq={!!nonEditPermReq}
            pendingEditCount={pendingEdits.size}
            hasPlan={!!planProposed}
            secondsSinceLastEvent={secondsSinceLastEvent}
            skin={skin}
            onFocusPending={firstPendingEditToolUseId ? focusPending : undefined}
            onStop={stopCurrent}
          />
        </div>
        <InputBar
          token={token!}
          cwd={currentCwd}
          mode={state.state?.permissionMode ?? 'default'}
          busy={state.busy}
          ready={connected && !!state.state && !state.state?.viewerMode}
          readOnly={!!state.state?.viewerMode}
          initialText={inputSeed}
          onSend={(t) => { sendUser(t); setInputSeed(undefined); }}
          onStop={stopCurrent}
          onSlashAction={onSlash}
          onCycleMode={cycleMode}
          onSetMode={setMode}
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
        sessions={allKnownSessions}
        currentSkin={skin}
        onAction={handlePaletteAction}
      />
      {!setupSeen && (
        <InitialSetup
          cwd={currentCwd}
          home={serverInfo?.home}
          auth={authInfo}
          claude={serverInfo?.claude}
          server={serverInfo?.server}
          onDone={dismissSetup}
          onOpenProject={() => {
            dismissSetup();
            setProjectLauncherOpen(true);
          }}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center text-text-secondary">{children}</div>;
}

function buildProjectEntries(opts: { current?: string; fallback?: string; recents: ProjectEntry[]; pinned: string[] }): ProjectEntry[] {
  const out = new Map<string, ProjectEntry>();
  const add = (path: string | undefined, lastUsed: number) => {
    if (!path) return;
    const normalized = normalizeProjectPath(path);
    if (!normalized || out.has(normalized)) return;
    out.set(normalized, { path: normalized, lastUsed });
  };

  add(opts.current, Number.MAX_SAFE_INTEGER);
  opts.pinned.forEach((path, i) => add(path, Number.MAX_SAFE_INTEGER - i - 1));
  for (const project of opts.recents) add(project.path, project.lastUsed);
  add(opts.fallback, 0);
  return [...out.values()];
}

function readSetupSeen(): boolean {
  try {
    return window.localStorage.getItem(SETUP_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSetupSeen() {
  try {
    window.localStorage.setItem(SETUP_SEEN_KEY, '1');
  } catch {
    // localStorage can be unavailable in private contexts.
  }
}

function safeReadSkin(): SkinId {
  try { return readSkin(); }
  catch { return 'warm'; }
}
