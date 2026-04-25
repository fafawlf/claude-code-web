import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActiveToolInfo, ChatItem } from '../types';
import type { SkinId } from '../skins';
import { ToolUse } from './ToolUse';
import { DiffBlock } from './DiffBlock';
import { MarkdownMessage } from './MarkdownMessage';
import { splitStableMarkdown, useSmoothStreamText } from '../streaming';
import { isEditLikeTool, shouldHideToolInTranscript } from '../toolDisplay';
import { cleanStreamingAssistantText } from '../assistantText';
import { contentForSkin, statusCopyForSkin } from '../skinContent';
import { assetUrl } from '../appUrl';
const STICK_THRESHOLD = 80; // px from bottom still counts as "at bottom"
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type Props = {
  token: string;
  cwd: string;
  skin: SkinId;
  items: ChatItem[];
  busy: boolean;
  streamingText: string;
  pendingByToolUseId: Map<string, string>;
  secondsSinceLastEvent: number;
  activeTool?: ActiveToolInfo;
  onAcceptEdit: (reqId: string) => void;
  onRejectEdit: (reqId: string) => void;
  onStop: () => void;
};

function MessageListImpl({ token, cwd, skin, items, busy, streamingText, pendingByToolUseId, secondsSinceLastEvent, activeTool, onAcceptEdit, onRejectEdit, onStop }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const content = contentForSkin(skin);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Detect whether the user has scrolled up to read earlier messages. We only
  // auto-scroll when they're already at (or near) the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const sticky = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
      stickToBottomRef.current = sticky;
      setShowJump(!sticky);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll on new message (items count change) only. Not on stream deltas.
  // Use layout effect + instant behavior — "smooth" looks laggy when 900
  // replayed items arrive in a single batch.
  useIsoLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [items.length]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollerRef} className="message-scroller h-full overflow-y-auto">
      <div ref={contentRef} className="message-list-content min-h-full max-w-[720px] mx-auto px-6 pt-8 pb-44 flex flex-col justify-end gap-[18px]">
        {items.filter((it) => !shouldHideToolInTranscript(it)).map((it) => (
          <Bubble
            key={it.id}
            item={it}
            token={token}
            cwd={cwd}
            skin={skin}
            pendingByToolUseId={pendingByToolUseId}
            onAcceptEdit={onAcceptEdit}
            onRejectEdit={onRejectEdit}
          />
        ))}
        {streamingText && busy && (
          <StreamingMessage text={streamingText} token={token} cwd={cwd} skin={skin} />
        )}
        {busy && !streamingText && <ThinkingState skin={skin} secondsSinceLastEvent={secondsSinceLastEvent} activeTool={activeTool} onStop={onStop} />}
        <div ref={endRef} />
      </div>
      </div>
      {showJump && (
        <button
          onClick={() => { stickToBottomRef.current = true; setShowJump(false); scrollToBottom(); }}
          className="jump-latest-button absolute left-1/2 -translate-x-1/2 bottom-36 px-3 py-1.5 rounded-full bg-bg-surface border border-border text-xs text-text-secondary hover:text-text-primary hover:border-accent/50 shadow-pop transition-all duration-hover"
        >
          {content.status.jumpToLatest}
        </button>
      )}
    </div>
  );
}

export const MessageList = memo(MessageListImpl);

type BubbleProps = { item: ChatItem } & Pick<Props, 'token' | 'cwd' | 'skin' | 'pendingByToolUseId' | 'onAcceptEdit' | 'onRejectEdit'>;

function Bubble({ item, token, cwd, skin, pendingByToolUseId, onAcceptEdit, onRejectEdit }: BubbleProps) {
  const content = contentForSkin(skin);
  if (item.kind === 'user') {
    return (
      <div className={`skin-message-row skin-message-user ${content.decor.messageClass} animate-fade-up flex justify-end ${item.optimistic ? 'opacity-85' : ''}`}>
        <div className="skin-message-bubble skin-user-bubble max-w-[80%] px-4 py-2.5 text-text-primary whitespace-pre-wrap bg-bg-accent-soft border border-accent/15 rounded-[14px_14px_4px_14px]">
          {item.text}
        </div>
        {showMessageAvatar(skin) && <MessageAvatar skin={skin} role="user" label={content.message.userLabel} />}
      </div>
    );
  }
  if (item.kind === 'assistant_text') {
    return (
      <AssistantShell skin={skin} animated={!item.streamed}>
        <MarkdownMessage text={item.text} token={token} cwd={cwd} />
      </AssistantShell>
    );
  }
  if (item.kind === 'thinking') {
    return (
      <details className="animate-fade-up text-text-muted text-xs pl-3 border-l-2 border-border cursor-pointer group">
        <summary className="select-none hover:text-text-secondary transition-colors duration-hover list-none">
          <span className="inline-flex items-center gap-1.5">
            <span>{content.message.thoughtSummary}</span>
          </span>
        </summary>
        <div className="mt-1.5 text-text-secondary"><MarkdownMessage text={item.text} compact token={token} cwd={cwd} /></div>
      </details>
    );
  }
  if (item.kind === 'tool_use') {
    if (isEditLikeTool(item)) {
      const pendingReqId = pendingByToolUseId.get(item.toolUseId);
      return <div className="animate-fade-up"><DiffBlock item={item} pendingReqId={pendingReqId} onAccept={onAcceptEdit} onReject={onRejectEdit} /></div>;
    }
    return <div className="animate-fade-up"><ToolUse item={item} defaultOpen={!!item.result?.isError} /></div>;
  }
  return (
    <div className={`animate-fade-up text-xs px-3 py-2 rounded-sm ${item.level === 'error' ? 'bg-danger/10 text-danger' : 'bg-bg-raised/60 text-text-muted'}`}>{item.text}</div>
  );
}

