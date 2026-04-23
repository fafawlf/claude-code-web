import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

type Props = {
  plan: string;
  onApprove: () => void;
  onReject: () => void;
};

export function PlanApprovalModal({ plan, onApprove, onReject }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onReject);

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(20,16,15,.65)] backdrop-blur-[6px] flex items-center justify-center p-4 animate-backdrop-in">
      <div ref={ref} className="w-full max-w-[640px] bg-bg-surface rounded-lg shadow-modal overflow-hidden animate-modal-in" role="dialog" aria-modal="true">
        <div className="px-6 pt-5 pb-3.5 border-b border-border-subtle">
          <div className="font-serif text-xl font-semibold text-text-primary tracking-tight">Plan ready</div>
          <div className="inline-flex items-center gap-1.5 text-[11px] text-warning bg-warning/10 px-2 py-0.5 rounded-full mt-1.5">
            <span className="w-[5px] h-[5px] rounded-full bg-warning" />
            Plan mode · read-only
          </div>
        </div>
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          <MarkdownLite text={plan} />
        </div>
        <div className="px-6 py-4 bg-bg-base/40 border-t border-border-subtle flex gap-2 justify-end">
          <button onClick={onReject} className="px-3.5 py-2 text-sm font-medium rounded-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-all duration-hover">
            Reject · stay in plan mode
          </button>
          <button onClick={onApprove} className="px-3.5 py-2 text-sm font-medium rounded-sm bg-accent text-text-inverse hover:bg-accent-hi transition-all duration-hover">
            Approve &amp; execute
          </button>
        </div>
      </div>
    </div>
  );
}

// Minimal markdown: paragraphs, headings, bullet/numbered lists, inline code.
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0 || !listKind) return;
    const Tag = listKind;
    out.push(
      <Tag key={`l${key++}`} className="pl-5 my-2 text-text-secondary list-outside">
        {listItems.map((li, i) => <li key={i} className="my-1"><Inline text={li} /></li>)}
      </Tag>
    );
    listItems = []; listKind = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const content = line.replace(/^#{1,6}\s*/, '');
      out.push(<h3 key={`h${key++}`} className="font-semibold text-sm text-accent-hi mt-4 mb-1.5"><Inline text={content} /></h3>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (listKind !== 'ul') flushList();
      listKind = 'ul';
      listItems.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (listKind !== 'ol') flushList();
      listKind = 'ol';
      listItems.push(line.replace(/^\s*\d+\.\s+/, ''));
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      out.push(<p key={`p${key++}`} className="text-sm text-text-primary leading-[1.65] my-1.5"><Inline text={line} /></p>);
    }
  }
  flushList();
  return <div className="pr-2">{out}</div>;
}

function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let i = 0, last = 0;
  const push = (el: React.ReactNode) => parts.push(el);
  while (i < text.length) {
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        if (i > last) push(text.slice(last, i));
        push(<code key={`c${i}`} className="font-mono text-xs bg-bg-base px-1.5 py-0.5 rounded text-accent-hi">{text.slice(i + 1, end)}</code>);
        i = end + 1; last = i; continue;
      }
    }
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2);
      if (end > i) {
        if (i > last) push(text.slice(last, i));
        push(<strong key={`b${i}`} className="text-text-primary font-semibold">{text.slice(i + 2, end)}</strong>);
        i = end + 2; last = i; continue;
      }
    }
    i++;
  }
  if (last < text.length) push(text.slice(last));
  return <>{parts}</>;
}
