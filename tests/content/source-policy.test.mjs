import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, validateSourceUrl, isPublicAddress, resolveReference } from '../../scripts/content/source-policy.mjs';

test('normalizes root and preserves literal locale paths', () => {
  assert.equal(normalizePath('https://www.reallyenglish.com'), '/');
  assert.equal(normalizePath('https://www.reallyenglish.com/zh-cn/en-gb/toeful-itp-practice-tests'), '/zh-cn/en-gb/toeful-itp-practice-tests');
});

test('rejects encoded path separators and dot segments', () => {
  assert.throws(() => normalizePath('/%2fetc'), /encoded_path_denied/);
  assert.throws(() => normalizePath('/%2e%2e/secret'), /encoded_path_denied/);
});

test('rejects non-source origins before DNS resolution', async () => {
  let lookedUp = false;
  await assert.rejects(validateSourceUrl('http://127.0.0.1/', { resolve: async () => { lookedUp = true; return []; } }), /source_origin_denied/);
  assert.equal(lookedUp, false);
});

test('rejects reserved addresses, mapped IPv6 and double-encoded traversal', () => {
  for (const ip of ['::ffff:7f00:1','::ffff:192.168.1.1','fe80::1','ff02::1','2001:db8::1','198.51.100.1','203.0.113.1','192.0.2.1','100.64.0.1']) assert.equal(isPublicAddress(ip),false,ip);
  for (const path of ['/a/../b','/%252e%252e/x','/%00','//evil.test','/a\\\\b','/%FF']) assert.throws(() => normalizePath(path),undefined,path);
  assert.throws(() => resolveReference('../secret','https://www.reallyenglish.com/a/'));
  assert.equal(normalizePath('/中文/'), '/中文/');
});

test('rejects private resolved addresses', async () => {
  await assert.rejects(validateSourceUrl('https://www.reallyenglish.com/', { resolve: async () => [{ address: '127.0.0.1', family: 4 }] }), /source_dns_denied/);
});
