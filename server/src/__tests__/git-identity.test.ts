import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envWithGitIdentity } from '../git/identity.js';

test('git identity env overrides author/committer without dropping base env', () => {
  const base = { PATH: '/usr/bin', HOME: '/root', EMPTY: undefined } as NodeJS.ProcessEnv;
  const env = envWithGitIdentity(base, { name: '张呈祥', email: 'zhangchengxiang@flowgpt.com' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/root'); // HOME unchanged → shared Claude subscription stays usable
  assert.equal(env.GIT_AUTHOR_NAME, '张呈祥');
  assert.equal(env.GIT_AUTHOR_EMAIL, 'zhangchengxiang@flowgpt.com');
  assert.equal(env.GIT_COMMITTER_NAME, '张呈祥');
  assert.equal(env.GIT_COMMITTER_EMAIL, 'zhangchengxiang@flowgpt.com');
  assert.ok(!('EMPTY' in env)); // undefined values dropped (spawn/SDK want string-only)
});

test('no identity leaves git env untouched (token/CLI owner keeps server config)', () => {
  const env = envWithGitIdentity({ PATH: '/usr/bin' } as NodeJS.ProcessEnv);
  assert.equal(env.GIT_AUTHOR_NAME, undefined);
  assert.equal(env.PATH, '/usr/bin');
});
