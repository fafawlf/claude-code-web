import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentProviderId, PermissionMode } from '../types';
import { MODE_ORDER, modeHint, modeLabel } from '../types';
import { SlashPalette, type SlashAction } from './SlashPalette';
import { MentionPopup } from './MentionPopup';
import { Icon } from './Icon';
import { navigatePromptHistory, recordPrompt, shouldHandlePromptHistoryKey } from '../promptHistory';
import {
  buildAttachmentPrompt,
  formatFileSize,
  MAX_UPLOAD_FILES,
  planUploadSelection,
  uploadFileMultipart,
  UploadPool,
  type UploadHandle,
  type UploadedFileRef,
} from '../uploads';
import { clearPromptDraft, readPromptDraft, writePromptDraft } from '../promptDraft';
import { ComposerScopeStore, composerDraftStorageKey, composerScopeKey } from '../composerScope';

type Props = {
  token: string;
  cwd: string;
  /** Stable display-session identity. Omit to retain legacy cwd-only composer state. */
  sessionKey?: string;
  mode: PermissionMode;
  provider?: AgentProviderId;
  busy: boolean;
  ready: boolean;
  readOnly?: boolean;
  initialText?: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onSlashAction: (a: SlashAction) => void;
  onCycleMode: (next: PermissionMode) => void;
  onSetMode: (next: PermissionMode) => void;
};

const PLACEHOLDERS = [
  'Ask Claude anything about this project…',
];

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type Attachment = {
  id: string;
  name: string;
  size: number;
  mime?: string;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  uploaded?: UploadedFileRef;
  previewUrl?: string;
  file?: File;
  progress?: number;
  retryable?: boolean;
  countsTowardTotal?: boolean;
};

