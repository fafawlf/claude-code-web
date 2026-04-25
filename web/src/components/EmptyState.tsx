import type { SkinId } from '../skins';
import { contentForSkin } from '../skinContent';

type Props = {
  cwd: string;
  skin: SkinId;
  onOpenProject: () => void;
};

export function EmptyState({ cwd, skin, onOpenProject }: Props) {
  const content = contentForSkin(skin);
  return (
    <div className={`skin-empty ${content.decor.emptyClass} flex-1 flex flex-col items-center justify-center px-6 pb-48`}>
      <div className="skin-empty-decor" aria-hidden />
      {content.empty.mascot && (
        <div className="skin-empty-mascot mb-3" aria-hidden>
          {content.empty.mascotImage ? (
            <img className="skin-empty-mascot-image" src={content.empty.mascotImage} alt={content.empty.mascotAlt ?? ''} />
          ) : (
            content.empty.mascot
          )}
        </div>
      )}
      <h1 className="font-serif text-[34px] leading-[1.2] font-semibold tracking-tight text-text-primary mb-2 text-center">
        {content.empty.headline}
      </h1>
      <p className="text-text-secondary mb-9 text-center">
        {content.empty.beforeCwd}
        <button onClick={onOpenProject} className="font-mono text-sm text-accent-hi hover:underline underline-offset-2">
          {compact(cwd)}
        </button>
        {content.empty.afterCwd}
      </p>
      <div className="flex gap-4 flex-wrap justify-center text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="kbd">⌘K</span> {content.empty.shortcuts.command}</span>
        <span className="inline-flex items-center gap-1.5"><span className="kbd">⇧⇥</span> {content.empty.shortcuts.mode}</span>
        <span className="inline-flex items-center gap-1.5"><span className="kbd">@</span> {content.empty.shortcuts.attach}</span>
        <span className="inline-flex items-center gap-1.5"><span className="kbd">/</span> {content.empty.shortcuts.slash}</span>
      </div>
    </div>
  );
}

function compact(p: string): string {
  const home = '/root';
  let s = p;
  if (s.startsWith(home)) s = '~' + s.slice(home.length);
  const parts = s.split('/').filter(Boolean);
  if (parts.length <= 4) return s;
  return (s.startsWith('~') ? '~/' : '/') + '…/' + parts.slice(-3).join('/');
}
