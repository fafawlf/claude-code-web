import { useMemo, useState, type ReactNode } from 'react';
import type { ActivitySessionViewModel, ActivitySummary } from '../activity';
import { projectName, type ProjectEntry } from '../projectHistory';
import type { SkinId } from '../skins';
import type { SessionStateSnapshot, StoredSession } from '../types';
import { ActivitySection } from './ActivitySection';
import { Icon } from './Icon';
import { assetUrl } from '../appUrl';

type ProjectSessions = Record<string, StoredSession[]>;

type Props = {
  cwd: string;
  projects: ProjectEntry[];
  projectSessions: ProjectSessions;
  activeId: string | null;
  activeSession: SessionStateSnapshot | null;
  activeDraftTitle?: string;
  activitySummary: ActivitySummary;
  activitySessions: ActivitySessionViewModel[];
  onNewInProject: (cwd: string) => void;
  onResume: (claudeId: string, title: string | undefined, cwd: string) => void;
  onView: (claudeId: string, title: string | undefined, cwd: string) => void;
  onOpenActivity: (sessionId: string, title?: string) => void;
  onEndActivity: (sessionId: string) => void;
  onRefresh: () => void;
  onRename: (claudeId: string, newTitle: string, cwd: string) => void;
  connected: boolean;
  onOpenCommandPalette: () => void;
  onOpenProject: () => void;
  skin?: SkinId;
};

type ProjectView = ProjectEntry & {
  name: string;
  sessions: StoredSession[];
};

export function Sidebar({
  cwd,
  projects,
  projectSessions,
  activeId,
  activeSession,
  activeDraftTitle,
  activitySummary,
  activitySessions,
  onNewInProject,
  onResume,
  onView,
  onOpenActivity,
  onEndActivity,
  onRefresh,
  onRename,
  connected,
  onOpenCommandPalette,
  onOpenProject,
  skin = 'warm',
}: Props) {
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const brand = skinBrand(skin);

  const projectViews = useMemo<ProjectView[]>(() => {
    const q = search.trim().toLowerCase();
    return projects
      .map((project) => {
        const name = projectName(project.path);
        const sessions = [...(projectSessions[project.path] ?? [])]
          .sort((a, b) => b.lastModified - a.lastModified);
        const filteredSessions = q
          ? sessions.filter((s) => [s.customTitle, s.summary, s.firstPrompt].filter(Boolean).join(' ').toLowerCase().includes(q))
          : sessions;
        const matchesProject = !q || name.toLowerCase().includes(q) || project.path.toLowerCase().includes(q);
        if (!matchesProject && filteredSessions.length === 0) return null;
        return { ...project, name, sessions: matchesProject ? filteredSessions : filteredSessions };
      })
      .filter(Boolean) as ProjectView[];
  }, [projectSessions, projects, search]);

  return (
    <aside className={`app-sidebar skin-sidebar-${skin} w-72 shrink-0 bg-bg-raised border-r border-border-subtle flex flex-col h-full`}>
      <div className="app-sidebar-header px-4 pt-4 pb-3 flex items-center gap-2.5">
        {brand ? (
          <div className="skin-sidebar-brand min-w-0 flex-1 flex items-center gap-2.5">
            <span className="skin-sidebar-logo grid place-items-center shrink-0" aria-hidden>
              <img src={brand.logo} alt="" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-text-primary">{brand.title}</span>
              <span className="block truncate text-[10px] text-text-muted">{brand.subtitle}</span>
            </span>
          </div>
        ) : (
          <>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-success shadow-[0_0_6px_rgba(138,168,118,.55)]' : 'bg-text-muted'}`}
              title={connected ? 'connected' : 'disconnected'}
            />
            <div className="text-sm text-text-secondary">Projects</div>
          </>
        )}
        <button
          onClick={onOpenCommandPalette}
          className="ml-auto w-7 h-7 rounded-sm grid place-items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-hover"
          title="Command palette"
          aria-label="Open command palette"
        >
          <Icon name="command" size={14} />
        </button>
        <button
          onClick={onRefresh}
          className="w-7 h-7 rounded-sm grid place-items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-hover"
          title="Refresh projects"
          aria-label="Refresh projects"
        >
          ↻
        </button>
        <button
          onClick={onOpenProject}
          className="w-7 h-7 rounded-sm grid place-items-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-hover"
          title="Choose project folder"
          aria-label="Choose project folder"
        >
          <Icon name="folder-plus" size={15} />
        </button>
      </div>

      <ActivitySection
        summary={activitySummary}
        sessions={activitySessions}
        onOpen={onOpenActivity}
        onEnd={onEndActivity}
      />

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-bg-surface border border-transparent focus-within:border-border transition-colors duration-hover">
          <Icon name="search" size={14} className="text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="flex-1 text-sm outline-none bg-transparent text-text-primary placeholder:text-text-muted"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-4">
        {projectViews.length === 0 && (
          <div className="px-3.5 py-3 text-xs text-text-muted">{search ? 'No matches.' : 'No projects yet.'}</div>
        )}
        {projectViews.map((project) => (
          <ProjectBlock
            key={project.path}
            project={project}
            activeCwd={cwd}
            activeId={activeId}
            activeSession={activeSession}
            activeDraftTitle={activeDraftTitle}
            renamingId={renamingId}
            draft={draft}
            onDraft={setDraft}
            onStartRename={(session) => {
              setRenamingId(session.sessionId);
              setDraft(session.customTitle ?? session.summary ?? session.firstPrompt ?? '');
            }}
            onEndRename={() => setRenamingId(null)}
            onNewInProject={onNewInProject}
            onResume={onResume}
            onView={onView}
            onRename={onRename}
          />
        ))}
      </div>
    </aside>
  );
}

