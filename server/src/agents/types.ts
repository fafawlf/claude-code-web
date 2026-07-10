import type { PermissionBroker } from '../permissions/PermissionBroker.js';
import type { PlanBroker } from '../permissions/PlanBroker.js';
import type { ClaudeSession, EventListener, StateListener, ControlListener, SessionEvent, PermissionListener, PlanListener } from '../session/ClaudeSession.js';
import type { AgentProviderId, ClaudeAuthMode, PendingControl, PermissionMode, SessionStateSnapshot } from '../protocol.js';
import type { GitIdentity } from '../git/identity.js';
import type { HistoryLoadMetadata } from '../session/ReplayBuffer.js';

export type AgentSession = Pick<
  ClaudeSession,
  | 'id'
  | 'historyReady'
  | 'permissionBroker'
  | 'planBroker'
  | 'sendUser'
  | 'setModel'
  | 'setClaudeAuthMode'
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
  getHistoryMetadata(): HistoryLoadMetadata;
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
  claudeAuthMode?: ClaudeAuthMode;
  permissionMode?: PermissionMode;
  viewerMode?: boolean;
  /** Confine transcript lookups for resume to projects under this root. */
  searchRoot?: string;
  /** Attribute git commits to this identity instead of the shared server owner. */
  gitIdentity?: GitIdentity;
  onPermission?: PermissionListener;
  onPlan?: PlanListener;
};

export interface AgentProvider {
  id: AgentProviderId;
  label: string;
  createSession(opts: AgentSessionOptions): AgentSession;
}
