import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const check = (condition, code) => { if (!condition) throw new Error(code); };

// Invoke only against the disposable CI stack. No fixture, mock or demo fallback.
export async function verifyLeads({
  siteBase = process.env.ASTRO_BASE_URL ?? process.env.SITE_BASE_URL ?? 'http://127.0.0.1:4321',
  twentyBase = process.env.TWENTY_BASE_URL,
  key = process.env.TWENTY_API_KEY,
  sourcePath = process.env.LEAD_SOURCE_PATH ?? '/',
  locale = process.env.LEAD_LOCALE ?? 'en',
  unavailable = false,
} = {}) {
  check(twentyBase && key, 'missing_twenty_configuration');
  const site = new URL(siteBase), crm = new URL(twentyBase);
  for (const url of [site, crm]) check(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password, 'ci_requires_loopback');
  const crmUrl = new URL(`${crm.href.replace(/\/$/, '')}/rest/websiteLeads`);
  const headers = { Authorization: `Bearer ${key}` };
  const rowsFor = async submissionId => {
    const dedupKey = hash(`reallyenglish\0${submissionId}`), url = new URL(crmUrl);
    url.search = new URLSearchParams({ filter: `dedupKey[eq]:${dedupKey}`, limit: '2' }).toString();
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const diagnostic=await response.json().catch(()=>({}));
      console.error(JSON.stringify({stage:'crm-read',status:response.status,diagnostic:JSON.stringify(diagnostic).replace(/[A-Za-z0-9_.-]{32,}/g,'[redacted]').slice(0,3000)}));
    }
    check(response.ok, `crm_read_status_${response.status}`);
    const rows = (await response.json()).data?.websiteLeads;
    check(Array.isArray(rows) && rows.every(row => row.dedupKey === dedupKey), 'crm_filtered_read_shape');
    return rows;
  };
  const makeLead = (changes = {}) => ({
    firstName: 'CI', lastName: 'Synthetic', email: `ci-${randomUUID()}@example.invalid`,
    companyName: 'Disposable CI only', message: 'Synthetic integration verification; not a real enquiry.',
    brandSlug: 'reallyenglish', consent: true, website: '', submissionId: randomUUID(),
    sourcePath, locale, sourceUrl: new URL(sourcePath, site).href, ...changes,
  });
  const submit = async (lead, options = {}) => {
    const requestHeaders = { 'Content-Type': 'application/json', Origin: site.origin, ...options.headers };
    if (options.noOrigin) delete requestHeaders.Origin;
    // Node24 fetch rewrites Host to its URL authority. Use raw HTTP for hostile
    // authority probes so the wire request actually carries the tested header.
    const response = options.headers?.Host ? await new Promise((resolve,reject)=>{
      const req=http.request(new URL('/api/leads',site),{method:'POST',headers:requestHeaders},res=>{
        const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode})));
      });req.on('error',reject);req.setTimeout(30000,()=>req.destroy(new Error('host_probe_timeout')));req.end(options.raw ?? JSON.stringify(lead));
    }) : await fetch(new URL('/api/leads', site), {
      method: 'POST', headers: requestHeaders, body: options.raw ?? JSON.stringify(lead),
      redirect: 'manual', signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    check(!text.includes(key), 'secret_in_response');
    let body;
    try { body = JSON.parse(text); } catch { body = {}; }
    return { status: response.status, body };
  };
  if (unavailable) {
    // Parent restarts Astro with an unreachable TWENTY_BASE_URL. This process retains
    // the healthy real Twenty URL so it can prove that no row was written.
    const lead = makeLead(), response = await submit(lead);
    check(response.status === 502 && response.body.ok !== true, 'unavailable_crm_must_fail');
    check((await rowsFor(lead.submissionId)).length === 0, 'unavailable_crm_created_row');
    return { mode: 'twenty-unavailable', checks: ['error-response', 'real-crm-no-write'] };
  }
  const pageResponse = await fetch(new URL(sourcePath, site), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  check(pageResponse.ok && (await pageResponse.text()).includes('data-lead-form'), 'rendered_lead_form_missing');
  const lead = makeLead();
  check((await rowsFor(lead.submissionId)).length === 0, 'synthetic_id_not_new');
  const response = await submit(lead);
  check(response.status === 202 && response.body.ok === true && !response.body.mode && typeof response.body.id === 'string', 'real_submit_failed');
  const assertSaved = async (value, id) => {
    const rows = await rowsFor(value.submissionId);
    check(rows.length === 1 && rows[0].id === id, 'exactly_one_matching_record_required');
    const row = rows[0];
    for (const field of ['firstName', 'lastName', 'email', 'companyName', 'message', 'brandSlug', 'sourcePath', 'locale', 'submissionId', 'consent']) check(row[field] === value[field], `saved_field_${field}`);
    check(row.sourceUrl === new URL(value.sourcePath, 'https://www.reallyenglish.com').href, 'saved_source_url');
    check(row.consentVersion === 'website-enquiry-v1' && Number.isFinite(Date.parse(row.consentAt)), 'saved_consent_evidence');
    check(/^[a-f0-9]{64}$/.test(row.payloadHash), 'saved_payload_hash');
    return row;
  };
  const saved = await assertSaved(lead, response.body.id);
  const duplicate = await submit(lead);
  check(duplicate.status === 202 && duplicate.body.id === saved.id, 'retry_identity');
  check((await assertSaved(lead, saved.id)).consentAt === saved.consentAt, 'retry_changed_record');
  const conflict = await submit({ ...lead, message: 'Changed payload using the original submission UUID.' });
  check(conflict.status === 409, 'changed_retry_must_conflict');
  await assertSaved(lead, saved.id);
  const concurrent = makeLead();
  const simultaneous = await Promise.all([submit(concurrent), submit(concurrent)]);
  check(simultaneous.every(r => r.status === 202) && simultaneous[0].body.id === simultaneous[1].body.id, 'concurrent_retry_identity');
  await assertSaved(concurrent, simultaneous[0].body.id);
  const checks = ['real-create-readback', 'retry', 'changed-retry', 'concurrent-retry'];
  const cases = [
    ['tenant', { brandSlug: 'partner-demo' }, {}, 400],
    ['origin', {}, { headers: { Origin: 'https://attacker.invalid' } }, 403],
    ['missing-origin', {}, { noOrigin: true }, 403],
    ['unknown-host', {}, { headers: { Host: 'unknown.invalid' } }, 421],
    ['suffix-host', {}, { headers: { Host: 'localhost.attacker.invalid' } }, 421],
    ['consent', { consent: false }, {}, 400],
    ['consent-string', { consent: 'on' }, {}, 400],
    ['missing-consent', { consent: undefined }, {}, 400],
    ['uuid', { submissionId: 'not-a-uuid' }, {}, 400],
    ['source-origin', { sourceUrl: 'https://attacker.invalid/' }, {}, 400],
    ['source-path', { sourcePath: '/__ci_unpublished_missing__', sourceUrl: new URL('/__ci_unpublished_missing__', site).href }, {}, 400],
    ['locale', { locale: 'zz' }, {}, 400],
    ['long-field', { firstName: 'x'.repeat(81) }, {}, 400],
    ['malformed', {}, { raw: '{' }, 400],
    ['array', {}, { raw: '[]' }, 400],
    ['content-type', {}, { headers: { 'Content-Type': 'text/plain' } }, 415],
    ['body-limit', { message: 'x'.repeat(17000) }, {}, 413],
    ['honeypot', { website: 'https://bot.invalid' }, {}, 202],
  ];
  for (const [name, changes, options, status] of cases) {
    const candidate = makeLead(changes), rejected = await submit(candidate, options);
    check(rejected.status === status, `${name}_status_${rejected.status}_expected_${status}`);
    check((await rowsFor(candidate.submissionId)).length === 0, `${name}_created_record`);
    checks.push(name);
  }
  return { mode: 'twenty', checks, created: 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await verifyLeads({ unavailable: process.argv.includes('--unavailable') }))); }
  catch (error) {
    // Do not serialize upstream responses, submitted data, headers or credentials.
    console.error(`lead_verification_failed:${error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 160) : 'unknown'}`);
    process.exitCode = 1;
  }
}
