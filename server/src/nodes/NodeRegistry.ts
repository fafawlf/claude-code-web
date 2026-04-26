import { homedir } from 'node:os';
import { DEFAULT_AGENT_PROVIDER, DEFAULT_NODE_ID, type AgentProviderId } from '../protocol.js';

export type NodeKind = 'local' | 'ssh';

export type NodeConfig = {
  id: string;
  label: string;
  kind: NodeKind;
  defaultCwd: string;
  providers: AgentProviderId[];
};

export type PublicNode = NodeConfig & {
  connected: boolean;
};

export class NodeRegistry {
  private nodes: NodeConfig[];

  constructor(defaultCwd: string, nodes: NodeConfig[] = defaultNodes(defaultCwd)) {
    this.nodes = nodes;
  }

  list(): PublicNode[] {
    return this.nodes.map((node) => ({ ...node, connected: node.kind === 'local' }));
  }

  get(id = DEFAULT_NODE_ID): NodeConfig | undefined {
    return this.nodes.find((node) => node.id === id);
  }
}

function defaultNodes(defaultCwd: string): NodeConfig[] {
  return [{
    id: DEFAULT_NODE_ID,
    label: 'This machine',
    kind: 'local',
    defaultCwd: defaultCwd || homedir(),
    providers: [DEFAULT_AGENT_PROVIDER],
  }];
}
