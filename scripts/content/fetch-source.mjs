import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { resolveSource, resolveReference, sourceUrl, queryDisposition } from './source-policy.mjs';
export function fetchOnce(url, address, { timeoutMs = 30_000, maxBody = 2_500_000, requestImpl = request } = {}) {
  return new Promise((resolve, reject) => {
    const family = address.includes(':') ? 6 : 4;
    const req = requestImpl(url, { method: 'GET', agent: false,
      headers: { 'user-agent': 'ReallyEnglishPublicContentImporter/1.1', accept: 'text/html,application/xml,text/xml' },
      lookup: (_host, options, callback) => options?.all ? callback(null, [{ address, family }]) : callback(null, address, family),
    }, (res) => {
      const chunks = []; let bytes = 0;
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('response_aborted')));
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBody) { req.destroy(new Error('response_too_large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), bytes }));
    });
    const timer = setTimeout(() => req.destroy(new Error('request_timeout')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject); req.end();
  });
}
export async function getSource(input, { resolve, fetch = fetchOnce, schedule = async () => {}, onResponse = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let url = sourceUrl(input); const chain = [];
  try {
  for (let hop = 0; hop <= 5; hop++) {
    let response;
    for (let attempt = 0; attempt <= 2; attempt++) {
      await schedule();
      const pinned = await resolveSource(url.href, resolve ? { resolve } : {});
      response = await fetch(pinned.url, pinned.address);
      onResponse(response);
      if (![429, 502, 503].includes(response.status) || attempt === 2) break;
      const value = response.headers['retry-after'];
      const delay = /^\d+$/.test(value || '') ? Number(value) * 1000 : Date.parse(value) - Date.now();
      await sleep(Math.min(30_000, Math.max(0, Number.isFinite(delay) ? delay : 1000 * (attempt + 1))));
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return { ...response, url: url.href, chain };
    if (!response.headers.location) throw new Error('redirect_missing_location');
    const next = resolveReference(response.headers.location, url.href);
    sourceUrl(next.href);
    chain.push({ from: url.href, to: next.href, status: response.status, fetchedAt: new Date().toISOString(), rawHash: createHash('sha256').update(response.body).digest('hex') });
    // Query targets receive a terminal exclusion without being fetched.
    if (queryDisposition(next)) return { ...response, url: next.href, chain };
    if (hop === 5) throw new Error('redirect_limit');
    url = next;
  }
  } catch (error) {
    error.chain = chain;
    error.requestUrl = url.href;
    throw error;
  }
}
