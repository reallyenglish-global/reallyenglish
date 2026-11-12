import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const reservePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address();
    socket.close((error) => error ? reject(error) : resolve(port));
  });
});

const port = await reservePort();
const child = spawn(process.execPath, ['dist/server/entry.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CRM_MODE: 'demo', CMS_API_URL: '', PUBLIC_SITE_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
const base = `http://127.0.0.1:${port}`;
const getWithHost = (host) => new Promise((resolve, reject) => {
  const request = http.get({ hostname: '127.0.0.1', port, path: '/', headers: { host } }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body }));
  });
  request.once('error', reject);
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
    await delay(200);
  }
  assert.equal(ready, true, `server did not start: ${logs}`);

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Help your learners use English with confidence/);

  const partner = await getWithHost(`partner.localhost:${port}`);
  assert.equal(partner.status, 200);
  assert.match(partner.body, /A learning experience that feels like your own/);

  const headers = { 'content-type': 'application/json', origin: base };
  const valid = await fetch(`${base}/api/leads`, {
    method: 'POST', headers,
    body: JSON.stringify({ firstName: 'Smoke', lastName: 'Test', email: 'smoke@example.test', message: 'Synthetic smoke test only', brandSlug: 'reallyenglish', consent: true }),
  });
  assert.equal(valid.status, 202);
  assert.equal((await valid.json()).mode, 'demo');

  const noConsent = await fetch(`${base}/api/leads`, {
    method: 'POST', headers,
    body: JSON.stringify({ firstName: 'Smoke', lastName: 'Test', email: 'smoke@example.test', message: 'Synthetic smoke test only', brandSlug: 'reallyenglish', consent: false }),
  });
  assert.equal(noConsent.status, 400);

  const crossOrigin = await fetch(`${base}/api/leads`, {
    method: 'POST', headers: { ...headers, origin: 'https://invalid.example' },
    body: JSON.stringify({ firstName: 'Smoke', lastName: 'Test', email: 'smoke@example.test', message: 'Synthetic smoke test only', brandSlug: 'reallyenglish', consent: true }),
  });
  assert.equal(crossOrigin.status, 403);
  console.log('Smoke tests passed: health, primary brand, partner host mapping, demo lead, consent validation, cross-origin rejection.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
