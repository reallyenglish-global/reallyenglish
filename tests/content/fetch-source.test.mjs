import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fetchOnce, getSource } from '../../scripts/content/fetch-source.mjs';
const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
test('socket lookup is pinned, including all-address lookup; no pooled sockets', async () => {
  await fetchOnce(new URL('https://www.reallyenglish.com/'), '93.184.216.34', { requestImpl: (url, options, callback) => {
    assert.equal(url.hostname, 'www.reallyenglish.com'); assert.equal(options.agent,false);
    options.lookup(url.hostname, {}, (_, address, family) => { assert.equal(address,'93.184.216.34'); assert.equal(family,4); });
    options.lookup(url.hostname, { all:true }, (_, answers) => assert.deepEqual(answers,[{ address:'93.184.216.34',family:4 }]));
    const req = new EventEmitter(); req.destroy = (e) => { req.emit('error',e); req.emit('close'); };
    req.end = () => { const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; callback(res); res.emit('data',Buffer.from('ok')); res.emit('end'); req.emit('close'); }; return req;
  } });
});
test('redirect to loopback is denied before network request', async () => {
  let calls = 0;
  await assert.rejects(getSource('https://www.reallyenglish.com/', { resolve, fetch: async () => {
    calls++; return { status:302, headers:{location: calls < 3 ? `/step${calls}` : 'https://127.0.0.1/'},body:'' };
  }}), /source_origin_denied/);
  assert.equal(calls,3);
});
test('DNS is revalidated per hop and rebind is denied', async () => {
  let queries = 0, calls = 0;
  await assert.rejects(getSource('https://www.reallyenglish.com/', { resolve: async () => [{address: ++queries === 1 ? '93.184.216.34':'127.0.0.1',family:4}], fetch: async (_url,address) => {
    assert.equal(address,'93.184.216.34'); calls++; return {status:302,headers:{location:'/next'},body:''};
  }}),/source_dns_denied/); assert.equal(calls,1);
});
test('response byte ceiling and wall-clock deadline reject', async () => {
  const make = (send) => (_url, _options, callback) => {
    const req = new EventEmitter(); req.destroy = (e) => { req.emit('error',e); req.emit('close'); };
    req.end = () => { if (send) { const res = new EventEmitter(); res.statusCode=200;res.headers={};callback(res);res.emit('data',Buffer.from('too large')); } }; return req;
  };
  await assert.rejects(fetchOnce(new URL('https://www.reallyenglish.com/'),'93.184.216.34',{maxBody:2,requestImpl:make(true)}),/response_too_large/);
  await assert.rejects(fetchOnce(new URL('https://www.reallyenglish.com/'),'93.184.216.34',{timeoutMs:5,requestImpl:make(false)}),/request_timeout/);
});
test('query redirect is returned for exclusion without fetching it', async () => {
  let calls=0;
  const result=await getSource('https://www.reallyenglish.com/',{resolve,fetch:async()=>{calls++;return {status:302,headers:{location:'/?q=search'},body:''};}});
  assert.equal(calls,1);assert.equal(result.url,'https://www.reallyenglish.com/?q=search');
});
test('retries are bounded at two with clamped Retry-After',async () => {
  let calls=0; const delays=[];
  const result=await getSource('https://www.reallyenglish.com/',{resolve,sleep:async (ms)=>delays.push(ms),fetch:async()=>{calls++;return {status:503,headers:{'retry-after':'999999'},body:''};}});
  assert.equal(result.status,503); assert.equal(calls,3); assert.deepEqual(delays,[30000,30000]);
});
