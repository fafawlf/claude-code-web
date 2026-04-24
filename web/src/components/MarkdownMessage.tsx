import React, { Children, isValidElement, type AnchorHTMLAttributes, type ReactNode } from 'react';
import Markdown from 'markdown-to-jsx';
import { CodeBlock, codeTextFromChildren, languageFromClassName } from './CodeBlock';
import { artifactUrl, compactArtifactPath, findArtifactPaths, isArtifactPath } from '../artifacts';
import { Icon } from './Icon';

type Props = {
  text: string;
  streaming?: boolean;
  compact?: boolean;
  token?: string;
  cwd?: string;
};

type ArtifactContext = {
  token?: string;
  cwd?: string;
};

export function MarkdownMessage({ text, streaming = false, compact = false, token, cwd }: Props) {
  return (
    <div className={`markdown-message text-text-primary ${compact ? 'text-sm leading-[1.6]' : 'leading-[1.7]'}`}>
      <Markdown
        options={{
          forceBlock: true,
          disableParsingRawHTML: true,
          overrides: {
            h1: { component: Heading, props: { level: 1 } },
            h2: { component: Heading, props: { level: 2 } },
            h3: { component: Heading, props: { level: 3 } },
            h4: { component: Heading, props: { level: 4 } },
            h5: { component: Heading, props: { level: 5 } },
            h6: { component: Heading, props: { level: 6 } },
            p: { component: Paragraph, props: { token, cwd } },
            ul: { component: UnorderedList },
            ol: { component: OrderedList },
            li: { component: ListItem, props: { token, cwd } },
            blockquote: { component: Blockquote },
            table: { component: Table },
            th: { component: Th },
            td: { component: Td, props: { token, cwd } },
            a: { component: SafeLink, props: { token, cwd } },
            code: { component: InlineCode, props: { token, cwd } },
            pre: { component: PreBlock },
            hr: { component: Hr },
            input: { component: Checkbox },
          },
        }}
      >
        {text || (streaming ? ' ' : '')}
      </Markdown>
      {streaming && <span className="cursor-bar" />}
    </div>
  );
}

function Heading({ level, children }: { level: 1 | 2 | 3 | 4 | 5 | 6; children: ReactNode }) {
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  const size =
    level === 1 ? 'text-2xl mt-6 mb-3' :
    level === 2 ? 'text-xl mt-5 mb-2.5' :
    level === 3 ? 'text-lg mt-4 mb-2' :
    'text-base mt-3.5 mb-1.5';
  return <Tag className={`font-semibold tracking-normal text-text-primary ${size}`}>{children}</Tag>;
}

function Paragraph({ children, token, cwd }: { children: ReactNode } & ArtifactContext) {
  return <p className="my-2 first:mt-0 last:mb-0">{renderArtifactChildren(children, { token, cwd })}</p>;
}

function UnorderedList({ children }: { children: ReactNode }) {
  return <ul className="my-2.5 pl-5 list-disc space-y-1">{children}</ul>;
}

function OrderedList({ children }: { children: ReactNode }) {
  return <ol className="my-2.5 pl-5 list-decimal space-y-1">{children}</ol>;
}

function ListItem({ children, token, cwd }: { children: ReactNode } & ArtifactContext) {
  return <li className="pl-1 marker:text-text-muted">{renderArtifactChildren(children, { token, cwd })}</li>;
}

function Blockquote({ children }: { children: ReactNode }) {
  return <blockquote className="my-3 border-l-2 border-accent/50 pl-4 text-text-secondary bg-bg-raised/30 py-2 rounded-r-md">{children}</blockquote>;
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="my-3 overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="border-b border-border-subtle bg-bg-raised px-3 py-2 text-left font-semibold text-text-primary">{children}</th>;
}

function Td({ children, token, cwd }: { children: ReactNode } & ArtifactContext) {
  return <td className="border-t border-border-subtle px-3 py-2 align-top text-text-secondary">{renderArtifactChildren(children, { token, cwd })}</td>;
}

function SafeLink({ token, cwd, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & ArtifactContext) {
  const href = typeof props.href === 'string' ? props.href : '';
  if (token && cwd && href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && isArtifactPath(href)) {
    return <ArtifactLink path={href} token={token} cwd={cwd} />;
  }
  return (
    <a
      {...props}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent-hi underline decoration-accent/40 underline-offset-2 hover:decoration-accent-hi transition-colors duration-hover"
    />
  );
}

function InlineCode({ children, className, token, cwd }: { children: ReactNode; className?: string } & ArtifactContext) {
  if (className) {
    return <code className={className}>{children}</code>;
  }
  const raw = codeTextFromChildren(children);
  if (token && cwd && isArtifactPath(raw)) {
    return <ArtifactLink path={raw} token={token} cwd={cwd} />;
  }
  return <code className="font-mono text-[0.88em] bg-bg-raised border border-border-subtle px-1.5 py-0.5 rounded text-accent-hi">{children}</code>;
}

function PreBlock({ children }: { children: ReactNode }) {
  const only = Children.count(children) === 1 ? Children.only(children) : null;
  if (isValidElement(only)) {
    const props = only.props as { className?: string; children?: ReactNode };
    return (
      <CodeBlock
        code={codeTextFromChildren(props.children)}
        language={languageFromClassName(props.className)}
      />
    );
  }
  return <CodeBlock code={codeTextFromChildren(children)} />;
}

function Hr() {
  return <hr className="my-5 border-border-subtle" />;
}

function Checkbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  if (props.type !== 'checkbox') return <input {...props} />;
  return <input {...props} disabled className="mr-2 align-[-2px] accent-accent" />;
}

function renderArtifactChildren(children: ReactNode, ctx: Required<ArtifactContext> | ArtifactContext): ReactNode {
  if (!ctx.token || !ctx.cwd) return children;
  return Children.toArray(children).flatMap((child, childIndex) => {
    if (typeof child !== 'string') return child;
    const matches = findArtifactPaths(child);
    if (matches.length === 0) return child;
    const parts: ReactNode[] = [];
    let cursor = 0;
    matches.forEach((match, matchIndex) => {
      if (match.start > cursor) parts.push(child.slice(cursor, match.start));
      parts.push(
        <ArtifactLink
          key={`artifact-${childIndex}-${matchIndex}-${match.path}`}
          path={match.path}
          token={ctx.token!}
          cwd={ctx.cwd!}
        />
      );
      cursor = match.end;
    });
    if (cursor < child.length) parts.push(child.slice(cursor));
    return parts;
  });
}

function ArtifactLink({ path, token, cwd }: { path: string; token: string; cwd: string }) {
  const openUrl = artifactUrl({ token, cwd, path });
  const downloadUrl = artifactUrl({ token, cwd, path, download: true });
  const label = compactArtifactPath(path.replace(/^@/, ''));
  return (
    <span className="mx-0.5 inline-flex max-w-full align-middle items-center gap-1 overflow-hidden rounded-md border border-accent/25 bg-bg-accent-soft px-1.5 py-0.5 text-[0.88em] text-text-primary">
      <Icon name="file" size={12} className="shrink-0 text-accent-hi" />
      <a
        href={openUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="min-w-0 truncate font-mono text-accent-hi no-underline hover:underline"
        title={`Open ${path}`}
      >
        {label}
      </a>
      <a
        href={downloadUrl}
        className="shrink-0 rounded-sm px-1 text-[10px] font-medium text-text-secondary no-underline hover:bg-bg-hover hover:text-text-primary"
        title={`Download ${path}`}
        aria-label={`Download ${path}`}
      >
        Download
      </a>
    </span>
  );
}