function InputBarImpl(p: Props) {
  const scopeKey = composerScopeKey(p.cwd, p.sessionKey);
  const draftStorageKey = composerDraftStorageKey(p.cwd, p.sessionKey);
  const [text, setText] = useState(() => p.initialText ?? safeReadScopedPromptDraft(p.cwd, draftStorageKey, !!p.sessionKey));
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef<Set<string>>(new Set());
  const currentScopeRef = useRef(scopeKey);
  const currentDraftStorageRef = useRef(draftStorageKey);
  const scopeStoreRef = useRef(new ComposerScopeStore<Attachment>());
  const uploadPoolRef = useRef(new UploadPool(2));
  const uploadHandlesRef = useRef(new Map<string, { scopeKey: string; handle: UploadHandle<UploadedFileRef> }>());
  const skipDraftWriteRef = useRef(false);

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => () => {
    currentScopeRef.current = '__unmounted__';
    uploadPoolRef.current.cancelAll();
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, []);

  // Sync from outside (e.g. when a prompt card is clicked)
  useEffect(() => { if (p.initialText !== undefined && p.initialText !== text) setText(p.initialText); }, [p.initialText]);

  useEffect(() => {
    if (currentScopeRef.current === scopeKey) return;
    const previousScope = currentScopeRef.current;
    const canceledAttachments = attachments.map((attachment) => attachment.status === 'uploading'
      ? { ...attachment, status: 'error' as const, progress: undefined, retryable: true, error: 'Upload canceled after switching chats. Retry to upload here.' }
      : attachment);
    safeWritePromptDraft(currentDraftStorageRef.current, text);
    uploadPoolRef.current.cancelScope(previousScope);
    scopeStoreRef.current.save(previousScope, {
      text,
      history,
      historyCursor,
      historyDraft,
      attachments: canceledAttachments,
    });
    currentScopeRef.current = scopeKey;
    currentDraftStorageRef.current = draftStorageKey;
    const next = scopeStoreRef.current.read(scopeKey);
    skipDraftWriteRef.current = true;
    setText(p.initialText ?? next?.text ?? safeReadScopedPromptDraft(p.cwd, draftStorageKey, !!p.sessionKey));
    setHistory(next?.history ?? []);
    setHistoryCursor(next?.historyCursor ?? null);
    setHistoryDraft(next?.historyDraft ?? '');
    setAttachments(next?.attachments ?? []);
    setSlashQuery(null);
    setMentionQuery(null);
    setSendHint(null);
  }, [scopeKey]);

  useEffect(() => {
    if (skipDraftWriteRef.current) {
      skipDraftWriteRef.current = false;
      return;
    }
    safeWritePromptDraft(draftStorageKey, text);
  }, [draftStorageKey, text]);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, 24), 160);
    const nextHeight = `${next}px`;
    if (el.style.height !== nextHeight) el.style.height = nextHeight;
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

  const submit = (allowSlashText = false) => {
    const t = text.trim();
    const readyFiles = attachments.flatMap((a) => (a.status === 'ready' && a.uploaded ? [a.uploaded] : []));
    const uploading = attachments.some((a) => a.status === 'uploading');
    if (!t && readyFiles.length === 0) return;
    if (uploading) { setSendHint('Files are still uploading.'); return; }
    if (!p.ready) { setSendHint(p.readOnly ? 'Press Continue writing to take over this chat.' : 'Still connecting. Try again in a moment.'); return; }
    if (t.startsWith('/') && readyFiles.length === 0 && !allowSlashText) { setSendHint('Pick a slash command, or press Enter in the empty command list to send as text.'); return; }
    const prompt = buildAttachmentPrompt(t, readyFiles);
    setHistory((prev) => recordPrompt(prev, prompt));
    setHistoryCursor(null);
    setHistoryDraft('');
    p.onSend(prompt);
    setText('');
    safeClearPromptDraft(draftStorageKey);
    clearAttachments();
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
    const popupOpen = slashQuery !== null || mentionQuery !== null;
    if (popupOpen) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape' && text.length > 0) {
      e.preventDefault();
      setText('');
      safeClearPromptDraft(draftStorageKey);
      setHistoryCursor(null);
      setHistoryDraft('');
      return;
    }
    const direction = shouldHandlePromptHistoryKey({
      key: e.key,
      text,
      selectionStart: e.currentTarget.selectionStart ?? text.length,
      selectionEnd: e.currentTarget.selectionEnd ?? text.length,
      popupOpen,
    });
    if (direction) {
      const next = navigatePromptHistory({ items: history, cursor: historyCursor, draft: historyDraft, value: text }, direction);
      if (next) {
        e.preventDefault();
        setText(next.value);
        setHistoryCursor(next.cursor);
        setHistoryDraft(next.draft);
        requestAnimationFrame(() => {
          const el = ref.current;
          if (!el) return;
          const pos = next.value.length;
          el.setSelectionRange(pos, pos);
        });
      }
    }
  };

  const updateAttachmentsForScope = (targetScope: string, update: (items: Attachment[]) => Attachment[]) => {
    if (currentScopeRef.current === targetScope) {
      setAttachments(update);
      return;
    }
    scopeStoreRef.current.updateAttachments(targetScope, update);
  };

  const startUpload = (attachment: Attachment, targetScope: string, targetCwd: string) => {
    const file = attachment.file;
    if (!file) return;
    updateAttachmentsForScope(targetScope, (items) => items.map((item) => item.id === attachment.id
      ? { ...item, status: 'uploading', error: undefined, retryable: false, progress: 0 }
      : item));
    const handle = uploadPoolRef.current.enqueue(targetScope, (signal) => uploadFileMultipart(file, targetCwd, {
      token: p.token,
      signal,
      onProgress: (progress) => updateAttachmentsForScope(targetScope, (items) => items.map((item) => item.id === attachment.id
        ? { ...item, progress }
        : item)),
    }));
    uploadHandlesRef.current.set(attachment.id, { scopeKey: targetScope, handle });
    void handle.promise
      .then((uploaded) => updateAttachmentsForScope(targetScope, (items) => items.map((item) => item.id === attachment.id
        ? {
            ...item,
            status: 'ready',
            progress: undefined,
            uploaded,
            name: uploaded.name,
            size: uploaded.size,
            mime: uploaded.mime ?? item.mime,
          }
        : item)))
      .catch((error: Error) => {
        const switched = error.name === 'AbortError' && currentScopeRef.current !== targetScope;
        updateAttachmentsForScope(targetScope, (items) => items.map((item) => item.id === attachment.id
          ? {
              ...item,
              status: 'error',
              progress: undefined,
              retryable: true,
              error: switched
                ? 'Upload canceled after switching chats. Retry to upload here.'
                : error.name === 'AbortError' ? 'Upload canceled.' : String(error.message || error),
            }
          : item));
      })
      .finally(() => {
        if (uploadHandlesRef.current.get(attachment.id)?.handle === handle) {
          uploadHandlesRef.current.delete(attachment.id);
        }
      });
  };

  const uploadFiles = (filesLike: FileList | File[]) => {
    const files = Array.from(filesLike);
    if (!files.length || p.readOnly) return;
    const planned = planUploadSelection({
      fileCount: attachments.length,
      totalBytes: attachments.reduce((sum, attachment) => sum + (attachment.countsTowardTotal ? attachment.size : 0), 0),
    }, files);
    const remainingSlots = Math.max(0, MAX_UPLOAD_FILES - attachments.length);
    const displayedFiles = files.slice(0, remainingSlots);
    const accepted = new Set(planned.accepted.map((entry) => entry.file));
    const next: Attachment[] = displayedFiles.map((file) => {
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previewUrlsRef.current.add(previewUrl);
      const rejection = planned.rejected.find((entry) => entry.file === file);
      const canUpload = accepted.has(file);
      return {
        id: makeId(),
        name: file.name || 'upload',
        size: file.size,
        mime: file.type,
        file,
        status: canUpload ? 'uploading' : 'error',
        error: rejection?.error,
        progress: canUpload ? 0 : undefined,
        retryable: false,
        countsTowardTotal: canUpload,
        previewUrl,
      };
    });
    setAttachments((prev) => [...prev, ...next]);
    if (planned.rejected.length > 0) setSendHint(planned.rejected[0].error);
    for (const attachment of next) {
      if (attachment.status === 'uploading') startUpload(attachment, scopeKey, p.cwd);
    }
  };

  const removeAttachment = (id: string) => {
    uploadHandlesRef.current.get(id)?.handle.cancel();
    uploadHandlesRef.current.delete(id);
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const retryAttachment = (attachment: Attachment) => {
    if (!attachment.file || !attachment.retryable) return;
    startUpload(attachment, scopeKey, p.cwd);
  };

  const clearAttachments = () => {
    uploadPoolRef.current.cancelScope(scopeKey);
    for (const a of attachments) {
      if (a.previewUrl) {
        URL.revokeObjectURL(a.previewUrl);
        previewUrlsRef.current.delete(a.previewUrl);
      }
    }
    setAttachments([]);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length) {
      e.preventDefault();
      void uploadFiles(files);
    }
  };

  const uploading = attachments.some((a) => a.status === 'uploading');
  const readyAttachmentCount = attachments.filter((a) => a.status === 'ready').length;
  const hasText = text.trim().length > 0 || readyAttachmentCount > 0;

  return (
    <div className="composer-wrap absolute left-6 right-6 bottom-6 pointer-events-none flex justify-center">
      <div
        onDragEnter={(e) => { e.preventDefault(); if (!p.readOnly) setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); if (!p.readOnly) setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!p.readOnly) void uploadFiles(e.dataTransfer.files);
        }}
        className={`composer-shell pointer-events-auto w-full max-w-[720px] bg-bg-surface rounded-xl px-4 pt-3.5 pb-2.5 shadow-pop transition-[border-color,box-shadow] duration-hover ease-out border ${dragging ? 'border-accent [box-shadow:var(--tw-shadow),0_0_0_4px_rgba(217,119,87,.16)]' : focused ? 'border-accent shadow-pop [box-shadow:var(--tw-shadow),0_0_0_4px_rgba(217,119,87,.12)]' : 'border-border'}`}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
            {attachments.map((a) => (
              <AttachmentChip
                key={a.id}
                attachment={a}
                onRetry={a.retryable ? () => retryAttachment(a) : undefined}
                onRemove={() => removeAttachment(a.id)}
              />
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); setHistoryCursor(null); setHistoryDraft(''); }}
          onKeyDown={onKey}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={p.readOnly ? 'Read-only — press Continue writing to take over' : p.ready ? PLACEHOLDERS[placeholderIdx] : 'Connecting…'}
          rows={1}
          disabled={!p.ready || p.readOnly}
          className="w-full resize-none bg-transparent outline-none text-base text-text-primary placeholder:text-text-muted leading-6 py-1"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex-1 flex gap-2 items-center text-[11px] text-text-muted min-w-0">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.currentTarget.files) void uploadFiles(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              disabled={!p.ready || !!p.readOnly}
              onClick={() => fileRef.current?.click()}
              className={`composer-tool-button inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-subtle bg-bg-base px-2.5 text-[11px] font-medium text-text-secondary transition-colors duration-hover hover:bg-bg-hover hover:text-text-primary ${(!p.ready || p.readOnly) ? 'cursor-not-allowed opacity-50' : ''}`}
              aria-label="Upload file or image"
              title="Upload file or image"
            >
              <Icon name="paperclip" size={12} />
              <span className="composer-tool-label">Attach</span>
            </button>
            <PlanToggle mode={p.mode} disabled={!p.ready || !!p.readOnly} onSetMode={p.onSetMode} />
            <PermissionMenu mode={p.mode} disabled={!p.ready || !!p.readOnly} onSetMode={p.onSetMode} />
            <span className="composer-divider h-4 w-px bg-border-subtle" />
            <span className="composer-shortcut inline-flex items-center gap-1.5"><span className="kbd">⌘K</span></span>
            <span className="composer-shortcut inline-flex items-center gap-1.5"><span className="kbd">@</span></span>
            <span className="composer-shortcut inline-flex items-center gap-1.5"><span className="kbd">/</span></span>
            <span className="composer-shortcut inline-flex items-center gap-1.5"><span className="kbd">⇧⇥</span> mode</span>
          </div>
          <SendButton busy={p.busy} active={hasText} uploading={uploading} onSend={submit} onStop={p.onStop} ready={p.ready} />
        </div>

        {slashQuery !== null && (
          <SlashPalette
            query={slashQuery}
            provider={p.provider}
            onPick={pickSlash}
            onClose={() => setSlashQuery(null)}
            onEmptySubmit={() => {
              setSlashQuery(null);
              queueMicrotask(() => submit(true));
            }}
          />
        )}
        {mentionQuery !== null && slashQuery === null && (
          <MentionPopup
            token={p.token}
            cwd={p.cwd}
            query={mentionQuery}
            onPick={insertMention}
            onClose={() => setMentionQuery(null)}
            onEmptySubmit={() => {
              setMentionQuery(null);
              queueMicrotask(submit);
            }}
          />
        )}
      </div>
    </div>
  );
}

