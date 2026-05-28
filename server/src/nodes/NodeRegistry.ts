import { homedir } from 'node:os';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, type AgentProviderId } from '../protocol.js';
import { detectCodexExecutable } from '../agents/resolveCodexPath.js';

export type NodeKind = 'local' | 'ssh';

export type NodeConfig = {
  id: string;
  label: string;
  kind: NodeKind;
  defaultCwd: string;
  providers: AgentProviderId[];
  ssh?: {
    host: string;
    user?: string;
    port?: number;
  };
};

export type PublicNode = Omit<NodeConfig, 'ssh'> & {
  connected: boolean;
};

export class NodeRegistry {
  private nodes: NodeConfig[];

  constructor(defaultCwd: string, nodes: NodeConfig[] = defaultNodes(defaultCwd)) {
    this.nodes = nodes;
  }

  list(): PublicNode[] {
    return this.nodes.map(({ ssh: _ssh, ...node }) => ({ ...node, connected: node.kind === 'local' }));
  }

  get(id = DEFAULT_NODE_ID): NodeConfig | undefined {
    return this.nodes.find((node) => node.id === id);
  }
}

function defaultNodes(defaultCwd: string): NodeConfig[] {
  const providers: AgentProviderId[] = [DEFAULT_AGENT_PROVIDER];
  if (detectCodexExecutable().source !== 'missing') providers.push('codex');
  return [{
    id: DEFAULT_NODE_ID,
    label: process.env.CCW_NODE_LABEL?.trim() || 'This machine',
    kind: 'local',
    defaultCwd: defaultCwd || homedir(),
    providers,
  }, ...parseExtraNodes(process.env.CCW_NODES_JSON)];
}

export function parseExtraNodes(raw: string | undefined): NodeConfig[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { nodes?: unknown }).nodes)
      ? (parsed as { nodes: unknown[] }).nodes
      : [];

  const out: NodeConfig[] = [];
  const seen = new Set([DEFAULT_NODE_ID]);
  for (const value of values) {
    const node = parseNode(value);
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

function parseNode(value: unknown): NodeConfig | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === 'string' && /^[a-zA-Z0-9_.-]+$/.test(v.id) ? v.id : '';
  if (!id) return null;
  const kind: NodeKind = v.kind === 'ssh' ? 'ssh' : 'local';
  const providers = parseProviders(v.providers);
  const defaultCwd = typeof v.defaultCwd === 'string' && v.defaultCwd.trim() ? v.defaultCwd : homedir();
  const label = typeof v.label === 'string' && v.label.trim() ? v.label : id;
  const ssh = parseSsh(v.ssh);
  return {
    id,
    label,
    kind,
    defaultCwd,
    providers,
    ...(ssh ? { ssh } : {}),
  };
}

function parseProviders(value: unknown): AgentProviderId[] {
  if (!Array.isArray(value)) return [DEFAULT_AGENT_PROVIDER];
  const providers = value.filter((p): p is AgentProviderId => p === 'claude' || p === 'codex');
  return providers.length ? [...new Set(providers)] : [DEFAULT_AGENT_PROVIDER];
}

function parseSsh(value: unknown): NodeConfig['ssh'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.host !== 'string' || !v.host.trim()) return undefined;
  return {
    host: v.host,
    ...(typeof v.user === 'string' && v.user.trim() ? { user: v.user } : {}),
    ...(typeof v.port === 'number' && Number.isInteger(v.port) ? { port: v.port } : {}),
  };
}
