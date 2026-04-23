import { useEffect, useRef, useState } from 'react';
import type { PermissionMode } from '../types';
import { MODE_ORDER } from '../types';
import { SlashPalette, type SlashAction } from './SlashPalette';
import { MentionPopup } from './MentionPopup';

type Props = {
  token: string;
  cwd: string;
  mode: PermissionMode;
  busy: boolean;
  ready: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onSlashAction: (a: SlashAction) => void;
  onCycleMode: (next: PermissionMode) => void;
};

export function InputBar(p: Props) {
  const [text, setText] = useState('');
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [text]);

  // Detect trailing @ or leading / in the current line to trigger popups.
  useEffect(() => {
    const before = text.slice(0, ref.current?.selectionStart ?? text.length);
    const line = before.split('\n').pop() ?? '';
    const mAt = line.match(/(?:^|\s)@(\S*)$/);
    if (mAt) setMentionQuery(mAt[1]); else setMentionQuery(null);

    const mSlash = text.startsWith('/') ? text.slice(1) : null;
    setSlashQuery(mSlash);
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || !p.ready) return;
    if (t.startsWith('/')) return; // slash is handled by palette Enter
    p.onSend(t);
    setText('');
  };

  const insertMention = (path: string) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const replaced = before.replace(/(^|\s)@\S*$/, (_, lead) => `${lead}@${path} `);
    const next = replaced + after;
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const newCaret = replaced.length;
      el.setSelectionRange(newCaret, newCaret);
    });
  };

  const pickSlash = (a: SlashAction) => {
    if (a.kind === 'literal') {
      setText(a.text);
    } else {
      p.onSlashAction(a);
      setText('');
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      const idx = MODE_ORDER.indexOf(p.mode);
      const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
      p.onCycleMode(next);
      return;
    }
    if (slashQuery !== null || mentionQuery !== null) {
      // Arrow/Enter/Esc consumed by palette via window listener
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-3 relative">
      <div className="max-w-3xl mx-auto flex items-end gap-2 relative">
        <div className="flex-1 relative">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={p.ready ? 'Ask Claude… Shift+Tab to cycle modes · @file · /command' : 'Connecting…'}
            rows={1}
            disabled={!p.ready}
            className="w-full resize-none bg-zinc-900 border border-zinc-800 focus:border-zinc-600 focus:outline-none rounded-lg px-3 py-2 text-sm placeholder:text-zinc-600 text-zinc-100"
          />
          {slashQuery !== null && (
            <SlashPalette
              query={slashQuery}
              onPick={pickSlash}
              onClose={() => setSlashQuery(null)}
            />
          )}
          {mentionQuery !== null && slashQuery === null && (
            <MentionPopup
              token={p.token}
              cwd={p.cwd}
              query={mentionQuery}
              onPick={insertMention}
              onClose={() => setMentionQuery(null)}
            />
          )}
        </div>
        {p.busy ? (
          <button onClick={p.onStop} className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-100">Stop</button>
        ) : (
          <button
            onClick={submit}
            disabled={!p.ready || !text.trim()}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-sm text-white"
          >Send</button>
        )}
      </div>
    </div>
  );
}
