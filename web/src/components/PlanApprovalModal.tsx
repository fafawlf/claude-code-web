import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { MarkdownMessage } from './MarkdownMessage';

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
          <MarkdownMessage text={plan} compact />
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
