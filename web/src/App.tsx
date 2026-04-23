import { useEffect, useMemo, useRef, useState } from 'react';
import { WsClient } from './ws';
import { applyEvent, initialState, type ChatState } from './reducer';
import type { ChatItem, ServerMessage, ServerPermissionRequest } from './types';
import { Sidebar, type StoredSession } from './components/Sidebar';
import { MessageList } from './components/MessageList';
import { PermissionModal } from './components/PermissionModal';
import { InputBar } from './components/InputBar';

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
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [state, setState] = useState<ChatState>(initialState);
  const [pending, setPending] = useState<ChatItem[]>([]); // locally-added items (e.g. user messages) awaiting server echo
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permissionReq, setPermissionReq] = useState<ServerPermissionRequest | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [cwd, setCwd] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WsClient | null>(null);

  // Auth probe
  useEffect(() => {
    if (!token) { setAuthed(false); return; }
    fetch(`/auth-check?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => setAuthed(!!j.ok))
      .catch(() => setAuthed(false));
  }, [token]);

  // Load sessions + cwd
  useEffect(() => {
    if (!authed || !token) return;
    fetch(`/api/info?t=${encodeURIComponent(token)}`).then((r) => r.json()).then((j) => setCwd(j.cwd ?? ''));
    refreshSessions();
  }, [authed, token]);

  const refreshSessions = () => {
    if (!token) return;
    fetch(`/api/sessions?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => setSessions(j.sessions ?? []))
      .catch(() => {});
  };

  // Open WS on auth
  useEffect(() => {
    if (!authed || !token) return;
    const onMessage = (m: ServerMessage) => {
      if (m.type === 'ready') {
        setSessionId(m.sessionId);
        setConnected(true);
      } else if (m.type === 'sdk_event') {
        setState((s) => applyEvent(s, m.event, m.id));
      } else if (m.type === 'permission_request') {
        setPermissionReq(m);
      } else if (m.type === 'error') {
        setState((s) => ({ ...s, items: [...s.items, { kind: 'system', id: Math.random().toString(36).slice(2), text: m.message, level: 'error' }] }));
      }
    };
    const client = new WsClient(token, onMessage);
    wsRef.current = client;
    client.connect();
    client.onOpen(() => {
      client.send({ type: 'hello' });
    });
    return () => { client.close(); };
  }, [authed, token]);

  const startNewSession = (resumeClaudeId?: string) => {
    setState(initialState);
    setPending([]);
    setSessionId(null);
    setPermissionReq(null);
    const client = wsRef.current;
    if (!client) return;
    client.send({ type: 'hello', resumeClaudeId });
  };

  const sendUser = (text: string) => {
    if (!text.trim() || !sessionId) return;
    setPending((p) => [...p, { kind: 'user', id: Math.random().toString(36).slice(2), text }]);
    wsRef.current?.send({ type: 'user', text });
  };

  const sendInterrupt = () => wsRef.current?.send({ type: 'interrupt' });

  const respondPermission = (decision: 'allow' | 'deny', scope?: 'once' | 'session') => {
    if (!permissionReq) return;
    wsRef.current?.send({ type: 'permission_response', reqId: permissionReq.reqId, decision, scope });
    setPermissionReq(null);
  };

  const items = useMemo(() => [...pending, ...state.items], [pending, state.items]);

  if (authed === null) return <Centered>checking auth…</Centered>;
  if (authed === false) return <Centered><div className="text-center space-y-2"><div className="text-red-400">Missing or invalid token.</div><div className="text-zinc-500 text-sm">Open the URL the server printed on launch (includes <code>?t=…</code>).</div></div></Centered>;

  return (
    <div className="flex h-full">
      <Sidebar
        cwd={cwd}
        sessions={sessions}
        activeId={sessionId}
        onNew={() => startNewSession()}
        onResume={(claudeId) => startNewSession(claudeId)}
        onRefresh={refreshSessions}
        connected={connected}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <MessageList items={items} busy={state.busy} />
        <InputBar busy={state.busy} onSend={sendUser} onStop={sendInterrupt} ready={connected} />
      </main>
      {permissionReq && (
        <PermissionModal
          req={permissionReq}
          onAllow={(scope) => respondPermission('allow', scope)}
          onDeny={() => respondPermission('deny')}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="h-full flex items-center justify-center text-zinc-400">{children}</div>;
}
