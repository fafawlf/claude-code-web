import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WsClient, type ConnectionState } from './ws';
import { applyEvent, applyEventBatch, applyStateDelta, initialState, addSystem, addUserOptimistic, settleReplayedHistory, withReady, type ChatState } from './reducer';
import { cachedChatState, cachedLastEventId, chatStateForReady, displaySessionKey, forgetChatState, rememberChatState, SessionCache, type SessionIdentity } from './sessionCache';
import { buildReconnectHello } from './reconnect';
import { createAttachId, isMessageForAttachment, readyUsesExplicitReplay, replayModeForReady, withAttachId, type AttachmentViewState } from './attachment';
import { deriveActivitySessions, deriveActivitySummary } from './activity';
import type { AgentProviderId, AuthMode, ClaudeAuthInfo, ClaudeAuthMode, ClientHello, MeInfo, NodeInfo, PermissionMode, SdkEvent, ServerInfo, ServerMessage, ServerPermissionRequest, ServerPlanProposed, SessionStateSnapshot, StoredSession } from './types';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, defaultModelForProvider, modeLabel, MODE_ORDER } from './types';
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
import { AdminUsersModal } from './components/AdminUsersModal';
import { StatusBar } from './components/StatusBar';
import { useKeyboard, isMod } from './hooks/useKeyboard';
import { blocksGlobalAppShortcuts, resolveTopLevelModal, useModalBackground } from './hooks/useModalLayer';
import { useToast } from './components/Toast';
import type { SlashAction } from './components/SlashPalette';
import { normalizeProjectPath, readPinnedProjects, readRecentProjects, rememberProject, togglePinnedProject, type ProjectEntry } from './projectHistory';
import { readSkin, skinById, writeSkin, type SkinId } from './skins';
import { appUrl } from './appUrl';
import { apiFetch, setApiToken } from './api';
import { ProjectRequestCoordinator } from './projectRequests';

