import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, '../../../deploy/team/blue-green.sh');

test('blue-green deployment shell is valid and alternates inactive slots', () => {
  const syntax = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);

  const rotation = spawnSync('bash', ['-c', [
    `source ${shellQuote(script)}`,
    'inactive_port 8084',
    'inactive_port 8085',
    'random_cookie',
  ].join('; ')], {
    encoding: 'utf8',
    env: { ...process.env, CCW_DEPLOY_LIB_ONLY: '1' },
  });
  assert.equal(rotation.status, 0, rotation.stderr);
  const [green, blue, cookie] = rotation.stdout.trim().split('\n');
  assert.equal(green, '8085');
  assert.equal(blue, '8084');
  assert.match(cookie, /^[a-f0-9]{48}$/);
});

test('rendered canary route requires admin auth and keeps websocket proxying', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccw-deploy-'));
  const bin = join(dir, 'bin');
  const site = join(dir, 'site.conf');
  const state = join(dir, 'state');
  try {
    spawnSync('mkdir', ['-p', bin]);
    for (const name of ['nginx', 'systemctl']) {
      const path = join(bin, name);
      writeFileSync(path, '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(path, 0o755);
    }
    writeFileSync(site, '# previous\n');

    const rendered = spawnSync('bash', ['-c', [
      `source ${shellQuote(script)}`,
      'render_nginx 8084 8085 randomsecret 8085',
    ].join('; ')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CCW_DEPLOY_LIB_ONLY: '1',
        PATH: `${bin}:${process.env.PATH}`,
        SITE_FILE: site,
        DEPLOY_STATE_DIR: state,
        HOST: 'claude.example.test',
      },
    });
    assert.equal(rendered.status, 0, rendered.stderr);
    const config = readFileSync(site, 'utf8');
    assert.match(config, /location = \/__ccw_canary \{\s*proxy_pass http:\/\/127\.0\.0\.1:8085/s);
    assert.doesNotMatch(config, /auth_request/);
    assert.match(config, /if \(\$cookie_ccw_canary = "randomsecret"\)/);
    assert.match(config, /proxy_set_header Upgrade \$http_upgrade/);
    assert.match(config, /location = \/auth\/callback \{\s*proxy_pass http:\/\/127\.0\.0\.1:8084/s);
    assert.match(config, /location \^~ \/api\/admin\/ \{\s*proxy_pass http:\/\/127\.0\.0\.1:8084/s);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
