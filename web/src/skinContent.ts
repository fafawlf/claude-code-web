import type { SkinId } from './skins';
import type { IconName } from './components/Icon';
import type { StatusKind } from './components/StatusBar';
import { assetUrl } from './appUrl';

export type SkinSuggestion = {
  icon: IconName;
  mark: string;
  title: string;
  body: string;
  prompt: string;
};

export type SkinContent = {
  empty: {
    mascot: string;
    mascotImage?: string;
    mascotAlt?: string;
    headline: string;
    beforeCwd: string;
    afterCwd: string;
    shortcuts: {
      command: string;
      mode: string;
      attach: string;
      slash: string;
    };
  };
  status: {
    serverConnected: string;
    jumpToLatest: string;
    stop: string;
    review: string;
  };
  message: {
    userLabel: string;
    assistantLabel: string;
    thoughtSummary: string;
  };
  decor: {
    emptyClass: string;
    suggestionClass: string;
    messageClass: string;
  };
};

const WARM_SUGGESTIONS: SkinSuggestion[] = [
  {
    icon: 'sparkles',
    mark: '01',
    title: 'Codebase tour',
    body: 'Give me a tour of this codebase — what are the major modules?',
    prompt: 'Give me a tour of this codebase — what are the major modules and how do they fit together?',
  },
  {
    icon: 'list',
    mark: '02',
    title: 'Find TODOs',
    body: 'Find all TODOs and group them by file.',
    prompt: 'Find all TODO comments in the repo and group them by file.',
  },
  {
    icon: 'zap',
    mark: '03',
    title: 'Safe refactors',
    body: 'Suggest three low-risk refactors for this week.',
    prompt: 'Suggest three low-risk refactors I could ship this week. Show me before/after for each.',
  },
];

const CYBERPUNK_SUGGESTIONS: SkinSuggestion[] = [
  {
    icon: 'terminal',
    mark: 'BREACH',
    title: 'BREACH THIS CODEBASE',
    body: 'Map every module, flag chokepoints, surface the architecture.',
    prompt: 'Give me a precise architecture map of this codebase. Identify major modules, data flow, risky seams, and the safest first improvements.',
  },
  {
    icon: 'list',
    mark: 'TRACE',
    title: 'SCRAPE // TODOS',
    body: 'Pull every TODO, group by file, rank by blast radius.',
    prompt: 'Find every TODO or FIXME in this repo. Group them by file and rank them by risk and implementation effort.',
  },
  {
    icon: 'zap',
    mark: 'CUT',
    title: 'SUGGEST SAFE CUTS',
    body: 'Three low-risk refactors. Clean diffs. No surprises.',
    prompt: 'Suggest three low-risk refactors I can ship safely. For each one, explain the before/after and likely test coverage.',
  },
];

const WECHAT_SUGGESTIONS: SkinSuggestion[] = [
  {
    icon: 'sparkles',
    mark: 'MAP',
    title: '带我看一遍代码结构',
    body: '先像聊天一样讲清楚这个项目怎么组织。',
    prompt: '带我看一遍代码结构：主要模块是什么，它们怎么协作，哪些地方我应该先理解？',
  },
  {
    icon: 'list',
    mark: 'TODO',
    title: '把所有 TODO 按文件分组',
    body: '扫一遍待办，按文件和优先级整理。',
    prompt: '把所有 TODO / FIXME 找出来，按文件分组，并给出处理优先级。',
  },
  {
    icon: 'pencil',
    mark: 'DIFF',
    title: '推荐三个低风险重构',
    body: '先给我可落地的小改动，不要大动干戈。',
    prompt: '推荐这周可以做的三个低风险重构。每个都说明收益、风险和建议测试。',
  },
];