const EDIT_LIKE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SETUP_SEEN_KEY = 'ccw_setup_seen_v1';
const ACTIVE_SESSION_KEY = 'ccw_active_session_v1';

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
  setApiToken(token);
  const { push: pushToast } = useToast();
  const restoredActiveRef = useRef<StoredActiveSession | null>(readStoredActiveSession());
  const initialChatState = restoredActiveRef.current
    ? withReady({ ...initialState }, restoredActiveRef.current.state)
    : initialState;
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('token');
  const [me, setMe] = useState<MeInfo | null>(null);
  const [state, setState] = useState<ChatState>(initialChatState);
  const stateRef = useRef<ChatState>(initialChatState);
  const cacheRef = useRef(new SessionCache());
  const activeSessionIdRef = useRef<string | null>(restoredActiveRef.current?.sessionId ?? null);
  const initialAttachmentRef = useRef<AttachmentViewState>({
    attachId: createAttachId(),
    phase: 'connecting',
    requestedSessionId: restoredActiveRef.current?.sessionId,
    targetProviderSessionId: restoredActiveRef.current?.state.providerSessionId ?? restoredActiveRef.current?.state.claudeSessionId,
    targetCwd: restoredActiveRef.current?.state.cwd,
    displaySessionKey: restoredActiveRef.current ? displaySessionKey(restoredActiveRef.current.state) : 'session:boot',
    hasCachedState: false,
    replayAfterId: 0,
    legacyReplay: false,
  });
  const [attachment, setAttachment] = useState<AttachmentViewState>(initialAttachmentRef.current);
  const attachmentRef = useRef<AttachmentViewState>(initialAttachmentRef.current);
  const replayStateRef = useRef<ChatState | null>(null);
  const currentHelloRef = useRef<ClientHello | null>(null);
  const scrollPositionsRef = useRef(new Map<string, number | 'bottom'>());
  const liveStatusRef = useRef<Map<string, SessionStateSnapshot['runtimeStatus']>>(new Map());
  const [nonEditPermReq, setNonEditPermReq] = useState<ServerPermissionRequest | null>(null);
  const [pendingEdits, setPendingEdits] = useState<Map<string, ServerPermissionRequest>>(new Map());
  const [planProposed, setPlanProposed] = useState<ServerPlanProposed | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [projectSessions, setProjectSessions] = useState<Record<string, StoredSession[]>>({});
  const projectRequestsRef = useRef(new ProjectRequestCoordinator<StoredSession[]>());
  const [liveSessions, setLiveSessions] = useState<SessionStateSnapshot[]>([]);
  const [defaultCwd, setDefaultCwd] = useState<string>('');
  const [authInfo, setAuthInfo] = useState<ClaudeAuthInfo | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [nodesLoaded, setNodesLoaded] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => safeReadLocalStorage('ccw_selected_node') ?? DEFAULT_NODE_ID);
  const [selectedProvider, setSelectedProvider] = useState<AgentProviderId>(() => readSelectedProvider());
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const connected = connection === 'open';
  const [sessionTitle, setSessionTitle] = useState<string | undefined>(undefined);
  const [renameRequest, setRenameRequest] = useState(0);
  const lastEventAtRef = useRef<number>(Date.now());
  const [secondsSinceLastEvent, setSecondsSinceLastEvent] = useState(0);
  const [projectLauncherOpen, setProjectLauncherOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<ProjectEntry[]>(() => readRecentProjects());
  const [pinnedProjects, setPinnedProjects] = useState<string[]>(() => readPinnedProjects());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [adminUsersOpen, setAdminUsersOpen] = useState(false);
  const [inputSeed, setInputSeed] = useState<string | undefined>(undefined);
  const [setupSeen, setSetupSeen] = useState<boolean>(() => readSetupSeen());
  const [skin, setSkinState] = useState<SkinId>(() => safeReadSkin());
  const wsRef = useRef<WsClient | null>(null);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const selectedProviderRef = useRef(selectedProvider);
  const [backgroundRef, setBackgroundRef] = useState<HTMLDivElement | null>(null);

  const activeModal = resolveTopLevelModal({
    setup: !setupSeen,
    permission: !!nonEditPermReq,
    plan: !!planProposed,
    project: projectLauncherOpen,
    palette: paletteOpen,
    admin: adminUsersOpen,
  });
  useModalBackground(backgroundRef, activeModal !== null);

  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { selectedProviderRef.current = selectedProvider; }, [selectedProvider]);
  useEffect(() => installMobileViewportVars(), []);
  useEffect(() => () => projectRequestsRef.current.dispose(), []);
  useEffect(() => {
    if (activeModal !== 'setup' && activeModal !== 'permission' && activeModal !== 'plan') return;
    setProjectLauncherOpen(false);
    setPaletteOpen(false);
    setAdminUsersOpen(false);
  }, [activeModal]);

  const commitState = useCallback((nextState: ChatState | ((prev: ChatState) => ChatState)) => {
    const next = typeof nextState === 'function' ? nextState(stateRef.current) : nextState;
    stateRef.current = next;
    rememberChatState(cacheRef.current, activeSessionIdRef.current, next);
    writeStoredActiveSession(activeSessionIdRef.current, next.state);
    setState(next);
  }, []);

  const commitAttachment = useCallback((nextState: AttachmentViewState | ((prev: AttachmentViewState) => AttachmentViewState)) => {
    const next = typeof nextState === 'function' ? nextState(attachmentRef.current) : nextState;
    attachmentRef.current = next;
    setAttachment(next);
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
    if (!state.busy) {
      setSecondsSinceLastEvent((seconds) => seconds === 0 ? seconds : 0);
      return;
    }
    const t = setInterval(() => {
      setSecondsSinceLastEvent(Math.floor((Date.now() - lastEventAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [state.busy]);

  useEffect(() => {
    document.documentElement.dataset.skin = skin;
  }, [skin]);

  // Poll the sessions list every 10s while connected. The server no longer
  // broadcasts sessions_update on every state transition (it was pushing ~the
  // entire snapshot per activeTool change, which buried mobile clients). Web
  // trades that instant sidebar freshness for a 10s beat, which is fine for
  // the sidebar use case and totally removes the push-backpressure class of
  // bugs.
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => {
      wsRef.current?.send({ type: 'list_sessions' });
    }, 10000);
    return () => clearInterval(t);
  }, [authed]);

  useEffect(() => {
    // Works for both auth modes: with a token it validates the token, without
    // one it validates the feishu session cookie. A feishu server answering
    // 401 means "go log in" — bounce through the OAuth flow.
    apiFetch('/auth-check')
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; authMode?: AuthMode };
        if (j.authMode) setAuthMode(j.authMode);
        if (j.ok) { setAuthed(true); return; }
        if (j.authMode === 'feishu') {
          window.location.href = appUrl('/login');
          return;
        }
        setAuthed(false);
      })
      .catch(() => setAuthed(false));
  }, [token]);

  useEffect(() => {
    if (!authed) return;
    apiFetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMe(j as MeInfo | null))
      .catch(() => {});
  }, [authed]);

  const refreshProjectSessions = useCallback((cwd: string, primary = false) => {
    if (!cwd) return;
    const normalized = normalizeProjectPath(cwd);
    const url = `/api/sessions?cwd=${encodeURIComponent(normalized)}`;
    void projectRequestsRef.current.request(
      normalized,
      primary,
      async (signal) => {
        const response = await apiFetch(url, { signal });
        if (!response.ok) throw new Error(`session list failed (${response.status})`);
        const body = await response.json() as { sessions?: StoredSession[] };
        return body.sessions ?? [];
      },
      (list, isCurrentPrimary) => {
        setProjectSessions((prev) => ({ ...prev, [normalized]: list }));
        if (isCurrentPrimary) setSessions(list);
      },
    )
      .catch(() => {});
  }, []);

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
    home: serverInfo?.home,
    fallback: defaultCwd,
    recents: recentProjects,
    pinned: pinnedProjects,
  }), [defaultCwd, pinnedProjects, recentProjects, serverInfo?.home, state.state?.cwd]);

  const currentCwd = attachment.targetCwd ?? state.state?.cwd ?? defaultCwd;

  const selectNodeSilently = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    selectedNodeIdRef.current = nodeId;
    try { window.localStorage.setItem('ccw_selected_node', nodeId); } catch { /* localStorage can be unavailable */ }
  }, []);

  const selectProviderSilently = useCallback((provider: AgentProviderId) => {
    setSelectedProvider(provider);
    selectedProviderRef.current = provider;
    try { window.localStorage.setItem('ccw_selected_provider', provider); } catch { /* localStorage can be unavailable */ }
  }, []);

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
    if (!authed) return;
    apiFetch('/api/info')
      .then((r) => r.json())
      .then((j) => {
        const info = j as ServerInfo;
        setServerInfo(info);
        setDefaultCwd(info.cwd ?? '');
        setAuthInfo(info.auth ?? null);
        if (info.node) {
          setNodes((prev) => prev.length ? prev : [info.node!]);
          if (!safeReadLocalStorage('ccw_selected_node')) selectNodeSilently(info.node.id);
        }
        if (info.home) (window as unknown as { __ccw_home__?: string }).__ccw_home__ = info.home;
      });
  }, [authed, selectNodeSilently]);

  useEffect(() => {
    if (!authed) return;
    apiFetch('/api/nodes')
      .then((r) => r.json())
      .then((j) => {
        const list = (j.nodes ?? []) as NodeInfo[];
        setNodes(list);
        const preferred = list.find((n) => n.id === selectedNodeIdRef.current) ?? list[0];
        if (!preferred) return;
        if (preferred.id !== selectedNodeIdRef.current) selectNodeSilently(preferred.id);
        if (!preferred.providers.includes(selectedProviderRef.current)) selectProviderSilently(preferred.providers[0] ?? DEFAULT_AGENT_PROVIDER);
      })
      .catch(() => {})
      .finally(() => setNodesLoaded(true));
  }, [authed, selectNodeSilently, selectProviderSilently]);

  useEffect(() => {
    if (!authed) return;
    refreshSessions(state.state?.cwd);
  }, [state.state?.cwd, authed, refreshSessions]);

  useEffect(() => {
    if (!authed || projectEntries.length === 0) return;
    for (const project of projectEntries.slice(0, 12)) {
      if (projectSessions[project.path] === undefined) {
        refreshProjectSessions(project.path, project.path === currentCwd);
      }
    }
  }, [authed, currentCwd, projectEntries, projectSessions, refreshProjectSessions]);

  const rememberReconnectIntent = useCallback((chat: ChatState, lastEventId: number) => {
    if (!chat.state) return;
    const hello = withAttachId(
      buildReconnectHello(chat.state.sessionId, chat, lastEventId),
      attachmentRef.current.attachId,
    );
    currentHelloRef.current = hello;
    wsRef.current?.setHelloIntent(hello);
  }, []);

  const serverMessageHandlerRef = useRef<(message: ServerMessage) => void>(() => {});
  serverMessageHandlerRef.current = (m: ServerMessage) => {
    const currentAttachment = attachmentRef.current;
    if (!isMessageForAttachment(m, currentAttachment, activeSessionIdRef.current)) return;

    if (m.type === 'ready') {
      pendingRef.current = [];
      lastEventAtRef.current = Date.now();
      activeSessionIdRef.current = m.state.sessionId;
      selectNodeSilently(m.state.nodeId);
      selectProviderSilently(m.state.provider);

      const cached = cachedChatState(cacheRef.current, m.state)
        ?? (currentAttachment.hasCachedState ? stateRef.current : undefined);
      const base = withReady(chatStateForReady(stateRef.current, cached, m.state), m.state);
      const explicitReplay = readyUsesExplicitReplay(m);
      const replayMode = replayModeForReady(m, currentAttachment.replayAfterId);
      rememberReconnectIntent(base, replayMode === 'delta' ? currentAttachment.replayAfterId : 0);
      const nextDisplayKey = currentAttachment.displaySessionKey.startsWith('session:pending')
        || currentAttachment.displaySessionKey.startsWith('session:boot')
        ? displaySessionKey(m.state)
        : currentAttachment.displaySessionKey;

      if (m.historyStatus === 'error') {
        replayStateRef.current = null;
        commitState(base);
        commitAttachment({
          ...currentAttachment,
          phase: 'error',
          requestedSessionId: m.state.sessionId,
          targetProviderSessionId: m.state.providerSessionId ?? m.state.claudeSessionId,
          targetCwd: m.state.cwd,
          displaySessionKey: nextDisplayKey,
          replayMode,
          legacyReplay: false,
        });
      } else if (!explicitReplay) {
        // Rolling-deploy compatibility with the old server, which sent ready
        // without an explicit replay completion frame.
        replayStateRef.current = null;
        commitState(base);
        commitAttachment({
          ...currentAttachment,
          phase: 'ready',
          requestedSessionId: m.state.sessionId,
          targetProviderSessionId: m.state.providerSessionId ?? m.state.claudeSessionId,
          targetCwd: m.state.cwd,
          displaySessionKey: nextDisplayKey,
          replayMode,
          legacyReplay: true,
        });
      } else if (replayMode === 'full') {
        // Keep the cached transcript visible while a fresh replay is built off
        // screen. The replacement becomes visible in one commit at completion.
        replayStateRef.current = withReady({ ...initialState }, m.state);
        commitAttachment({
          ...currentAttachment,
          phase: 'replaying',
          requestedSessionId: m.state.sessionId,
          targetProviderSessionId: m.state.providerSessionId ?? m.state.claudeSessionId,
          targetCwd: m.state.cwd,
          displaySessionKey: nextDisplayKey,
          replayMode,
          legacyReplay: false,
        });
      } else {
        replayStateRef.current = null;
        commitState(base);
        commitAttachment({
          ...currentAttachment,
          phase: 'replaying',
          requestedSessionId: m.state.sessionId,
          targetProviderSessionId: m.state.providerSessionId ?? m.state.claudeSessionId,
          targetCwd: m.state.cwd,
          displaySessionKey: nextDisplayKey,
          replayMode,
          legacyReplay: false,
        });
      }

      try { setRecentProjects(rememberProject(m.state.cwd)); } catch { /* storage may be unavailable */ }
      setPendingEdits(new Map());
      setNonEditPermReq(null);
      setPlanProposed(null);
      wsRef.current?.send({ type: 'list_sessions' });
      return;
    }

    if (m.type === 'state_update') {
      if (currentAttachment.phase === 'replaying' && currentAttachment.replayMode === 'full' && replayStateRef.current) {
        replayStateRef.current = applyStateDelta(replayStateRef.current, m.state);
      } else {
        commitState((s) => applyStateDelta(s, m.state));
      }
    } else if (m.type === 'heartbeat') {
      if (m.noActivityMs !== undefined) {
        lastEventAtRef.current = Date.now() - m.noActivityMs;
        if (stateRef.current.busy) setSecondsSinceLastEvent(Math.floor(m.noActivityMs / 1000));
      }
      if (m.session && m.session.sessionId === activeSessionIdRef.current) {
        if (currentAttachment.phase === 'replaying' && currentAttachment.replayMode === 'full' && replayStateRef.current) {
          replayStateRef.current = applyStateDelta(replayStateRef.current, m.session);
        } else {
          commitState((s) => applyStateDelta(s, m.session!));
        }
      }
    } else if (m.type === 'sdk_event') {
      if (currentAttachment.phase === 'replaying' && currentAttachment.replayMode === 'full' && replayStateRef.current) {
        replayStateRef.current = applyEvent(replayStateRef.current, m.event, m.id);
      } else {
        enqueueEvent(m.id, m.event);
      }
    } else if (m.type === 'sdk_events_batch') {
      if (currentAttachment.phase === 'replaying' && currentAttachment.replayMode === 'full') {
        const builder = replayStateRef.current ?? { ...initialState };
        replayStateRef.current = applyEventBatch(builder, m.events);
        if (m.replayComplete) {
          const completed = settleReplayedHistory(replayStateRef.current);
          replayStateRef.current = null;
          commitState(completed);
          rememberReconnectIntent(completed, completed.lastEventId);
          commitAttachment((current) => ({ ...current, phase: 'ready', hasCachedState: completed.items.length > 0 }));
        }
      } else {
        commitState((s) => {
          const replayed = applyEventBatch(s, m.events);
          return m.replayComplete || currentAttachment.legacyReplay ? settleReplayedHistory(replayed) : replayed;
        });
        if (m.replayComplete) {
          rememberReconnectIntent(stateRef.current, stateRef.current.lastEventId);
          commitAttachment((current) => ({ ...current, phase: 'ready', hasCachedState: stateRef.current.items.length > 0 }));
        }
      }
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
      if (currentAttachment.phase !== 'ready') {
        replayStateRef.current = null;
        commitAttachment((current) => ({ ...current, phase: 'error' }));
      }
      commitState((s) => addSystem(s, m.message, 'error'));
      pushToast(m.message, { level: 'error' });
    }
  };

  useEffect(() => {
    if (!authed || !nodesLoaded || nodes.length === 0) return;
    const client = new WsClient(token ?? '', (message) => serverMessageHandlerRef.current(message));
    wsRef.current = client;
    client.onConnectionChange((s) => setConnection(s));
    let hello = currentHelloRef.current;
    if (!hello) {
      const activeId = activeSessionIdRef.current;
      if (!activeId) {
        const provider = selectedProviderRef.current;
        hello = { type: 'hello', nodeId: selectedNodeIdRef.current, provider, model: defaultModelForProvider(provider) };
      } else {
        hello = buildReconnectHello(
          activeId,
          stateRef.current,
          stateRef.current.state ? cachedLastEventId(cacheRef.current, stateRef.current.state) : 0
        );
      }
      hello = withAttachId(hello, attachmentRef.current.attachId);
      currentHelloRef.current = hello;
    }
    client.send(hello);
    client.connect();
    return () => {
      if (wsRef.current === client) wsRef.current = null;
      client.close();
    };
  }, [authed, nodes.length, nodesLoaded, token]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const beginAttachment = useCallback((
    helloInput: ClientHello,
    target: SessionIdentity,
    cached?: ChatState,
  ) => {
    const attachId = createAttachId();
    const hello = withAttachId(helloInput, attachId);
    const stableKey = displaySessionKey(target);
    const nextAttachment: AttachmentViewState = {
      attachId,
      phase: 'connecting',
      requestedSessionId: hello.sessionId,
      targetProviderSessionId: target.providerSessionId ?? target.claudeSessionId,
      targetCwd: target.cwd,
      displaySessionKey: stableKey === 'session:pending' ? `${stableKey}:${attachId}` : stableKey,
      hasCachedState: !!cached && cached.items.length > 0,
      replayAfterId: hello.lastEventId ?? 0,
      legacyReplay: false,
    };

    pendingRef.current = [];
    replayStateRef.current = null;
    activeSessionIdRef.current = hello.sessionId ?? null;
    currentHelloRef.current = hello;
    commitAttachment(nextAttachment);
    commitState(cached ?? { ...initialState });
    setPendingEdits(new Map());
    setNonEditPermReq(null);
    setPlanProposed(null);
    wsRef.current?.send(hello);
  }, [commitAttachment, commitState]);

  const newSession = useCallback((opts?: { nodeId?: string; provider?: AgentProviderId; cwd?: string; resumeClaudeId?: string; model?: string; claudeAuthMode?: ClaudeAuthMode; mode?: PermissionMode; title?: string; viewerMode?: boolean }) => {
    const nodeId = opts?.nodeId ?? selectedNodeIdRef.current;
    const provider = opts?.provider ?? selectedProviderRef.current;
    const current = stateRef.current;
    const claudeAuthMode = provider === 'claude'
      ? (opts?.claudeAuthMode ?? (current.state?.provider === 'claude' ? current.state.claudeAuthMode : undefined))
      : undefined;
    const carryCurrent = canUseCurrentAsResumeSeed(current, opts, nodeId, provider);
    const seededState = carryCurrent && current.state
      ? {
          ...current,
          busy: false,
          streamingText: '',
          state: {
            ...current.state,
            nodeId,
            provider,
            cwd: opts?.cwd ?? current.state.cwd,
            viewerMode: false,
            runtimeStatus: 'idle' as const,
            activeTool: undefined,
          },
        }
      : { ...initialState };
    const identity: SessionIdentity = {
      nodeId,
      provider,
      cwd: opts?.cwd ?? current.state?.cwd,
      providerSessionId: opts?.resumeClaudeId,
      claudeSessionId: provider === 'claude' ? opts?.resumeClaudeId : undefined,
    };
    const cached = carryCurrent
      ? seededState
      : opts?.resumeClaudeId
        ? cachedChatState(cacheRef.current, identity)
        : undefined;
    setSessionTitle(opts?.title);
    selectNodeSilently(nodeId);
    selectProviderSilently(provider);
    if (opts?.cwd) {
      try { setRecentProjects(rememberProject(opts.cwd)); } catch { /* storage may be unavailable */ }
    }
    beginAttachment({
      type: 'hello',
      nodeId,
      provider,
      cwd: opts?.cwd,
      resumeClaudeId: opts?.resumeClaudeId,
      model: opts?.model ?? defaultModelForProvider(provider),
      claudeAuthMode,
      permissionMode: opts?.mode,
      viewerMode: opts?.viewerMode,
      // A transcript-only resume may create a new runtime wrapper with a new
      // event-id space. Cursor replay is safe only for an exact live session.
      lastEventId: undefined,
    }, identity, cached);
  }, [beginAttachment, selectNodeSilently, selectProviderSilently]);

  const attachLiveSession = useCallback((sessionId: string, title?: string) => {
    const live = liveSessions.find((s) => s.sessionId === sessionId);
    const identity: SessionIdentity = live ?? { sessionId };
    const cached = cachedChatState(cacheRef.current, identity);
    setSessionTitle(title);
    beginAttachment({
      type: 'hello',
      nodeId: live?.nodeId,
      provider: live?.provider,
      sessionId,
      lastEventId: cachedLastEventId(cacheRef.current, live ?? sessionId),
    }, identity, cached);
  }, [beginAttachment, liveSessions]);

  const closeLiveSession = useCallback((sessionId: string) => {
    if (!wsRef.current?.send({ type: 'session_close', sessionId })) {
      pushToast('Session was not closed. Reconnect and try again.', { level: 'error' });
      return;
    }
    const live = liveSessions.find((s) => s.sessionId === sessionId);
    forgetChatState(cacheRef.current, live ?? sessionId);
    setLiveSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    if (activeSessionIdRef.current === sessionId) {
      activeSessionIdRef.current = null;
      currentHelloRef.current = null;
      replayStateRef.current = null;
      writeStoredActiveSession(null, null);
      commitState(initialState);
      commitAttachment({
        attachId: createAttachId(),
        phase: 'ready',
        displaySessionKey: 'session:pending',
        hasCachedState: false,
        replayAfterId: 0,
        legacyReplay: false,
      });
      setPendingEdits(new Map());
      setNonEditPermReq(null);
      setPlanProposed(null);
      setSessionTitle(undefined);
    }
  }, [commitAttachment, commitState, liveSessions, pushToast]);

  const sendUser = useCallback((text: string) => {
    if (!text.trim()) return;
    if (!wsRef.current?.send({ type: 'user', text })) {
      pushToast('Message not sent. Reconnect and try again.', { level: 'error' });
      return;
    }
    commitState((s) => (s.state ? addUserOptimistic(s, text) : s));
  }, [commitState, pushToast]);

  const onAcceptEdit = useCallback((reqId: string) => {
    setPendingEdits((prev) => {
      let targetTuid: string | undefined;
      for (const [k, v] of prev) if (v.reqId === reqId) { targetTuid = k; break; }
      if (!targetTuid) return prev;
      if (!wsRef.current?.send({ type: 'permission_response', reqId, decision: 'allow' })) {
        pushToast('Approval not sent. Reconnect and try again.', { level: 'error' });
        return prev;
      }
      const n = new Map(prev); n.delete(targetTuid); return n;
    });
  }, [pushToast]);
  const onRejectEdit = useCallback((reqId: string) => {
    setPendingEdits((prev) => {
      let targetTuid: string | undefined;
      for (const [k, v] of prev) if (v.reqId === reqId) { targetTuid = k; break; }
      if (!targetTuid) return prev;
      if (!wsRef.current?.send({ type: 'permission_response', reqId, decision: 'deny' })) {
        pushToast('Response not sent. Reconnect and try again.', { level: 'error' });
        return prev;
      }
      const n = new Map(prev); n.delete(targetTuid); return n;
    });
  }, [pushToast]);

  const onPlanApprove = useCallback(() => {
    if (!planProposed) return;
    if (!wsRef.current?.send({ type: 'plan_response', reqId: planProposed.reqId, decision: 'approve' })) {
      pushToast('Plan approval not sent. Reconnect and try again.', { level: 'error' });
      return;
    }
    setPlanProposed(null);
  }, [planProposed, pushToast]);
  const onPlanReject = useCallback(() => {
    if (!planProposed) return;
    if (!wsRef.current?.send({ type: 'plan_response', reqId: planProposed.reqId, decision: 'reject' })) {
      pushToast('Plan response not sent. Reconnect and try again.', { level: 'error' });
      return;
    }
    setPlanProposed(null);
  }, [planProposed, pushToast]);

  const setMode = useCallback((mode: PermissionMode) => {
    if (!wsRef.current?.send({ type: 'set_permission_mode', mode })) {
      pushToast('Mode not changed. Reconnect and try again.', { level: 'error' });
      return;
    }
    commitState((s) => applyStateDelta(s, { permissionMode: mode }));
    pushToast(`Mode: ${modeLabel(mode)}`, { level: 'success' });
  }, [pushToast, commitState]);
  const setModel = useCallback((model: string) => {
    if (!wsRef.current?.send({ type: 'set_model', model })) {
      pushToast('Model not changed. Reconnect and try again.', { level: 'error' });
      return;
    }
    commitState((s) => applyStateDelta(s, { model }));
    pushToast(`Model: ${model}`, { level: 'success' });
  }, [pushToast, commitState]);
  const setClaudeAuthMode = useCallback((mode: ClaudeAuthMode) => {
    if (!wsRef.current?.send({ type: 'set_claude_auth_mode', mode })) {
      pushToast('Billing mode not changed. Reconnect and try again.', { level: 'error' });
      return;
    }
    commitState((s) => applyStateDelta(s, { claudeAuthMode: mode }));
    pushToast(mode === 'api' ? 'Claude API billing selected' : 'Claude account selected', { level: 'success' });
  }, [pushToast, commitState]);
  const continueWithApi = useCallback(() => {
    const snap = stateRef.current.state;
    if (!snap || snap.provider !== 'claude') {
      setClaudeAuthMode('api');
      return;
    }
    if (snap.claudeSessionId) {
      newSession({
        nodeId: snap.nodeId,
        provider: 'claude',
        cwd: snap.cwd,
        resumeClaudeId: snap.claudeSessionId,
        model: snap.model,
        claudeAuthMode: 'api',
        mode: snap.permissionMode,
        title: sessionTitle,
        viewerMode: false,
      });
      pushToast('Continuing this chat with Claude API billing', { level: 'success' });
      return;
    }
    setClaudeAuthMode('api');
  }, [newSession, sessionTitle, setClaudeAuthMode, pushToast]);
  const selectNodeProvider = useCallback((nodeId: string, provider: AgentProviderId) => {
    const node = nodes.find((n) => n.id === nodeId);
    selectNodeSilently(nodeId);
    selectProviderSilently(provider);
    newSession({ nodeId, provider, cwd: node?.defaultCwd ?? currentCwd });
    pushToast(`${node?.label ?? nodeId}: ${provider === 'codex' ? 'Codex' : 'Claude Code'}`, { level: 'success' });
  }, [currentCwd, newSession, nodes, selectNodeSilently, selectProviderSilently, pushToast]);
  const setSkin = useCallback((next: SkinId) => {
    setSkinState(next);
    try { writeSkin(next); } catch { /* localStorage can be unavailable */ }
    pushToast(`Skin: ${skinById(next).label}`, { level: 'success', icon: 'palette' });
  }, [pushToast]);

  const openCommandPalette = useCallback(() => {
    setSidebarOpen(false);
    setProjectLauncherOpen(false);
    setAdminUsersOpen(false);
    setPaletteOpen(true);
  }, []);
  const openProjectLauncher = useCallback(() => {
    setSidebarOpen(false);
    setPaletteOpen(false);
    setAdminUsersOpen(false);
    setProjectLauncherOpen(true);
  }, []);
  const openAdminUsers = useCallback(() => {
    setPaletteOpen(false);
    setProjectLauncherOpen(false);
    setAdminUsersOpen(true);
  }, []);

  const cycleMode = useCallback((next: PermissionMode) => setMode(next), [setMode]);

  const openRename = useCallback(() => {
    if (!stateRef.current.state?.claudeSessionId) {
      pushToast('Open a saved chat before renaming it.', { level: 'error' });
      return;
    }
    setRenameRequest((request) => request + 1);
  }, [pushToast]);

  const handlePaletteAction = useCallback((a: CommandAction) => {
    switch (a.kind) {
      case 'new-chat': newSession({ cwd: state.state?.cwd }); break;
      case 'open-cwd': openProjectLauncher(); break;
      case 'rename': openRename(); break;
      case 'refresh': refreshSessions(state.state?.cwd); break;
      case 'set-model': setModel(a.id); break;
      case 'set-skin': setSkin(a.id); break;
      case 'set-mode': setMode(a.mode); break;
      case 'resume': {
        const s = allKnownSessions.find((x) => x.sessionId === a.claudeSessionId);
        const title = s?.customTitle ?? s?.summary ?? s?.firstPrompt;
        newSession({ cwd: sessionProject.get(a.claudeSessionId) ?? state.state?.cwd, resumeClaudeId: a.claudeSessionId, title, viewerMode: true });
        break;
      }
    }
  }, [allKnownSessions, newSession, openProjectLauncher, openRename, sessionProject, state.state?.cwd, setModel, setSkin, setMode, refreshSessions]);

  const onSlash = useCallback((a: SlashAction) => {
    if (a.kind === 'new') newSession({ cwd: state.state?.cwd });
    else if (a.kind === 'cwd') openProjectLauncher();
    else if (a.kind === 'model') setModel(a.id);
    else if (a.kind === 'mode') setMode(a.mode);
    else if (a.kind === 'history') setSidebarOpen(true);
  }, [newSession, openProjectLauncher, state.state?.cwd, setModel, setMode]);

  useKeyboard(useCallback((e: KeyboardEvent) => {
    const appShortcut = isMod(e) && ['k', 'n', 'o'].includes(e.key.toLowerCase());
    if (blocksGlobalAppShortcuts(activeModal)) {
      if (appShortcut) e.preventDefault();
      if (activeModal === 'palette' && e.key.toLowerCase() === 'k' && isMod(e)) setPaletteOpen(false);
      return;
    }
    if (e.key === 'k' && isMod(e)) { e.preventDefault(); openCommandPalette(); return; }
    if (e.key === 'n' && isMod(e)) { e.preventDefault(); newSession({ cwd: state.state?.cwd }); return; }
    if (e.key === 'o' && isMod(e)) { e.preventDefault(); openProjectLauncher(); return; }
    if (e.shiftKey && e.key === 'Tab' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      const cur = state.state?.permissionMode ?? 'default';
      const idx = MODE_ORDER.indexOf(cur);
      const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
      cycleMode(next);
    }
  }, [activeModal, state.state?.permissionMode, state.state?.cwd, cycleMode, newSession, openCommandPalette, openProjectLauncher]));

  const renameCurrent = useCallback(async (title: string) => {
    if (!state.state?.claudeSessionId) return;
    const previousTitle = sessionTitle;
    setSessionTitle(title);
    try {
      const response = await apiFetch('/api/session/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claudeSessionId: state.state.claudeSessionId, title, cwd: state.state.cwd }),
      });
      if (!response.ok) throw new Error(`rename failed (${response.status})`);
      refreshSessions(state.state.cwd);
      pushToast('Session renamed', { level: 'success' });
    } catch {
      setSessionTitle(previousTitle);
      pushToast('Rename failed', { level: 'error' });
    }
  }, [state.state?.claudeSessionId, state.state?.cwd, sessionTitle, pushToast, refreshSessions]);

  const renameInList = useCallback(async (claudeSessionId: string, newTitle: string, cwd?: string) => {
    const targetCwd = cwd ?? state.state?.cwd;
    try {
      const response = await apiFetch('/api/session/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claudeSessionId, title: newTitle, cwd: targetCwd }),
      });
      if (!response.ok) throw new Error(`rename failed (${response.status})`);
      refreshSessions(targetCwd);
      pushToast('Session renamed', { level: 'success' });
    } catch { pushToast('Rename failed', { level: 'error' }); }
  }, [state.state?.cwd, pushToast, refreshSessions]);

  const pendingByToolUseId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [tuid, req] of pendingEdits) m.set(tuid, req.reqId);
    return m;
  }, [pendingEdits]);

  const activitySessions = useMemo(
    () => deriveActivitySessions({
      liveSessions,
      activeSessionId: attachment.requestedSessionId ?? state.state?.sessionId ?? null,
      cache: cacheRef.current,
      storedSessions: allKnownSessions,
      home: serverInfo?.home,
    }),
    [allKnownSessions, attachment.requestedSessionId, liveSessions, serverInfo?.home, state.state?.sessionId, state.items, state.lastEventId]
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

  const showAttachmentPlaceholder = attachment.phase !== 'ready' && !attachment.hasCachedState;
  const showEmpty = attachment.phase === 'ready' && state.items.length === 0 && !state.busy && !state.streamingText;

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
    if (!wsRef.current?.send({ type: 'interrupt' })) {
      pushToast('Stop request not sent. Reconnect and try again.', { level: 'error' });
    }
  }, [pushToast]);

  const retryAttachment = useCallback(() => {
    const previous = currentHelloRef.current;
    if (!previous) return;
    const attachId = createAttachId();
    const hello = withAttachId(previous, attachId);
    currentHelloRef.current = hello;
    replayStateRef.current = null;
    commitAttachment((current) => ({ ...current, attachId, phase: 'connecting', legacyReplay: false }));
    wsRef.current?.send(hello);
  }, [commitAttachment]);

  const refreshCurrentHistory = useCallback(() => {
    if (!wsRef.current?.send({ type: 'refresh_history' })) {
      pushToast('History refresh not sent. Reconnect and try again.', { level: 'error' });
    }
  }, [pushToast]);

  const dismissSetup = useCallback(() => {
    rememberSetupSeen();
    setSetupSeen(true);
  }, []);

  if (authed === null) return <Centered>checking auth…</Centered>;
  if (authed === false) return (
    <Centered>
      {authMode === 'feishu' ? (
        <div className="text-center space-y-3">
          <div className="text-text-primary text-lg">Claude Code Web</div>
          <div className="text-text-muted text-sm">Sign in with your Feishu account to continue.</div>
          <button
            onClick={() => { window.location.href = appUrl('/login'); }}
            className="px-4 py-2 rounded-md bg-accent hover:bg-accent-hi text-text-inverse font-medium transition-colors duration-hover"
          >Log in with Feishu</button>
        </div>
      ) : (
        <div className="text-center space-y-2">
          <div className="text-danger">Missing or invalid token.</div>
          <div className="text-text-muted text-sm">Open the URL the server printed on launch (includes <code className="font-mono text-xs">?t=…</code>).</div>
        </div>
      )}
    </Centered>
  );

  return (
    <div className="app-shell flex h-full">
      <div
        ref={setBackgroundRef}
        className="app-background flex h-full w-full min-w-0"
        aria-hidden={activeModal !== null ? true : undefined}
      >
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
          activeId={attachment.targetProviderSessionId ?? state.state?.claudeSessionId ?? null}
          activeSession={state.state}
          activeDraftTitle={activeDraftTitle}
          activitySummary={activitySummary}
          activitySessions={activitySessions}
          onNewInProject={(cwd) => { setSidebarOpen(false); newSession({ cwd }); }}
          onResume={(claudeId, title, cwd) => { setSidebarOpen(false); newSession({ cwd, resumeClaudeId: claudeId, title, viewerMode: true }); }}
          onView={(claudeId, title, cwd) => { setSidebarOpen(false); newSession({ cwd, resumeClaudeId: claudeId, title, viewerMode: true }); }}
          onOpenActivity={(sessionId, title) => { setSidebarOpen(false); attachLiveSession(sessionId, title); }}
          onEndActivity={closeLiveSession}
          onRefresh={() => refreshProjects(projectEntries, currentCwd)}
          onRename={renameInList}
          onOpenCommandPalette={openCommandPalette}
          onOpenProject={openProjectLauncher}
          connected={connected}
          skin={skin}
          />
        </div>
        <main className="flex-1 flex flex-col min-w-0 relative">
        <TopBar
          state={state.state}
          cwd={currentCwd}
          home={serverInfo?.home}
          me={me}
          auth={authInfo}
          codexAuth={serverInfo?.codexAuth}
          codexDefaultModel={serverInfo?.codex?.defaultModel}
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          selectedProvider={selectedProvider}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenProject={openProjectLauncher}
          onOpenAdminUsers={openAdminUsers}
          onSelectNodeProvider={selectNodeProvider}
          onSelectModel={setModel}
          onSelectClaudeAuthMode={setClaudeAuthMode}
          onContinueWithApi={continueWithApi}
          skin={skin}
          onSelectSkin={setSkin}
          onRename={renameCurrent}
          renameRequest={renameRequest}
          onContinueWriting={state.state?.viewerMode && state.state?.claudeSessionId
            ? () => newSession({
                nodeId: state.state!.nodeId,
                provider: state.state!.provider,
                cwd: state.state!.cwd,
                resumeClaudeId: state.state!.claudeSessionId,
                claudeAuthMode: state.state!.claudeAuthMode,
                title: sessionTitle,
              })
            : undefined}
          onRefreshHistory={state.state?.viewerMode
            ? refreshCurrentHistory
            : undefined}
          sessionTitle={sessionTitle}
          connected={connected}
        />
        {showAttachmentPlaceholder ? (
          <AttachmentPlaceholder phase={attachment.phase} onRetry={retryAttachment} />
        ) : showEmpty ? (
          <EmptyState skin={skin} cwd={currentCwd} home={serverInfo?.home} onOpenProject={openProjectLauncher} />
        ) : (
          <div className="relative flex flex-1 min-h-0">
            <MessageList
              key={attachment.displaySessionKey}
              sessionKey={attachment.displaySessionKey}
              scrollPositions={scrollPositionsRef.current}
              token={token ?? ''}
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
            {attachment.phase !== 'ready' && (
              attachment.phase === 'error' ? (
                <button
                  type="button"
                  onClick={retryAttachment}
                  className="absolute right-4 top-3 rounded-full border border-danger/30 bg-bg-raised/95 px-2.5 py-1 text-[11px] text-danger shadow-pop"
                >
                  Sync failed · Retry
                </button>
              ) : (
                <div className="pointer-events-none absolute right-4 top-3 rounded-full border border-border-subtle bg-bg-raised/95 px-2.5 py-1 text-[11px] text-text-secondary shadow-pop">
                  Syncing…
                </div>
              )
            )}
          </div>
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
          token={token ?? ''}
          cwd={currentCwd}
          sessionKey={attachment.displaySessionKey}
          mode={state.state?.permissionMode ?? 'default'}
          provider={state.state?.provider ?? selectedProvider}
          busy={state.busy}
          ready={connected && attachment.phase === 'ready' && !!state.state && !state.state?.viewerMode}
          readOnly={!!state.state?.viewerMode}
          initialText={inputSeed}
          onSend={(t) => { sendUser(t); setInputSeed(undefined); }}
          onStop={stopCurrent}
          onSlashAction={onSlash}
          onCycleMode={cycleMode}
          onSetMode={setMode}
        />
        </main>
      </div>
      {activeModal === 'project' && (
        <ProjectLauncher
          token={token ?? ''}
          current={currentCwd || defaultCwd || '/root'}
          recents={recentProjects}
          pinned={pinnedProjects}
          busy={state.busy}
          onClose={() => setProjectLauncherOpen(false)}
          onPick={(cwd) => { setSidebarOpen(false); newSession({ cwd }); }}
          onTogglePin={toggleProjectPin}
        />
      )}
      {activeModal === 'permission' && nonEditPermReq && (
        <PermissionModal
          req={nonEditPermReq}
          onAllow={(scope) => {
            if (wsRef.current?.send({ type: 'permission_response', reqId: nonEditPermReq.reqId, decision: 'allow', scope })) setNonEditPermReq(null);
            else pushToast('Approval not sent. Reconnect and try again.', { level: 'error' });
          }}
          onDeny={() => {
            if (wsRef.current?.send({ type: 'permission_response', reqId: nonEditPermReq.reqId, decision: 'deny' })) setNonEditPermReq(null);
            else pushToast('Response not sent. Reconnect and try again.', { level: 'error' });
          }}
        />
      )}
      {activeModal === 'plan' && planProposed && <PlanApprovalModal plan={planProposed.plan} onApprove={onPlanApprove} onReject={onPlanReject} />}
      <CommandPalette
        open={activeModal === 'palette'}
        onClose={() => setPaletteOpen(false)}
        state={state.state}
        sessions={allKnownSessions}
        currentSkin={skin}
        currentProvider={state.state?.provider ?? selectedProvider}
        onAction={handlePaletteAction}
      />
      {activeModal === 'admin' && <AdminUsersModal onClose={() => setAdminUsersOpen(false)} />}
      {activeModal === 'setup' && (
        <InitialSetup
          cwd={currentCwd}
          home={serverInfo?.home}
          auth={authInfo}
          claude={serverInfo?.claude}
          server={serverInfo?.server}
          onDone={dismissSetup}
          onOpenProject={() => {
            dismissSetup();
            setPaletteOpen(false);
            setAdminUsersOpen(false);
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

function AttachmentPlaceholder({ phase, onRetry }: { phase: AttachmentViewState['phase']; onRetry: () => void }) {
  if (phase === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-sm font-medium text-text-primary">Couldn’t open this session</div>
        <div className="max-w-sm text-xs text-text-muted">The selected session is still in place. Retry when the connection is available.</div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-bg-raised px-3 py-1.5 text-xs text-text-secondary hover:border-accent/50 hover:text-text-primary"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
      <div className="text-xs text-text-muted">{phase === 'replaying' ? 'Loading conversation…' : 'Connecting to session…'}</div>
    </div>
  );
}

function buildProjectEntries(opts: { current?: string; home?: string; fallback?: string; recents: ProjectEntry[]; pinned: string[] }): ProjectEntry[] {
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
  add(opts.home, -1);
  add(opts.fallback, 0);
  return [...out.values()];
}

function canUseCurrentAsResumeSeed(
  current: ChatState,
  opts: { nodeId?: string; provider?: AgentProviderId; cwd?: string; resumeClaudeId?: string; viewerMode?: boolean } | undefined,
  nodeId: string,
  provider: AgentProviderId
): boolean {
  const snap = current.state;
  if (!snap || !opts?.resumeClaudeId || opts.viewerMode === true || current.items.length === 0) return false;
  const currentProviderSession = snap.providerSessionId ?? snap.claudeSessionId;
  if (currentProviderSession !== opts.resumeClaudeId) return false;
  return snap.nodeId === nodeId && snap.provider === provider && snap.cwd === (opts.cwd ?? snap.cwd);
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

function safeReadLocalStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}

type StoredActiveSession = {
  sessionId: string;
  state: SessionStateSnapshot;
};

function readStoredActiveSession(): StoredActiveSession | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredActiveSession>;
    if (!parsed.sessionId || !parsed.state?.sessionId) return null;
    return { sessionId: parsed.sessionId, state: parsed.state as SessionStateSnapshot };
  } catch {
    return null;
  }
}

function writeStoredActiveSession(sessionId: string | null, state: SessionStateSnapshot | null): void {
  try {
    if (!sessionId || !state) {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({ sessionId, state }));
  } catch {
    // localStorage can be unavailable in private contexts.
  }
}

function installMobileViewportVars(): () => void {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const viewportProbe = document.createElement('div');
  let raf = 0;
  viewportProbe.setAttribute('aria-hidden', 'true');
  viewportProbe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(viewportProbe);

  const update = () => {
    const visualHeight = vv?.height ?? window.innerHeight;
    const visualTop = vv?.offsetTop ?? 0;
    const fixedTop = viewportProbe.getBoundingClientRect().top;
    const shellTop = fixedTop < -1 ? visualTop : 0;
    root.style.setProperty('--vvh', `${Math.round(visualHeight)}px`);
    root.style.setProperty('--vv-top', `${Math.round(shellTop)}px`);
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });
  };
  const onFocusChange = (event: FocusEvent) => {
    if (event.type === 'focusin' && !isKeyboardInput(event.target)) return;
    schedule();
  };
  const onOrientation = () => {
    window.setTimeout(schedule, 120);
  };

  update();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', onOrientation, { passive: true });
  document.addEventListener('focusin', onFocusChange);
  document.addEventListener('focusout', onFocusChange);
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', onOrientation);
    document.removeEventListener('focusin', onFocusChange);
    document.removeEventListener('focusout', onFocusChange);
    vv?.removeEventListener('resize', schedule);
    vv?.removeEventListener('scroll', schedule);
    viewportProbe.remove();
  };
}

function isKeyboardInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return target.isContentEditable;
  return !['button', 'checkbox', 'file', 'hidden', 'radio', 'range', 'submit'].includes(target.type);
}

function readSelectedProvider(): AgentProviderId {
  return safeReadLocalStorage('ccw_selected_provider') === 'codex' ? 'codex' : DEFAULT_AGENT_PROVIDER;
}
