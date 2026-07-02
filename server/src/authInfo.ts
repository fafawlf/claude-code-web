import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readCodexDefaultModel } from './agents/resolveCodexPath.js';

export type ClaudeAuthInfo = {
  source: 'api' | 'account' | 'none' | 'unknown';
  plan?: 'max' | 'pro' | 'unknown';
  label: string;
  detail?: string;
  apiFallbackAvailable?: boolean;
};

export type CodexAuthInfo = {
  source: 'chatgpt' | 'api' | 'none' | 'unknown';
  plan?: 'pro' | 'unknown';
  label: string;
  detail?: string;
};

type DetectOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
};

export type ClaudeAuthMode = 'account' | 'api';

export function detectClaudeAuthInfo(opts: DetectOptions = {}): ClaudeAuthInfo {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const apiFallbackAvailable = hasClaudeApiKey(env);

  if (env.ANTHROPIC_API_KEY) return { source: 'api', label: 'API key', detail: 'ANTHROPIC_API_KEY', apiFallbackAvailable };
  if (env.ANTHROPIC_AUTH_TOKEN) return { source: 'api', label: 'API token', detail: 'ANTHROPIC_AUTH_TOKEN', apiFallbackAvailable };

  const credentialFiles = [
    join(home, '.claude', '.credentials.json'),
    join(home, '.claude', 'credentials.json'),
  ];

  for (const file of credentialFiles) {
    if (!existsSync(file)) continue;
    const plan = inferPlanFromCredentials(file);
    if (plan === 'max') return { source: 'account', plan, label: 'Claude Max', detail: 'claude login', apiFallbackAvailable };
    if (plan === 'pro') return { source: 'account', plan, label: 'Claude Pro', detail: 'claude login', apiFallbackAvailable };
    return { source: 'account', plan: 'unknown', label: 'Claude account', detail: 'claude login', apiFallbackAvailable };
  }

  return { source: 'none', label: 'No Claude auth', detail: 'API key or claude login not detected', apiFallbackAvailable };
}

export function hasClaudeApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!claudeApiKeyFromEnv(env);
}

export function defaultClaudeAuthMode(opts: DetectOptions = {}): ClaudeAuthMode {
  const env = opts.env ?? process.env;
  if (hasClaudeAccountCredentials(opts.home)) return 'account';
  return hasClaudeApiKey(env) ? 'api' : 'account';
}

export function envWithClaudeAuth(base: NodeJS.ProcessEnv | Record<string, string>, mode: ClaudeAuthMode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (typeof v === 'string') out[k] = v;
  const apiKey = claudeApiKeyFromEnv(out);
  delete out.CCW_ANTHROPIC_API_KEY;
  delete out.CCW_CLAUDE_API_KEY;
  delete out.ANTHROPIC_AUTH_TOKEN;
  if (mode === 'api') {
    if (apiKey) out.ANTHROPIC_API_KEY = apiKey;
  } else {
    delete out.ANTHROPIC_API_KEY;
  }
  return out;
}

function claudeApiKeyFromEnv(env: NodeJS.ProcessEnv | Record<string, string>): string | undefined {
  return env.CCW_ANTHROPIC_API_KEY || env.CCW_CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
}

function hasClaudeAccountCredentials(home = homedir()): boolean {
  return [
    join(home, '.claude', '.credentials.json'),
    join(home, '.claude', 'credentials.json'),
  ].some((file) => existsSync(file));
}

export function detectCodexAuthInfo(opts: DetectOptions = {}): CodexAuthInfo {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const authPath = join(home, '.codex', 'auth.json');
  const defaultModel = readCodexDefaultModel(home);
  const hasGpt55 = defaultModel === 'gpt-5.5' || codexModelCacheHas(home, 'gpt-5.5');

  if (existsSync(authPath)) {
    try {
      const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>;
      const mode = typeof auth.auth_mode === 'string' ? auth.auth_mode : undefined;
      if (mode === 'chatgpt' || auth.tokens) {
        return {
          source: 'chatgpt',
          plan: hasGpt55 ? 'pro' : 'unknown',
          label: hasGpt55 ? 'Codex Pro' : 'Codex ChatGPT',
          detail: [mode === 'chatgpt' ? 'ChatGPT login' : 'Codex login', defaultModel ? `default ${defaultModel}` : undefined].filter(Boolean).join(' · '),
        };
      }
      if (mode === 'api' || auth.OPENAI_API_KEY) {
        return { source: 'api', label: 'OpenAI API', detail: 'Codex API key login' };
      }
      return { source: 'unknown', label: 'Codex auth', detail: 'Codex auth file detected' };
    } catch {
      return { source: 'unknown', label: 'Codex auth', detail: 'Could not read Codex auth status' };
    }
  }

  if (env.OPENAI_API_KEY) return { source: 'api', label: 'OpenAI API', detail: 'OPENAI_API_KEY' };
  return { source: 'none', label: 'No Codex auth', detail: 'Run codex login' };
}

function inferPlanFromCredentials(file: string): ClaudeAuthInfo['plan'] {
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const values = collectLikelyPlanValues(parsed);
    if (values.some((v) => /\bmax\b/i.test(v))) return 'max';
    if (values.some((v) => /\bpro\b/i.test(v))) return 'pro';
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

function collectLikelyPlanValues(value: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown, key = '') => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const nextKey = `${key}.${k}`.toLowerCase();
      const planLike = /plan|subscription|tier|sku|accounttype/.test(nextKey);
      if (planLike && typeof v === 'string') out.push(v);
      else if (planLike && typeof v === 'object') visit(v, nextKey);
      else if (typeof v === 'object') visit(v, nextKey);
    }
  };
  visit(value);
  return out;
}

function codexModelCacheHas(home: string, slug: string): boolean {
  try {
    const raw = readFileSync(join(home, '.codex', 'models_cache.json'), 'utf8');
    const parsed = JSON.parse(raw) as { models?: Array<{ slug?: string }> };
    return parsed.models?.some((m) => m.slug === slug) ?? false;
  } catch {
    return false;
  }
}
