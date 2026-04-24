import type { SVGProps } from 'react';

export type IconName =
  | 'folder' | 'folder-plus' | 'chev-right' | 'chev-down' | 'search' | 'plus'
  | 'send' | 'stop' | 'command' | 'brain' | 'zap'
  | 'shield' | 'terminal' | 'file' | 'check' | 'x'
  | 'pencil' | 'git-branch' | 'sparkles' | 'clock' | 'code'
  | 'circle-dot' | 'list' | 'copy' | 'paperclip' | 'palette';

type Props = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 16, className = '', ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      <Path name={name} />
    </svg>
  );
}

function Path({ name }: { name: IconName }) {
  switch (name) {
    case 'folder':
      return <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />;
    case 'folder-plus':
      return (<><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></>);
    case 'chev-right':
      return <polyline points="9 6 15 12 9 18" />;
    case 'chev-down':
      return <polyline points="6 9 12 15 18 9" />;
    case 'search':
      return (<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" /></>);
    case 'plus':
      return (<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);
    case 'send':
      return <path d="M12 19V5M6 11l6-6 6 6" strokeWidth="1.8" />;
    case 'stop':
      return <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />;
    case 'command':
      return <path d="M18 3a3 3 0 1 0 0 6h-3V6a3 3 0 0 0-6 0v3H6a3 3 0 1 0 0 6h3v3a3 3 0 1 0 6 0v-3h3a3 3 0 1 0 0-6h-3V6" />;
    case 'brain':
      return (<><path d="M9.5 2a3.5 3.5 0 0 0-3.5 3.5v.5a3.5 3.5 0 0 0-2 6.3 3.5 3.5 0 0 0 2 6.2V19a3 3 0 0 0 6 0V4.5A2.5 2.5 0 0 0 9.5 2z" /><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5V19a3 3 0 0 1-6 0" /></>);
    case 'zap':
      return <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />;
    case 'shield':
      return <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
    case 'terminal':
      return (<><polyline points="4 7 8 11 4 15" /><line x1="11" y1="17" x2="19" y2="17" /></>);
    case 'file':
      return (<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></>);
    case 'check':
      return <polyline points="4 12 10 18 20 6" strokeWidth="2" />;
    case 'x':
      return (<><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>);
    case 'pencil':
      return (<><path d="M12 20h9" /><path d="M16 4l4 4-11 11H5v-4z" /></>);
    case 'git-branch':
      return (<><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="M18 8a7 7 0 0 1-7 7H6" /></>);
    case 'sparkles':
      return (<><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z" /></>);
    case 'clock':
      return (<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>);
    case 'code':
      return (<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>);
    case 'circle-dot':
      return (<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" fill="currentColor" /></>);
    case 'list':
      return (<><line x1="8" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="8" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></>);
    case 'copy':
      return (<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
    case 'paperclip':
      return <path d="M21.4 11.6l-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />;
    case 'palette':
      return (<><path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 1.7-3.1 1.6 1.6 0 0 1 1.3-2.5H18a6 6 0 0 0 0-12z" /><circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none" /></>);
  }
}
