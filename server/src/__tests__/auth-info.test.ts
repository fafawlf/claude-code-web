import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaudeAuthInfo, detectCodexAuthInfo } from '../authInfo.js';

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'ccw-auth-'));
}

function writeCredentials(home: string, payload: unknown) {
  const dir = join(home, '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify(payload), 'utf8');
}

function writeCodexFile(home: string, name: string, content: string) {
  const dir = join(home, '.codex');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content, 'utf8');
}

test('detectClaudeAuthInfo reports API key auth first', () => {
  const home = tempHome();
  try {
    writeCredentials(home, { subscription: { plan: 'max' } });
    const info = detectClaudeAuthInfo({ env: { ANTHROPIC_API_KEY: 'sk-test' }, home });
    assert.equal(info.source, 'api');
    assert.equal(info.label, 'API key');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('detectClaudeAuthInfo reports API token auth', () => {
  const home = tempHome();
  try {
    const info = detectClaudeAuthInfo({ env: { ANTHROPIC_AUTH_TOKEN: 'token' }, home });
    assert.equal(info.source, 'api');
    assert.equal(info.label, 'API token');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('detectClaudeAuthInfo infers Claude Max and Pro from credentials when present', () => {
  const maxHome = tempHome();
  const proHome = tempHome();
  try {
    writeCredentials(maxHome, { account: { subscriptionPlan: 'claude-max' } });
    writeCredentials(proHome, { user: { tier: 'pro' } });

    const max = detectClaudeAuthInfo({ env: {}, home: maxHome });
    const pro = detectClaudeAuthInfo({ env: {}, home: proHome });

    assert.equal(max.source, 'account');
    assert.equal(max.plan, 'max');
    assert.equal(max.label, 'Claude Max');
    assert.equal(pro.source, 'account');
    assert.equal(pro.plan, 'pro');
    assert.equal(pro.label, 'Claude Pro');
  } finally {
    rmSync(maxHome, { recursive: true, force: true });
    rmSync(proHome, { recursive: true, force: true });
  }
});

test('detectClaudeAuthInfo handles account with unknown plan and no auth', () => {
  const accountHome = tempHome();
  const emptyHome = tempHome();
  try {
    writeCredentials(accountHome, { oauth: { accessToken: 'token' } });
    const account = detectClaudeAuthInfo({ env: {}, home: accountHome });
    const none = detectClaudeAuthInfo({ env: {}, home: emptyHome });

    assert.equal(account.source, 'account');
    assert.equal(account.plan, 'unknown');
    assert.equal(account.label, 'Claude account');
    assert.equal(none.source, 'none');
  } finally {
    rmSync(accountHome, { recursive: true, force: true });
    rmSync(emptyHome, { recursive: true, force: true });
  }
});

test('detectCodexAuthInfo reports ChatGPT Codex Pro when GPT-5.5 is available', () => {
  const home = tempHome();
  try {
    writeCodexFile(home, 'auth.json', JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'redacted' } }));
    writeCodexFile(home, 'config.toml', 'model = "gpt-5.5"\n');
    const info = detectCodexAuthInfo({ env: {}, home });

    assert.equal(info.source, 'chatgpt');
    assert.equal(info.plan, 'pro');
    assert.equal(info.label, 'Codex Pro');
    assert.match(info.detail ?? '', /gpt-5\.5/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('detectCodexAuthInfo reports OpenAI API and missing auth safely', () => {
  const apiHome = tempHome();
  const emptyHome = tempHome();
  try {
    writeCodexFile(apiHome, 'auth.json', JSON.stringify({ auth_mode: 'api', OPENAI_API_KEY: 'redacted' }));
    const api = detectCodexAuthInfo({ env: {}, home: apiHome });
    const none = detectCodexAuthInfo({ env: {}, home: emptyHome });

    assert.equal(api.source, 'api');
    assert.equal(api.label, 'OpenAI API');
    assert.equal(none.source, 'none');
  } finally {
    rmSync(apiHome, { recursive: true, force: true });
    rmSync(emptyHome, { recursive: true, force: true });
  }
});