const CATGIRL_SUGGESTIONS: SkinSuggestion[] = [
  {
    icon: 'sparkles',
    mark: 'nya',
    title: '带我逛逛代码窝呀~',
    body: '先画一张项目小地图，告诉主人每个房间放了什么。',
    prompt: '带我逛一遍这个代码仓库：主要模块是什么，各自负责什么，我应该从哪里开始读？',
  },
  {
    icon: 'list',
    mark: 'todo',
    title: '把 TODO 都捞起来',
    body: '用小爪子扒一遍，按文件分好堆。',
    prompt: '找出仓库里所有 TODO / FIXME，按文件分组，并告诉我哪些最值得先处理。',
  },
  {
    icon: 'zap',
    mark: 'safe',
    title: '推荐三个安全小改动',
    body: '只要乖乖的小改动，不咬手的那种。',
    prompt: '推荐三个低风险、容易验证的改进。请说明为什么安全，以及应该怎么测试。',
  },
];

const EMOCHI_SUGGESTIONS: SkinSuggestion[] = [
  {
    icon: 'sparkles',
    mark: 'MAP',
    title: '给我导览这个代码库',
    body: '列出主要模块和它们的作用。',
    prompt: '给我导览这个代码库：列出主要模块、它们的作用、调用关系和我应该先读的入口。',
  },
  {
    icon: 'list',
    mark: 'TODO',
    title: '找出所有 TODO',
    body: '按文件分组，标出优先级。',
    prompt: '找出所有 TODO / FIXME，按文件分组，标出优先级和推荐处理顺序。',
  },
  {
    icon: 'zap',
    mark: 'LOW RISK',
    title: '推荐三个低风险重构',
    body: '这周就能合的那种。',
    prompt: '推荐三个低风险重构，要求这周能合入。每个说明收益、风险和测试方式。',
  },
];

const CONTENT: Record<SkinId, SkinContent> = {
  warm: {
    empty: {
      mascot: '',
      headline: 'Ready when you are.',
      beforeCwd: 'Ask anything. I have access to ',
      afterCwd: '',
      shortcuts: {
        command: 'command palette',
        mode: 'cycle mode',
        attach: 'attach file',
        slash: 'slash command',
      },
    },
    status: {
      serverConnected: 'Server is connected.',
      jumpToLatest: 'Jump to latest',
      stop: 'Stop',
      review: 'Review',
    },
    message: {
      userLabel: 'You',
      assistantLabel: 'Claude',
      thoughtSummary: 'Thought for a moment',
    },
    decor: {
      emptyClass: 'skin-empty-warm',
      suggestionClass: 'skin-suggestion-warm',
      messageClass: 'skin-message-warm',
    },
  },
  cyberpunk: {
    empty: {
      mascot: 'JACK IN.',
      headline: 'JACK IN.',
      beforeCwd: 'WIRED TO ',
      afterCwd: ' · AWAITING COMMAND',
      shortcuts: {
        command: 'CMD.PAL',
        mode: 'CYCLE.MODE',
        attach: 'ATTACH.PAYLOAD',
        slash: 'SLASH.RUN',
      },
    },
    status: {
      serverConnected: 'NET LINK STABLE',
      jumpToLatest: 'SYNC TO LATEST',
      stop: 'KILL',
      review: 'REVIEW',
    },
    message: {
      userLabel: 'USER',
      assistantLabel: 'NET',
      thoughtSummary: 'TRACE BUFFER',
    },
    decor: {
      emptyClass: 'skin-empty-cyberpunk',
      suggestionClass: 'skin-suggestion-cyberpunk',
      messageClass: 'skin-message-cyberpunk',
    },
  },
  wechat: {
    empty: {
      mascot: 'DevChat',
      mascotImage: assetUrl('/assets/wechat_logo.svg'),
      mascotAlt: 'DevChat',
      headline: 'DevChat 已连接',
      beforeCwd: '像聊天一样操作 ',
      afterCwd: '，随时可以开工。',
      shortcuts: {
        command: '命令面板',
        mode: '切换模式',
        attach: '发送文件',
        slash: '快捷命令',
      },
    },
    status: {
      serverConnected: '连接正常',
      jumpToLatest: '回到最新消息',
      stop: '停止',
      review: '查看',
    },
    message: {
      userLabel: '我',
      assistantLabel: '{}',
      thoughtSummary: '查看思考过程',
    },
    decor: {
      emptyClass: 'skin-empty-wechat',
      suggestionClass: 'skin-suggestion-wechat',
      messageClass: 'skin-message-wechat',
    },
  },
  catgirl: {
    empty: {
      mascot: '(=^･ω･^=)',
      headline: '主人~ 随时听候差遣喵！',
      beforeCwd: '喵酱已经钻进 ',
      afterCwd: ' 里等主人啦。',
      shortcuts: {
        command: '命令册',
        mode: '切换',
        attach: '叼文件',
        slash: '小咒语',
      },
    },
    status: {
      serverConnected: '喵线还连着。',
      jumpToLatest: '跳到最新喵',
      stop: '停下',
      review: '看看',
    },
    message: {
      userLabel: '主人',
      assistantLabel: '喵酱',
      thoughtSummary: '喵酱的小脑袋转了一下',
    },
    decor: {
      emptyClass: 'skin-empty-catgirl',
      suggestionClass: 'skin-suggestion-catgirl',
      messageClass: 'skin-message-catgirl',
    },
  },
  emochi: {
    empty: {
      mascot: 'Mochi',
      mascotImage: assetUrl('/assets/emochi_logo.png'),
      mascotAlt: 'Mochi',
      headline: "Hi, I'm Mochi.",
      beforeCwd: 'Mochi is already inside ',
      afterCwd: ', just vibing.',
      shortcuts: {
        command: 'command palette',
        mode: 'cycle mode',
        attach: 'attach file',
        slash: 'slash command',
      },
    },
    status: {
      serverConnected: 'Mochi link is chill.',
      jumpToLatest: 'Back to latest',
      stop: 'Bonk stop',
      review: 'Review',
    },
    message: {
      userLabel: 'You',
      assistantLabel: 'Mochi',
      thoughtSummary: 'Mochi stared into space for a second',
    },
    decor: {
      emptyClass: 'skin-empty-emochi',
      suggestionClass: 'skin-suggestion-emochi',
      messageClass: 'skin-message-emochi',
    },
  },
};

