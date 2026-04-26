import type { PermissionBroker } from '../permissions/PermissionBroker.js';
import type { PlanBroker } from '../permissions/PlanBroker.js';
import type { ClaudeSession, EventListener, StateListener, ControlListener, SessionEvent, PermissionListener, PlanListener } from '../session/ClaudeSession.js';
import type { AgentProviderId, PendingControl, PermissionMode, SessionStateSnapshot } from '../protocol.js';

export type AgentSession = Pick<
  ClaudeSession,
  | 'id'
  | 'historyReady'
  | 'permissionBroker'
  | 'planBroker'
  | 'sendUser'
  | 'setModel'
  | 'setPermissionMode'
  | 'interrupt'
  | 'refreshHistory'
  | 'isViewer'
  | 'isClosed'
  | 'close'
> & {
  permissionBroker: PermissionBroker;
  planBroker: PlanBroker;
  getState(): SessionStateSnapshot;
  replay(afterId?: number): SessionEvent[];
  subscribe(listener: EventListener): () => void;
  subscribeState(listener: StateListener): () => void;
  subscribeControls(listener: ControlListener): () => void;
  getPendingControls(): PendingControl[];
};

export type AgentSessionOptions = {
  id: string;
  nodeId?: string;
  nodeLabel?: string;
  cwd: string;
  resume?: string;
  model?: string;
  permissionMode?: PermissionMode;
  viewerMode?: boolean;
  onPermission?: PermissionListener;
  onPlan?: PlanListener;
};

export interface AgentProvider {
  id: AgentProviderId;
  label: string;
  createSession(opts: AgentSessionOptions): AgentSession;
}
