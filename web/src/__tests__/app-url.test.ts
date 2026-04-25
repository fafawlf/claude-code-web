import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUrl, assetUrl } from '../appUrl';

test('appUrl keeps root deployments compatible by default', () => {
  assert.equal(appUrl('/api/info?t=tok'), '/api/info?t=tok');
  assert.equal(appUrl('auth-check?t=tok'), '/auth-check?t=tok');
  assert.equal(assetUrl('/assets/logo.png'), '/assets/logo.png');
});