export function contentForSkin(skin: SkinId): SkinContent {
  return CONTENT[skin] ?? CONTENT.warm;
}

export function suggestionsForSkin(skin: SkinId, _cwd?: string): SkinSuggestion[] {
  switch (skin) {
    case 'cyberpunk': return CYBERPUNK_SUGGESTIONS;
    case 'wechat': return WECHAT_SUGGESTIONS;
    case 'catgirl': return CATGIRL_SUGGESTIONS;
    case 'emochi': return EMOCHI_SUGGESTIONS;
    case 'warm':
      return WARM_SUGGESTIONS;
  }
}

export function statusCopyForSkin(skin: SkinId, status: StatusKind): { label: string; hint?: string } {
  const content = contentForSkin(skin);
  switch (status.kind) {
    case 'idle':
      return { label: '' };
    case 'connection-lost':
      return skin === 'cyberpunk'
        ? { label: 'NET LINK LOST' }
        : skin === 'catgirl'
          ? { label: '喵线断开了' }
          : skin === 'emochi'
            ? { label: 'Mochi lost the wire' }
            : skin === 'wechat'
              ? { label: '连接已断开' }
              : { label: 'Disconnected' };
    case 'reconnecting':
      return skin === 'cyberpunk'
        ? { label: 'RECONNECTING...' }
        : skin === 'catgirl'
          ? { label: '喵酱正在重新连线...' }
          : skin === 'emochi'
            ? { label: 'Mochi is reconnecting...' }
            : skin === 'wechat'
              ? { label: '正在重连...' }
              : { label: 'Reconnecting...' };
    case 'plan-approval':
      return skin === 'cyberpunk'
        ? { label: 'PLAN PACKET READY' }
        : skin === 'catgirl'
          ? { label: '计划写好啦，等主人点头' }
          : skin === 'emochi'
            ? { label: 'Mochi made a plan' }
            : skin === 'wechat'
              ? { label: '计划已生成，等你确认' }
              : { label: 'Plan ready - approve to continue' };
    case 'approval-needed':
      return skin === 'cyberpunk'
        ? { label: status.count > 1 ? `${status.count} GATES WAITING` : 'ACCESS GATE WAITING' }
        : skin === 'catgirl'
          ? { label: status.count > 1 ? `${status.count} 个地方等主人看看` : '等主人批准一下' }
          : skin === 'emochi'
            ? { label: status.count > 1 ? `${status.count} things need a nod` : 'Mochi needs a nod' }
            : skin === 'wechat'
              ? { label: status.count > 1 ? `${status.count} 个操作待确认` : '有操作待确认' }
              : { label: status.count > 1 ? `${status.count} approvals waiting` : 'Waiting for your approval' };
    case 'running-tool': {
      const elapsed = status.seconds >= 5 ? noOutputCopy(skin, status.seconds) : '';
      const input = status.inputSummary ? ` · ${status.inputSummary}` : '';
      return skin === 'cyberpunk'
        ? { label: `RUNNING ${status.name.toUpperCase()}${elapsed}`, hint: status.inputSummary }
        : skin === 'catgirl'
          ? { label: `喵酱正在跑 ${status.name}${elapsed}`, hint: status.inputSummary }
          : skin === 'emochi'
            ? { label: `Mochi is running ${status.name}${elapsed}`, hint: status.inputSummary }
            : skin === 'wechat'
              ? { label: `正在执行 ${status.name}${elapsed}${input}` }
              : { label: `Running ${status.name}${elapsed}`, hint: status.inputSummary };
    }
    case 'writing':
      return skin === 'cyberpunk'
        ? { label: 'STREAMING RESPONSE' }
        : skin === 'catgirl'
          ? { label: '喵酱正在写...' }
          : skin === 'emochi'
            ? { label: 'Mochi is typing...' }
            : skin === 'wechat'
              ? { label: '正在输入...' }
              : { label: 'Claude is writing' };
    case 'stalled':
      return skin === 'cyberpunk'
        ? { label: `PROCESSING... NO OUTPUT ${status.seconds}s`, hint: content.status.serverConnected }
        : skin === 'catgirl'
          ? { label: `喵酱还在想... ${status.seconds}s 没吐字`, hint: content.status.serverConnected }
          : skin === 'emochi'
            ? { label: `Mochi is thinking... no output ${status.seconds}s`, hint: content.status.serverConnected }
            : skin === 'wechat'
              ? { label: `正在思考 · ${status.seconds}s 没有新输出`, hint: content.status.serverConnected }
              : { label: `Claude is thinking · no output for ${status.seconds}s`, hint: 'Server is connected; Claude has not emitted a new event.' };
    case 'thinking':
      return skin === 'cyberpunk'
        ? { label: 'PROCESSING...', hint: content.status.serverConnected }
        : skin === 'catgirl'
          ? { label: '喵酱正在想...', hint: content.status.serverConnected }
          : skin === 'emochi'
            ? { label: 'Mochi is thinking...', hint: content.status.serverConnected }
            : skin === 'wechat'
              ? { label: '正在思考...', hint: content.status.serverConnected }
              : { label: 'Claude is thinking', hint: 'Server is connected.' };
  }
}

function noOutputCopy(skin: SkinId, seconds: number): string {
  switch (skin) {
    case 'cyberpunk': return ` · NO OUTPUT ${seconds}s`;
    case 'catgirl': return ` · ${seconds}s 没动静`;
    case 'emochi': return ` · no output ${seconds}s`;
    case 'wechat': return ` · ${seconds}s 无输出`;
    case 'warm': return ` · no output for ${seconds}s`;
  }
}
