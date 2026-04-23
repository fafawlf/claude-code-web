import { useEffect, useRef, useState } from 'react';
import type { PermissionMode } from '../types';
import { MODE_ORDER } from '../types';
import { SlashPalette, type SlashAction } from './SlashPalette';
import { MentionPopup } from './MentionPopup';
import { ModeDot } from './ModeStrip';
import { Icon } from './Icon';

type Props = {
  token: string;
  cwd: string;
  mode: PermissionMode;
  busy: boolean;
  ready: boolean;
  initialText?: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onSlashAction: (a: SlashAction) => void;
  onCycleMode: (next: PermissionMode) => void;
};

const PLACEHOLDERS = [
  'Ask Claude anything about this project…',
  'Explain how the auth flow works.',
  'Find every TODO and group them by file.',
  'Refactor this to use async/await.',
  'Why is the test on line 42 flaky?',
];

export function InputBar(p: Props) {
  const [text, setText] = useState(p.initialText ?? '');
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  // Sync from outside (e.g. when a prompt card is clicked)
  useEffect(() => { if (p.initialText !== undefined && p.initialText !== text) setText(p.initialText); }, [p.initialText]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(Math.max(el.scrollHeight, 24), 160) + 'px';
  }, [text]);

  useEffect(() => {
    const before = text.slice(0, ref.current?.selectionStart ?? text.length);
    const line = before.split('\n').pop() ?? '';
    const mAt = line.match(/(?:^|\s)@(\S*)$/);
    if (mAt) setMentionQuery(mAt[1]); else setMentionQuery(null);
    setSlashQuery(text.startsWith('/') ? text.slice(1) : null);
  }, [text]);

  useEffect(() => {
    if (text.length > 0 || focused) return;
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length), 5000);
    return () => clearInterval(t);
  }, [text, focused]);

  const submit = () => {
    const t = text.trim();
    if (!t || !p.ready) return;
    if (t.startsWith('/')) return;
    p.onSend(t);
    setText('');
  };

  const insertMention = (path: string) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const replaced = before.replace(/(^|\s)@\S*$/, (_m, lead) => `${lead}@${path} `);
    const next = replaced + after;
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const c = replaced.length;
      el.setSelectionRange(c, c);
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
    if (slashQuery !== null || mentionQuery !== null) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="absolute left-6 right-6 bottom-6 pointer-events-none flex justify-center">
      <div
        className={`pointer-events-auto w-full max-w-[720px] bg-bg-surface rounded-xl px-4 pt-3.5 pb-2.5 shadow-pop transition-[border-color,box-shadow] duration-hover ease-out border ${focused ? 'border-accent shadow-pop [box-shadow:var(--tw-shadow),0_0_0_4px_rgba(217,119,87,.12)]' : 'border-border'}`}
      >
        {p.mode !== 'default' && (
          <div className="flex items-center gap-2.5 h-5.5 mb-1">
            <ModeDot mode={p.mode} />
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={p.ready ? PLACEHOLDERS[placeholderIdx] : 'Connecting…'}
          rows={1}
          disabled={!p.ready}
          className="w-full resize-none bg-transparent outline-none text-base text-text-primary placeholder:text-text-muted leading-6 py-1"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 flex gap-2.5 items-center text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="kbd">⌘K</span></span>
            <span className="inline-flex items-center gap-1.5"><span className="kbd">@</span></span>
            <span className="inline-flex items-center gap-1.5"><span className="kbd">/</span></span>
            <span className="inline-flex items-center gap-1.5"><span className="kbd">⇧⇥</span> mode</span>
          </div>
          <SendButton busy={p.busy} active={hasText} onSend={submit} onStop={p.onStop} ready={p.ready} />
        </div>

        {slashQuery !== null && (
          <SlashPalette query={slashQuery} onPick={pickSlash} onClose={() => setSlashQuery(null)} />
        )}
        {mentionQuery !== null && slashQuery === null && (
          <MentionPopup token={p.token} cwd={p.cwd} query={mentionQuery} onPick={insertMention} onClose={() => setMentionQuery(null)} />
        )}
      </div>
    </div>
  );
}

function SendButton({ busy, active, ready, onSend, onStop }: { busy: boolean; active: boolean; ready: boolean; onSend: () => void; onStop: () => void }) {
  if (busy) {
    return (
      <button
        onClick={onStop}
        className="w-9 h-9 rounded-full grid place-items-center bg-bg-hover text-text-primary hover:text-text-primary active:scale-[.97] transition-all duration-hover"
        aria-label="Stop"
      >
        <Icon name="stop" size={14} />
      </button>
    );
  }
  const cls = active
    ? 'bg-accent text-text-inverse shadow-[0_0_0_1px_var(--accent-hi),0_6px_16px_-4px_rgba(217,119,87,.4)] hover:bg-accent-hi'
    : 'bg-bg-hover text-text-muted cursor-not-allowed';
  return (
    <button
      onClick={onSend}
      disabled={!active || !ready}
      className={`w-9 h-9 rounded-full grid place-items-center transition-all duration-hover active:scale-[.97] ${cls}`}
      aria-label="Send"
    >
      <Icon name="send" size={16} />
    </button>
  );
}
