import { Icon, type IconName } from './Icon';

type Prompt = { icon: IconName; body: React.ReactNode };

type Props = {
  cwd: string;
  onUsePrompt: (text: string) => void;
};

const PROMPTS: Array<Prompt & { text: string }> = [
  {
    icon: 'sparkles',
    text: 'Give me a tour of this codebase — what are the major modules and how do they fit together?',
    body: 'Give me a tour of this codebase — what are the major modules?',
  },
  {
    icon: 'list',
    text: 'Find all TODO comments in the repo and group them by file.',
    body: 'Find all TODOs and group them by file.',
  },
  {
    icon: 'zap',
    text: 'Suggest three low-risk refactors I could ship this week. Show me before/after for each.',
    body: 'Suggest three low-risk refactors for this week.',
  },
];

export function EmptyState({ cwd, onUsePrompt }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-48">
      <h1 className="font-serif text-[34px] leading-[1.2] font-semibold tracking-tight text-text-primary mb-2">
        Ready when you are.
      </h1>
      <p className="text-text-secondary mb-9">
        Ask anything. I have access to <code className="font-mono text-sm text-accent-hi">{compact(cwd)}</code>
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 w-full max-w-[680px] mb-6">
        {PROMPTS.map((p) => (
          <button
            key={p.text}
            onClick={() => onUsePrompt(p.text)}
            className="p-3.5 text-left rounded-md bg-bg-raised border border-border-subtle text-sm text-text-primary leading-snug transition-all duration-hover ease-out hover:bg-bg-hover hover:border-border hover:-translate-y-px"
          >
            <Icon name={p.icon} size={16} className="text-accent opacity-80 mb-2" />
            <div>{p.body}</div>
          </button>
        ))}
      </div>
      <div className="flex gap-4 flex-wrap justify-center text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="kbd">⌘K</span> command palette</span>
        <span className="inline-flex items-center gap-1.5"><span className="kbd">⇧⇥</span> cycle mode</span>
        <span className="inline-flex items-center gap-1.5"><span className="kbd">@</span> attach file</span>
        <span className="inline-flex items-center gap-1.5"><span className="kbd">/</span> slash command</span>
      </div>
    </div>
  );
}

function compact(p: string): string {
  const home = '/root';
  let s = p;
  if (s.startsWith(home)) s = '~' + s.slice(home.length);
  const parts = s.split('/').filter(Boolean);
  if (parts.length <= 4) return s;
  return (s.startsWith('~') ? '~/' : '/') + '…/' + parts.slice(-3).join('/');
}