export const InputBar = memo(InputBarImpl);

function PlanToggle({ mode, disabled, onSetMode }: { mode: PermissionMode; disabled: boolean; onSetMode: (next: PermissionMode) => void }) {
  const active = mode === 'plan';
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label="Toggle plan mode"
      title={active ? 'Plan mode on: Claude will propose a plan first' : 'Turn on plan mode for the next request'}
      onClick={() => onSetMode(active ? 'default' : 'plan')}
      className={`composer-plan-toggle ${active ? 'is-active' : ''} inline-flex h-7 shrink-0 items-center gap-2 rounded-md border px-2.5 text-[11px] font-medium transition-all duration-hover ${active
        ? 'border-warning/35 bg-warning/10 text-warning shadow-[0_0_0_3px_rgba(212,169,94,.08)]'
        : 'border-border-subtle bg-bg-base text-text-secondary hover:text-text-primary hover:bg-bg-hover'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className={`relative h-3.5 w-6 rounded-full transition-colors duration-hover ${active ? 'bg-warning/70' : 'bg-bg-hover'}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-transform duration-hover ${active ? 'translate-x-3 bg-bg-base' : 'translate-x-0.5 bg-text-muted'}`} />
      </span>
      Plan mode
    </button>
  );
}

const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions'];

function PermissionMenu({ mode, disabled, onSetMode }: { mode: PermissionMode; disabled: boolean; onSetMode: (next: PermissionMode) => void }) {
  const [open, setOpen] = useState(false);
  const activePermission = mode === 'plan' ? 'default' : mode;
  const dangerous = mode === 'bypassPermissions';
  const label = mode === 'acceptEdits' ? 'Auto edits' : mode === 'bypassPermissions' ? 'Bypass' : 'Permissions';
  const icon = mode === 'acceptEdits' ? 'zap' : 'shield';
  const cls = dangerous
    ? 'border-danger/35 bg-danger/10 text-danger'
    : mode === 'acceptEdits'
      ? 'border-success/30 bg-success/10 text-success'
      : 'border-border-subtle bg-bg-base text-text-secondary hover:text-text-primary hover:bg-bg-hover';

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Permission mode: ${modeLabel(activePermission)}`}
        title={modeHint(activePermission)}
        className={`composer-permission-button inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-all duration-hover ${cls} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Icon name={icon} size={12} />
        <span>{label}</span>
        <Icon name="chev-down" size={11} className="opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="composer-permission-popover absolute left-0 bottom-9 z-40 w-72 overflow-hidden rounded-md border border-border bg-bg-surface shadow-pop animate-modal-in origin-bottom-left">
            {PERMISSION_MODES.map((m) => {
              const active = activePermission === m;
              const isDanger = m === 'bypassPermissions';
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { onSetMode(m); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors duration-hover ${active ? 'bg-bg-hover' : 'hover:bg-bg-hover'} ${isDanger ? 'border-t border-border-subtle' : ''}`}
                >
                  <Icon
                    name={m === 'acceptEdits' ? 'zap' : 'shield'}
                    size={14}
                    className={`mt-0.5 shrink-0 ${isDanger ? 'text-danger' : active ? 'text-accent' : 'text-text-muted'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${isDanger ? 'text-danger' : 'text-text-primary'}`}>
                      {m === 'default' ? 'Ask before tools' : m === 'acceptEdits' ? 'Auto-accept edits' : 'Bypass permissions'}
                    </span>
                    <span className="block text-[10px] text-text-muted mt-0.5">{modeHint(m)}</span>
                  </span>
                  {active && <Icon name="check" size={12} className="text-accent mt-1 shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function AttachmentChip({ attachment, onRetry, onRemove }: { attachment: Attachment; onRetry?: () => void; onRemove: () => void }) {
  const statusText = attachment.status === 'uploading'
    ? `Uploading ${attachment.progress ?? 0}%`
    : attachment.status === 'error'
      ? attachment.error ?? 'Upload failed'
      : attachment.uploaded?.relativePath ?? 'Ready';
  const tone = attachment.status === 'error'
    ? 'border-danger/30 bg-danger/10 text-danger'
    : attachment.status === 'ready'
      ? 'border-success/25 bg-success/10 text-text-primary'
      : 'border-border-subtle bg-bg-base text-text-secondary';
  return (
    <div className={`group inline-flex min-w-0 max-w-[260px] items-center gap-2 rounded-md border px-2 py-1.5 ${tone}`} title={statusText}>
      {attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt="" className="h-8 w-8 shrink-0 rounded-sm object-cover" />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-bg-raised text-text-muted">
          <Icon name="file" size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{attachment.name}</span>
        <span className="block truncate text-[10px] text-text-muted">
          {attachment.status === 'ready' ? formatFileSize(attachment.size) : statusText}
        </span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-sm px-1.5 py-1 text-[10px] font-medium text-danger transition-colors duration-hover hover:bg-danger/10"
          aria-label={`Retry ${attachment.name}`}
          title="Retry upload"
        >
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-text-muted opacity-70 transition-colors duration-hover hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100"
        aria-label={`Remove ${attachment.name}`}
        title={attachment.status === 'uploading' ? 'Cancel upload' : 'Remove'}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

function SendButton({ busy, active, uploading, ready, onSend, onStop }: { busy: boolean; active: boolean; uploading: boolean; ready: boolean; onSend: () => void; onStop: () => void }) {
  if (busy) {
    return (
      <button
        onClick={onStop}
        className="composer-send-button w-9 h-9 rounded-full grid place-items-center bg-bg-hover text-text-primary hover:text-text-primary active:scale-[.97] transition-all duration-hover"
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
      disabled={!active || !ready || uploading}
      className={`composer-send-button w-9 h-9 rounded-full grid place-items-center transition-all duration-hover active:scale-[.97] ${cls}`}
      aria-label={uploading ? 'Uploading attachments' : 'Send'}
      title={uploading ? 'Uploading attachments' : 'Send'}
    >
      <Icon name="send" size={16} />
    </button>
  );
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeReadPromptDraft(cwd: string): string {
  try { return readPromptDraft(cwd); } catch { return ''; }
}

function safeReadScopedPromptDraft(cwd: string, draftStorageKey: string, scoped: boolean): string {
  const value = safeReadPromptDraft(draftStorageKey);
  if (value || !scoped || draftStorageKey === cwd) return value;
  const legacy = safeReadPromptDraft(cwd);
  if (!legacy) return '';
  safeWritePromptDraft(draftStorageKey, legacy);
  safeClearPromptDraft(cwd);
  return legacy;
}

function safeWritePromptDraft(cwd: string, value: string): void {
  try { writePromptDraft(cwd, value); } catch { /* storage can be unavailable */ }
}

function safeClearPromptDraft(cwd: string): void {
  try { clearPromptDraft(cwd); } catch { /* storage can be unavailable */ }
}
