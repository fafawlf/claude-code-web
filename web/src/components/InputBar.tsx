import { useEffect, useRef, useState } from 'react';

type Props = {
  busy: boolean;
  ready: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function InputBar({ busy, ready, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || !ready) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={ready ? 'Ask Claude Code to do something… (Enter to send, Shift+Enter for newline)' : 'Connecting…'}
          rows={1}
          disabled={!ready}
          className="flex-1 resize-none bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:outline-none rounded-lg px-3 py-2 text-sm placeholder:text-zinc-600 text-zinc-100"
        />
        {busy ? (
          <button
            onClick={onStop}
            className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-100"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!ready || !text.trim()}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-sm text-white"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
