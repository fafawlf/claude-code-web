import { join } from 'node:path';

export type CcwAuthMode = 'token' | 'feishu';

export type FeishuAppConfig = {
  appId: string;
  appSecret: string;
};

export type CcwConfig = {
  authMode: CcwAuthMode;
  /** Secret for signing the browser session cookie. Required in feishu mode. */
  cookieSecret: string;
  /** Set Secure on cookies. Disable only for plain-http local testing. */
  cookieSecure: boolean;
  /** Emails that are always allowed and become admins on login. */
  adminEmails: string[];
  /** Email domains whose Feishu accounts are auto-approved (e.g. flowgpt.com). */
  allowedEmailDomains: string[];
  feishu?: FeishuAppConfig;
  /** Root that holds users.json, template/ and users/. */
  dataDir: string;
  usersRoot: string;
  usersFile: string;
  templateDir: string;
  /** Public origin (e.g. https://claude.example.com) used for the OAuth
   * redirect URI and the WebSocket Origin allowlist. Required in feishu mode. */
  publicOrigin?: string;
};

export function tokenModeConfig(): CcwConfig {
  return {
    authMode: 'token',
    cookieSecret: '',
    cookieSecure: true,
    adminEmails: [],
    allowedEmailDomains: [],
    dataDir: '',
    usersRoot: '',
    usersFile: '',
    templateDir: '',
  };
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CcwConfig {
  const authMode = (env.CCW_AUTH_MODE ?? 'token').trim() as CcwAuthMode;
  if (authMode !== 'token' && authMode !== 'feishu') {
    throw new Error(`CCW_AUTH_MODE must be "token" or "feishu", got "${authMode}"`);
  }
  if (authMode === 'token') return tokenModeConfig();

  const cookieSecret = (env.CCW_COOKIE_SECRET ?? env.COOKIE_SECRET ?? '').trim();
  const appId = (env.CCW_FEISHU_APP_ID ?? env.FEISHU_APP_ID ?? '').trim();
  const appSecret = (env.CCW_FEISHU_APP_SECRET ?? env.FEISHU_APP_SECRET ?? '').trim();
  const publicOrigin = (env.CCW_PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  const dataDir = (env.CCW_DATA_DIR ?? '/srv/ccw').trim();

  const missing: string[] = [];
  if (cookieSecret.length < 32) missing.push('CCW_COOKIE_SECRET (>= 32 chars)');
  if (!appId) missing.push('CCW_FEISHU_APP_ID');
  if (!appSecret) missing.push('CCW_FEISHU_APP_SECRET');
  if (!publicOrigin) missing.push('CCW_PUBLIC_ORIGIN');
  if (missing.length > 0) {
    throw new Error(`CCW_AUTH_MODE=feishu requires: ${missing.join(', ')}`);
  }

  return {
    authMode: 'feishu',
    cookieSecret,
    cookieSecure: env.CCW_COOKIE_SECURE !== '0',
    adminEmails: (env.CCW_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    allowedEmailDomains: (env.CCW_ALLOWED_EMAIL_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
    feishu: { appId, appSecret },
    dataDir,
    usersRoot: join(dataDir, 'users'),
    usersFile: join(dataDir, 'users.json'),
    templateDir: join(dataDir, 'template'),
    publicOrigin,
  };
}
