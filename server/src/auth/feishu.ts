import type { FeishuAppConfig } from '../config.js';

const AUTHORIZE_URL = 'https://open.feishu.cn/open-apis/authen/v1/authorize';
const APP_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal';
const USER_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token';
const USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

export type FeishuUserInfo = {
  openId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
};

export class FeishuClient {
  private appToken?: { value: string; expiresAt: number };

  constructor(private readonly cfg: FeishuAppConfig) {}

  authorizeUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      app_id: this.cfg.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  private async getAppAccessToken(): Promise<string> {
    if (this.appToken && this.appToken.expiresAt > Date.now() + 30_000) {
      return this.appToken.value;
    }
    const resp = await postJson(APP_TOKEN_URL, {
      app_id: this.cfg.appId,
      app_secret: this.cfg.appSecret,
    });
    const token = resp.app_access_token as string | undefined;
    if (!token) throw new Error(`feishu app_access_token failed: ${JSON.stringify(resp)}`);
    const expireSeconds = typeof resp.expire === 'number' ? resp.expire : 600;
    this.appToken = { value: token, expiresAt: Date.now() + expireSeconds * 1000 };
    return token;
  }

  async exchangeCode(code: string): Promise<string> {
    const appToken = await this.getAppAccessToken();
    const resp = await postJson(
      USER_TOKEN_URL,
      { grant_type: 'authorization_code', code },
      { Authorization: `Bearer ${appToken}` }
    );
    if (resp.code !== 0) throw new Error(`feishu token exchange failed: ${JSON.stringify(resp)}`);
    const accessToken = (resp.data as { access_token?: string } | undefined)?.access_token;
    if (!accessToken) throw new Error('feishu token exchange returned no access_token');
    return accessToken;
  }

  async getUserInfo(userAccessToken: string): Promise<FeishuUserInfo> {
    const res = await fetch(USER_INFO_URL, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const resp = (await res.json()) as Record<string, unknown>;
    if (resp.code !== 0) throw new Error(`feishu user_info failed: ${JSON.stringify(resp)}`);
    const data = (resp.data ?? {}) as Record<string, unknown>;
    const openId = typeof data.open_id === 'string' ? data.open_id : '';
    if (!openId) throw new Error('feishu user_info returned no open_id');
    return {
      openId,
      email: firstString(data.email, data.enterprise_email),
      name: firstString(data.name, data.en_name),
      avatarUrl: firstString(data.avatar_url, data.avatar_thumb),
    };
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as Record<string, unknown>;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}
