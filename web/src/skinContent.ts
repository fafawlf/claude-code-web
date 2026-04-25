import type { SkinId } from './skins';
import type { StatusKind } from './components/StatusBar';
import { assetUrl } from './appUrl';

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
    messageClass: string;
  };
};

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
      messageClass: 'skin-message-emochi',
    },
  },
};

export function contentForSkin(skin: SkinId): SkinContent {
  return CONTENT[skin] ?? CONTENT.warm;
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
