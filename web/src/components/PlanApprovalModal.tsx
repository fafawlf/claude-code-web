type Props = {
  plan: string;
  onApprove: () => void;
  onReject: () => void;
};

export function PlanApprovalModal({ plan, onApprove, onReject }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-zinc-900 border border-amber-900/50 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 bg-amber-500/5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Plan ready for approval</div>
          <div className="text-base text-zinc-100 mt-1">Review Claude's plan. Approving will switch back to default mode and execute.</div>
        </div>
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          <pre className="whitespace-pre-wrap text-sm text-zinc-200 font-mono leading-relaxed">{plan}</pre>
        </div>
        <div className="px-5 py-4 bg-zinc-950/50 border-t border-zinc-800 flex gap-2 justify-end">
          <button onClick={onReject} className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Reject — stay in plan mode</button>
          <button onClick={onApprove} className="px-3 py-1.5 rounded text-sm bg-emerald-600 hover:bg-emerald-500 text-white">Approve — execute</button>
        </div>
      </div>
    </div>
  );
}
