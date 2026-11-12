import type { APIRoute } from 'astro';

export const prerender = false;
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export const POST: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');
  const originAllowlist = (process.env.PUBLIC_SITE_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && origin !== new URL(request.url).origin && !originAllowlist.includes(origin)) return json({ error: 'Request rejected.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'JSON is required.' }, 415);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!raw || typeof raw !== 'object') return json({ error: 'Invalid request.' }, 400);
  const body = raw as Record<string, unknown>;
  if (text(body.website, 200)) return json({ ok: true }, 202);
  const requestUrl = new URL(request.url);
  let sourceUrl = requestUrl.origin;
  try {
    const suppliedSource = new URL(text(body.sourceUrl, 500), requestUrl.origin);
    if (suppliedSource.origin === requestUrl.origin) sourceUrl = `${suppliedSource.origin}${suppliedSource.pathname}`;
  } catch { /* use the local origin only */ }
  const lead = {
    submissionId: crypto.randomUUID(), firstName: text(body.firstName, 80), lastName: text(body.lastName, 80),
    email: text(body.email, 254).toLowerCase(), companyName: text(body.companyName, 160),
    message: text(body.message, 3000), brandSlug: text(body.brandSlug, 64),
    consent: body.consent === 'on' || body.consent === true,
    sourceUrl,
  };
  if (!lead.firstName || !lead.lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) || lead.message.length < 10 || !lead.consent || !/^[a-z0-9-]+$/.test(lead.brandSlug)) return json({ error: 'Please check the required fields and consent.' }, 400);

  const mode = process.env.CRM_MODE ?? 'demo';
  if (mode === 'demo') return json({ ok: true, mode: 'demo' }, 202);
  if (mode !== 'twenty') return json({ error: 'CRM integration is not configured.' }, 503);
  const baseValue = process.env.TWENTY_BASE_URL;
  const apiKey = process.env.TWENTY_API_KEY;
  const objectName = process.env.TWENTY_LEAD_OBJECT_API_NAME ?? 'websiteLeads';
  if (!baseValue || !apiKey || !/^[a-z][a-zA-Z0-9]*$/.test(objectName)) return json({ error: 'CRM integration is not configured.' }, 503);
  let base: URL;
  try { base = new URL(baseValue); } catch { return json({ error: 'CRM integration is not configured.' }, 503); }
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) return json({ error: 'CRM integration is not configured.' }, 503);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/rest/${objectName}`; base.search = ''; base.hash = '';
  try {
    const response = await fetch(base, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...lead, name: `${lead.firstName} ${lead.lastName}`, sourceUrl: lead.sourceUrl || 'website' }) });
    if (!response.ok) return json({ error: 'We could not send your enquiry right now. Please try again later.' }, 502);
    return json({ ok: true }, 202);
  } catch { return json({ error: 'We could not send your enquiry right now. Please try again later.' }, 502); }
};