function skinBrand(skin: SkinId): { title: ReactNode; subtitle: string; logo: string } | null {
  if (skin === 'emochi') {
    return {
      title: <>Mochi <span className="text-accent">Code</span></>,
      subtitle: 'deadpan code buddy',
      logo: assetUrl('/assets/emochi_logo.png'),
    };
  }
  if (skin === 'wechat') {
    return {
      title: <>Dev<span className="text-accent">Chat</span></>,
      subtitle: 'chat-style coding',
      logo: assetUrl('/assets/wechat_logo.svg'),
    };
  }
  return null;
}

function ProjectBlock({
  project,
  activeCwd,
  activeId,
  activeSession,
  activeDraftTitle,
  renamingId,
  draft,
  onDraft,
  onStartRename,
  onEndRename,
  onNewInProject,
  onResume,
  onView,
  onRename,
}: {
  project: ProjectView;
  activeCwd: string;
  activeId: string | null;
  activeSession: SessionStateSnapshot | null;
  activeDraftTitle?: string;
  renamingId: string | null;
  draft: string;
  onDraft: (value: string) => void;
  onStartRename: (session: StoredSession) => void;
  onEndRename: () => void;
  onNewInProject: (cwd: string) => void;
  onResume: (claudeId: string, title: string | undefined, cwd: string) => void;
  onView: (claudeId: string, title: string | undefined, cwd: string) => void;
  onRename: (claudeId: string, newTitle: string, cwd: string) => void;
}) {
  const activeProject = project.path === activeCwd;
  const draftChat = activeDraftChat(project, activeSession, activeDraftTitle);
  return (
    <div className={`project-block pt-2 ${activeProject ? 'project-active' : ''}`}>
      <div className={`project-folder-row group flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm ${activeProject ? 'text-text-primary' : 'text-text-secondary'} hover:bg-bg-hover transition-colors duration-hover`}>
        <button
          onClick={() => onNewInProject(project.path)}
          className="min-w-0 flex-1 flex items-center gap-2 text-left"
          title={`New chat in ${project.path}`}
        >
          <Icon name="folder" size={14} className="shrink-0 text-text-secondary" />
          <span className="truncate text-sm">{project.name}</span>
        </button>
        <button
          onClick={() => onNewInProject(project.path)}
          className="w-6 h-6 rounded-sm grid place-items-center text-text-muted opacity-0 group-hover:opacity-100 hover:text-text-primary hover:bg-bg-base transition-all duration-hover"
          title={`New chat in ${project.name}`}
          aria-label={`New chat in ${project.name}`}
        >
          <Icon name="plus" size={13} />
        </button>
      </div>

      <div className="project-chat-list ml-[25px] pr-1">
        {draftChat && (
          <div className="group relative my-px">
            <div
              className="project-chat-row project-chat-active project-chat-draft w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors duration-hover bg-bg-hover text-text-primary"
              title={draftChat.title}
            >
              <span className="truncate text-sm">{draftChat.title}</span>
              <span className="text-[11px] text-text-muted tabular-nums">{draftChat.status}</span>
            </div>
          </div>
        )}
        {project.sessions.length === 0 && !draftChat ? (
          <div className="project-empty px-2 py-1.5 text-xs text-text-muted/70">No chats</div>
        ) : project.sessions.map((session) => {
          const active = session.sessionId === activeId;
          const title = session.customTitle ?? session.summary ?? session.firstPrompt ?? '(untitled)';
          return (
            <div key={session.sessionId} className="group relative my-px">
              {renamingId === session.sessionId ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => onDraft(e.target.value)}
                  onBlur={() => { if (draft.trim()) onRename(session.sessionId, draft.trim(), project.path); onEndRename(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') onEndRename();
                  }}
                  className="w-full px-2 py-1.5 bg-bg-surface border border-border rounded text-sm text-text-primary outline-none"
                />
              ) : (
                <>
                  <button
                    onClick={() => onResume(session.sessionId, title, project.path)}
                    className={`project-chat-row ${active ? 'project-chat-active' : ''} w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors duration-hover ${active ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
                    title={title}
                  >
                    <span className="truncate text-sm">{title}</span>
                    <span className="text-[11px] text-text-muted tabular-nums">{formatAge(session.lastModified)}</span>
                  </button>
                  <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-hover bg-bg-hover pl-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onView(session.sessionId, title, project.path); }}
                      className="w-[21px] h-[21px] rounded grid place-items-center text-text-muted hover:text-text-primary hover:bg-bg-base transition-all duration-hover"
                      title="view read-only"
                    >
                      <Icon name="circle-dot" size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onStartRename(session); }}
                      className="w-[21px] h-[21px] rounded grid place-items-center text-text-muted hover:text-text-primary hover:bg-bg-base transition-all duration-hover"
                      title="rename"
                    >
                      <Icon name="pencil" size={11} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function activeDraftChat(project: ProjectView, activeSession: SessionStateSnapshot | null, activeDraftTitle: string | undefined): { title: string; status: string } | null {
  if (!activeSession || activeSession.cwd !== project.path || activeSession.viewerMode) return null;
  if (activeSession.claudeSessionId && project.sessions.some((s) => s.sessionId === activeSession.claudeSessionId)) return null;

  return {
    title: trimTitle(activeDraftTitle) || 'New chat',
    status: draftStatus(activeSession),
  };
}

function draftStatus(s: SessionStateSnapshot): string {
  switch (s.runtimeStatus) {
    case 'running': return 'working';
    case 'waiting_permission': return 'review';
    case 'waiting_plan': return 'plan';
    case 'error': return 'issue';
    case 'closed': return 'closed';
    case 'idle': return s.lastEventId > 0 || s.claudeSessionId ? formatAge(s.lastEventAt) : 'draft';
  }
}

function trimTitle(text: string | undefined): string {
  const oneLine = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}...` : oneLine;
}

function formatAge(t: number): string {
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
