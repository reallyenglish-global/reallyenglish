import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';

// In-memory transpilation only: no build, installation, generated files or services.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const site = dataModule(await readFile(new URL('../src/lib/site.ts', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../src/pages/api/leads.ts', import.meta.url), 'utf8')).replace("'../../lib/site'", JSON.stringify(site));
const { POST } = await import(dataModule(source));
const lead = changes => ({ firstName: 'CI', lastName: 'Test', email: 'synthetic@example.invalid', message: 'Synthetic test enquiry.', companyName: '', consent: true, website: '', sourcePath: '/', sourceUrl: 'http://localhost:4321/', locale: 'en', submissionId: randomUUID(), ...changes });
let sequence = 0;
const submit = (body, options = {}) => {
  const url = options.url ?? 'http://localhost:4321/api/leads';
  const headers = { 'Content-Type': 'application/json', Origin: new URL(url).origin, ...options.headers };
  if (options.noOrigin) delete headers.Origin;
  const request = new Request(url, { method: 'POST', headers, body: options.raw ?? JSON.stringify(body) });
  return POST({ request, clientAddress: options.ip ?? `test-${++sequence}` });
};

test('lead endpoint contract (unit doubles, not live Twenty evidence)', async t => {
  const env = { ...process.env }, originalFetch = globalThis.fetch;
  try {
    delete process.env.CRM_MODE;
    delete process.env.BRAND_HOST_MAP;
    globalThis.fetch = async () => { throw new Error('unexpected_network'); };
    await t.test('default demo never contacts CRM', async () => {
      const response = await submit(lead());
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { ok: true, mode: 'demo' });
    });
    await t.test('host and Origin fail closed; forwarded headers do not select a tenant', async () => {
      for (const url of ['http://unknown.invalid/api/leads', 'http://localhost.evil.invalid/api/leads']) assert.equal((await submit(lead(), { url, headers: { 'X-Forwarded-Host': 'localhost' } })).status, 421);
      assert.equal((await submit(lead(), { headers: { Host: 'partner.localhost:4321' } })).status, 403); // Raw host and Origin must agree even when adapter URL differs.
      assert.equal((await submit(lead(), { headers: { Origin: 'https://evil.invalid' } })).status, 403);
      assert.equal((await submit(lead(), { noOrigin: true })).status, 403);
      assert.equal((await submit(lead({ brandSlug: 'partner-demo' }))).status, 400);
    });
    await t.test('strict consent, fields, UUID, locale and source', async () => {
      for (const change of [{consent:false}, {consent:'on'}, {consent:undefined}, {submissionId:'bad'}, {firstName:'x'.repeat(81)}, {locale:'zz'}, {sourcePath:'/missing'}, {sourcePath:'/%2e%2e/'}, {sourceUrl:'https://evil.invalid/'}, {sourceUrl:'http://localhost:4321/?secret=x'}]) assert.equal((await submit(lead(change))).status, 400);
      for (const raw of ['[]', 'null', '{']) assert.equal((await submit(lead(), { raw })).status, 400);
      assert.equal((await submit(lead(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    });
    await t.test('declared and streamed byte limits reject without CRM', async () => {
      assert.equal((await submit(lead(), { headers: { 'Content-Length': '20000' } })).status, 413);
      assert.equal((await submit(lead({message:'x'.repeat(17000)}))).status, 413);
      const request = new Request('http://localhost:4321/api/leads', {method:'POST', headers:{Origin:'http://localhost:4321','Content-Type':'application/json'}, body:new ReadableStream({start(c){c.enqueue(new Uint8Array(17000));c.close();}}), duplex:'half'});
      assert.equal((await POST({ request, clientAddress:'stream' })).status, 413);
    });
    await t.test('honeypot returns generic success without a write', async () => {
      assert.deepEqual(await (await submit(lead({ website:'bot' }))).json(), {ok:true});
    });
    await t.test('per-address abuse budget is bounded', async () => {
      for (let i=0;i<120;i++) assert.equal((await submit(lead(), {ip:'rate-test'})).status, 202);
      assert.equal((await submit(lead(), {ip:'rate-test'})).status, 429);
    });
    process.env.CRM_MODE = 'twenty';
    process.env.CMS_API_URL = 'http://127.0.0.1:1337';
    process.env.CMS_READ_TOKEN = 'unit-cms-key';
    process.env.TWENTY_BASE_URL = 'http://127.0.0.1:3000';
    process.env.TWENTY_API_KEY = 'unit-crm-key';
    const rows = new Map();
    let creates = 0, crmDown = false, race = false, malformedRead = false;
    globalThis.fetch = async (url, options = {}) => {
      const endpoint = new URL(url);
      if (endpoint.port === '1337') {
        if (endpoint.searchParams.get('path') !== '/') return new Response('{}', {status:404});
        return Response.json({path:'/',locale:'en',canonical:'https://www.reallyenglish.com/'});
      }
      if (crmDown) throw new Error('unavailable');
      assert.equal(options.headers.Authorization, 'Bearer unit-crm-key');
      if (options.method === 'POST') {
        const value = JSON.parse(options.body);
        creates++;
        assert.match(value.dedupKey, /^[a-f0-9]{64}$/);
        assert.match(value.payloadHash, /^[a-f0-9]{64}$/);
        rows.set(value.dedupKey, { ...value, id: randomUUID() });
        return Response.json({}, { status: race ? 409 : 201 });
      }
      assert.equal(endpoint.searchParams.get('limit'), '2');
      const key = endpoint.searchParams.get('filter').replace('dedupKey[eq]:','');
      return Response.json(malformedRead ? {} : {data:{websiteLeads:rows.has(key) ? [rows.get(key)] : []}});
    };
    await t.test('real-mode contract writes then reads; identical retry stable; changed retry conflicts', async () => {
      const value = lead(), first = await submit(value), body = await first.json();
      assert.equal(first.status, 202);
      assert.ok(body.id);
      const retry = await submit(value);
      assert.deepEqual(await retry.json(), body);
      assert.equal(creates, 1);
      assert.equal((await submit({...value,message:'This is changed content.'})).status, 409);
      assert.equal(creates, 1);
      const stored = [...rows.values()][0];
      assert.equal(stored.sourceUrl,'https://www.reallyenglish.com/');
      assert.equal(stored.consentVersion,'website-enquiry-v1');
    });
    await t.test('unique conflict recovers by exact readback', async () => {
      race = true;
      assert.equal((await submit(lead())).status, 202);
      race = false;
    });
    await t.test('published source and locale required before CRM', async () => {
      const before = creates;
      assert.equal((await submit(lead({sourcePath:'/missing',sourceUrl:'http://localhost:4321/missing'}))).status, 400);
      assert.equal((await submit(lead({locale:'ja'}))).status, 400);
      assert.equal(creates,before);
    });
    await t.test('CRM outage/malformed read cannot become demo or success', async () => {
      crmDown = true;
      assert.equal((await submit(lead())).status, 502);
      crmDown = false; malformedRead = true;
      assert.equal((await submit(lead())).status, 502);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
