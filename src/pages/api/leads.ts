import type { APIRoute, APIContext } from 'astro';
import { createHash } from 'node:crypto';
import { configuredBrand, contentMode } from '../../lib/site';

export const prerender = false;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => json({ error: 'Please check the required fields and consent.' }, 400);
const unavailable = () => json({ error: 'We could not send your enquiry right now. Please try again later.' }, 502);
const windows = new Map<string, { count: number; until: number }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rateAllowed(key: string) {
  const now = Date.now();
  for (const [id, value] of windows) if (value.until <= now) windows.delete(id);
  const value = windows.get(key);
  if (value) return ++value.count <= 120;
  if (windows.size >= 1024) return false;
  windows.set(key, { count: 1, until: now + 600_000 });
  return true;
}

async function boundedJson(response: Request | Response, limit: number): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new RangeError('body_limit');
  const reader = response.body?.getReader();
  if (!reader) throw new SyntaxError('empty_body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('body_limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function pathValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') || value.startsWith('//') || /[\\?#\s\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c|2e|25)/i.test(value)) throw new Error('path');
  const decoded = decodeURIComponent(value);
  if (/[\\?#\s\u0000-\u001f\u007f%]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..') || /^\/(?:api|health|admin)(?:\/|$)/i.test(decoded)) throw new Error('path');
  return decoded;
}

export const POST: APIRoute = async (context: APIContext) => {
  const { request } = context;
  const requestUrl = new URL(request.url);
  // Never consult forwarded headers, body/query tenant selectors or suffix matches.
  const host = request.headers.get('host') ?? requestUrl.host;
  const brand = configuredBrand(host);
  if (!brand) return json({ error: 'Request rejected.' }, 421);
  // Astro's Node adapter normalizes the request URL hostname to localhost.
  // Use only the exact configured raw Host, never forwarded host/proto headers.
  requestUrl.host = host;
  if (request.headers.get('origin') !== requestUrl.origin) return json({ error: 'Request rejected.' }, 403);
  let address = 'unavailable';
  try { address = context.clientAddress || address; } catch { /* No forwarded-IP fallback. */ }
  if (!rateAllowed(sha256(`${host}\0${address}`))) return json({ error: 'Please try again later.' }, 429);
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return json({ error: 'JSON is required.' }, 415);
  let raw: unknown;
  try { raw = await boundedJson(request, 16 * 1024); }
  catch (error) { return json({ error: 'Invalid request.' }, error instanceof RangeError ? 413 : 400); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  const body = raw as Record<string, unknown>;
  if (body.brandSlug !== undefined && body.brandSlug !== brand.slug) return invalid();
  if (typeof body.website === 'string' && body.website.trim()) return json({ ok: true }, 202);
  if (body.website !== undefined && typeof body.website !== 'string') return invalid();
  const field = (key: string, max: number, optional = false) => {
    const value = body[key];
    if (optional && value === undefined) return '';
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('field');
    return value.trim();
  };
  const mode = process.env.CRM_MODE ?? 'demo';
  let payload: Record<string, string | boolean>;
  try {
    const firstName = field('firstName', 80), lastName = field('lastName', 80);
    const email = field('email', 254).toLowerCase(), companyName = field('companyName', 160, true), message = field('message', 3000);
    if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 10 || body.consent !== true || typeof body.submissionId !== 'string' || !UUID.test(body.submissionId)) return invalid();
    const sourcePath = pathValue(body.sourcePath), claimedLocale = field('locale', 32);
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(claimedLocale)) return invalid();
    let locale: string;
    let sourceUrl: string;
    if (mode === 'demo' && (contentMode() === 'demo' || brand.slug !== 'reallyenglish')) {
      locale = 'en';
      if (sourcePath !== '/' || claimedLocale !== locale) return invalid();
      sourceUrl = `${requestUrl.origin}/`;
    } else {
      if (brand.slug !== 'reallyenglish') return invalid();
      if (contentMode() !== 'published') return unavailable();
      const cmsBase = process.env.CMS_API_URL, cmsToken = process.env.CMS_READ_TOKEN;
      if (!cmsBase || !cmsToken) return unavailable();
      const endpoint = new URL('/api/site/page', cmsBase);
      endpoint.search = new URLSearchParams({ brand: brand.slug, path: sourcePath }).toString();
      let response: Response;
      try { response = await fetch(endpoint, { headers: { Authorization: `Bearer ${cmsToken}` }, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
      catch { return unavailable(); }
      if (response.status === 404) return invalid();
      if (!response.ok) return unavailable();
      const page = await boundedJson(response, 3_000_000) as Record<string, unknown>;
      if (page.path !== sourcePath || page.locale !== claimedLocale) return invalid();
      locale = page.locale;
      const canonical = new URL(String(page.canonical));
      if (canonical.origin !== 'https://www.reallyenglish.com' || canonical.username || canonical.password || canonical.search || canonical.hash) return unavailable();
      sourceUrl = new URL(sourcePath, canonical.origin).href;
    }
    // Accept only the local rendered page or its trusted canonical origin/path.
    if (body.sourceUrl !== undefined) {
      if (typeof body.sourceUrl !== 'string' || body.sourceUrl.length > 2048) return invalid();
      const supplied = new URL(body.sourceUrl);
      if (supplied.username || supplied.password || supplied.search || supplied.hash || pathValue(supplied.pathname) !== sourcePath || ![requestUrl.origin, new URL(sourceUrl).origin].includes(supplied.origin)) return invalid();
    }
    payload = { name: `${firstName} ${lastName}`, firstName, lastName, email, companyName, message,
      brandSlug: brand.slug, sourceUrl, sourcePath, locale, consent: true,
      consentVersion: 'website-enquiry-v1', submissionId: body.submissionId.toLowerCase() };
  } catch { return invalid(); }
  if (mode === 'demo') return json({ ok: true, mode: 'demo' }, 202);
  if (mode !== 'twenty') return json({ error: 'CRM integration is not configured.' }, 503);
  const baseValue = process.env.TWENTY_BASE_URL, apiKey = process.env.TWENTY_API_KEY;
  const objectName = process.env.TWENTY_LEAD_OBJECT_API_NAME ?? 'websiteLeads';
  if (!baseValue || !apiKey || objectName !== 'websiteLeads') return json({ error: 'CRM integration is not configured.' }, 503);
  let endpoint: URL;
  try {
    endpoint = new URL(baseValue);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))) throw new Error('config');
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/rest/${objectName}`;
  } catch { return json({ error: 'CRM integration is not configured.' }, 503); }
  const dedupKey = sha256(`${brand.slug}\0${payload.submissionId}`), payloadHash = sha256(JSON.stringify(payload));
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const read = async (): Promise<Record<string, unknown> | undefined> => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ filter: `dedupKey[eq]:${dedupKey}`, limit: '2' }).toString();
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('crm_read');
    const value = await boundedJson(response, 128_000) as { data?: { websiteLeads?: Record<string, unknown>[] } };
    const rows = value?.data?.websiteLeads;
    if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => row.dedupKey !== dedupKey || typeof row.id !== 'string')) throw new Error('crm_shape');
    return rows[0];
  };
  const result = (row: Record<string, unknown>) => {
    if (row.payloadHash !== payloadHash) return json({ error: 'This submission has already been used.' }, 409);
    if (!Object.entries(payload).every(([key, value]) => row[key] === value) || typeof row.consentAt !== 'string' || !Number.isFinite(Date.parse(row.consentAt))) return unavailable();
    return json({ ok: true, id: row.id }, 202);
  };
  try {
    const existing = await read();
    if (existing) return result(existing);
    // The schema's unique dedupKey is the race barrier; GET alone is insufficient.
    const response = await fetch(endpoint, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(8000), body: JSON.stringify({ ...payload, dedupKey, payloadHash, consentAt: new Date().toISOString() }) });
    await response.body?.cancel();
    // Read even after non-2xx: a competing create may have won the unique constraint.
    const saved = await read();
    return saved ? result(saved) : unavailable();
  } catch { return unavailable(); }
};