function ThinkingState({ skin, secondsSinceLastEvent, activeTool, onStop }: { skin: SkinId; secondsSinceLastEvent: number; activeTool?: ActiveToolInfo; onStop: () => void }) {
  const content = contentForSkin(skin);
  if (activeTool) {
    const copy = statusCopyForSkin(skin, {
      kind: 'running-tool',
      name: activeTool.name,
      seconds: secondsSinceLastEvent,
      inputSummary: activeTool.inputSummary,
    });
    return (
      <div className="text-sm text-text-secondary bg-bg-raised/60 border border-border-subtle rounded-md px-3 py-2 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {copy.label}
          {copy.hint ? ` · ${copy.hint}` : ''}
        </span>
        <button
          onClick={onStop}
          className="shrink-0 px-2 py-1 rounded-sm bg-bg-hover hover:bg-bg-surface text-[11px] font-medium transition-colors duration-hover"
        >
          {content.status.stop}
        </button>
      </div>
    );
  }
  if (secondsSinceLastEvent >= 15) {
    const copy = statusCopyForSkin(skin, { kind: 'stalled', seconds: secondsSinceLastEvent });
    return (
      <div className="text-sm text-warning bg-warning/10 border border-warning/25 rounded-md px-3 py-2 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse shrink-0" />
        <span className="min-w-0 flex-1">{copy.label}. {copy.hint}</span>
        <button
          onClick={onStop}
          className="shrink-0 px-2 py-1 rounded-sm bg-warning/10 hover:bg-warning/20 text-[11px] font-medium transition-colors duration-hover"
        >
          {content.status.stop}
        </button>
      </div>
    );
  }
  const copy = statusCopyForSkin(skin, { kind: 'thinking' });
  return <div className="text-sm text-text-muted">{copy.label}<span className="cursor-bar ml-1" /></div>;
}

function StreamingMessage({ text, token, cwd, skin }: { text: string; token: string; cwd: string; skin: SkinId }) {
  const visible = useSmoothStreamText(cleanStreamingAssistantText(text));
  if (!visible) return null;
  const split = useMemo(() => splitStableMarkdown(visible), [visible]);
  if (!split.tail) {
    return (
      <AssistantShell skin={skin}>
        <MarkdownMessage text={split.stable} streaming token={token} cwd={cwd} />
      </AssistantShell>
    );
  }
  return (
    <AssistantShell skin={skin}>
      {split.stable && <MarkdownMessage text={split.stable} token={token} cwd={cwd} />}
      <pre className="font-mono text-xs leading-[1.65] text-text-primary whitespace-pre-wrap break-words my-2">
        {split.tail}
        <span className="cursor-bar" />
      </pre>
    </AssistantShell>
  );
}

function AssistantShell({ skin, animated = false, children }: { skin: SkinId; animated?: boolean; children: ReactNode }) {
  const content = contentForSkin(skin);
  return (
    <div className={`skin-message-row skin-message-assistant ${content.decor.messageClass} ${animated ? 'animate-fade-up' : ''}`}>
      {showMessageAvatar(skin) && <MessageAvatar skin={skin} role="assistant" label={content.message.assistantLabel} />}
      <div className="skin-assistant-body min-w-0 flex-1">{children}</div>
    </div>
  );
}

function MessageAvatar({ skin, role, label }: { skin: SkinId; role: 'user' | 'assistant'; label: string }) {
  const short = skin === 'catgirl'
    ? role === 'assistant' ? '喵' : '主'
    : skin === 'wechat'
      ? role === 'assistant' ? '{}' : 'Me'
      : skin === 'emochi'
        ? role === 'assistant' ? 'M' : 'You'
        : role === 'assistant' ? 'AI' : 'YOU';
  return (
    <div className={`skin-avatar skin-avatar-${role}`} title={label} aria-label={label}>
      {(skin === 'emochi' || skin === 'wechat') && role === 'assistant' ? (
        <img className="skin-avatar-image" src={skin === 'emochi' ? assetUrl('/assets/emochi_logo.png') : assetUrl('/assets/wechat_logo.svg')} alt="" />
      ) : (
        short
      )}
    </div>
  );
}

function showMessageAvatar(skin: SkinId): boolean {
  return skin === 'wechat' || skin === 'catgirl' || skin === 'cyberpunk' || skin === 'emochi';
}
