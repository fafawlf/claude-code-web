import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type Props = {
  code: string;
  language?: string;
  defaultWrap?: boolean;
  limited?: boolean;
  className?: string;
};

export function CodeBlock({ code, language, defaultWrap = false, limited = false, className = '' }: Props) {
  const [wrap, setWrap] = useState(defaultWrap);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'select'>('idle');
  const lang = normalizeLanguage(language);

  const copy = async () => {
    const ok = await copyTextToClipboard(code);
    setCopyState(ok ? 'copied' : 'select');
    window.setTimeout(() => setCopyState('idle'), 1400);
  };

  return (
    <div className={`my-3 rounded-md border border-border-subtle bg-bg-base overflow-hidden ${className}`}>
      <div className="h-9 px-3 flex items-center gap-2 border-b border-border-subtle bg-bg-raised/70">
        <span className="font-mono text-[11px] text-text-muted truncate">{lang || 'text'}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setWrap((v) => !v)}
            className={`px-2 py-1 rounded-sm text-[11px] transition-colors duration-hover ${wrap ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}
            title={wrap ? 'Disable line wrap' : 'Wrap long lines'}
            aria-label={wrap ? 'Disable line wrap' : 'Wrap long lines'}
          >
            Wrap
          </button>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-hover"
            title="Copy code"
            aria-label="Copy code"
          >
            <Icon name={copyState === 'copied' ? 'check' : 'copy'} size={12} />
            {copyState === 'copied' ? 'Copied' : copyState === 'select' ? 'Select' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className={`font-mono text-xs leading-[1.6] text-text-primary overflow-auto ${limited ? 'max-h-[360px]' : ''}`}>
        <code className={`block px-3.5 py-3 ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre min-w-max'}`}>{code || '\n'}</code>
      </pre>
    </div>
  );
}

export function codeTextFromChildren(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(codeTextFromChildren).join('');
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  return String(children).replace(/\n$/, '');
}

export function languageFromClassName(className: unknown): string | undefined {
  if (typeof className !== 'string') return undefined;
  const match = className.match(/(?:^|\s)(?:language-|lang-)([A-Za-z0-9_+.-]+)/);
  return match?.[1];
}

function normalizeLanguage(language: string | undefined): string | undefined {
  if (!language) return undefined;
  return language.replace(/^language-/, '').trim() || undefined;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
