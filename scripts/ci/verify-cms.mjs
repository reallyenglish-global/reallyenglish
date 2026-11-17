import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function loopback(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Verifier requires a plain HTTP loopback origin');
  return url.origin;
}
export async function readManifest(path = process.env.PUBLIC_CONTENT_MANIFEST || '.ci/content/manifest.json') {
  const m = JSON.parse(await readFile(path, 'utf8'));
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
  const { manifestHash, ...body } = m;
  if (sha256(canonical(body)) !== manifestHash) throw new Error('Manifest digest mismatch');
  if (m.technicalSuccess !== true || !m.pages?.length || !Array.isArray(m.pending) || m.pending.length) throw new Error('Manifest is incomplete');
  const known404 = new Set(['/blog/author/linkedin.com/in/richarddigitaledu', '/blog/author/richard-mchugh/page/linkedin.com/in/richarddigitaledu', '/blog/linkedin.com/in/richarddigitaledu']);
  if (!Array.isArray(m.failed) || m.failed.some(p => p.status !== 404 || !known404.has(p.path)) || m.inventoryIssues?.length) throw new Error('Unresolved inventory failures');
  if (new Set(m.pages.map(p => p.path)).size !== m.pages.length || new Set(m.pages.map(p => p.key)).size !== m.pages.length) throw new Error('Duplicate manifest path/key');
  const terminal = new Map((m.dispositions || []).map(d => [d.url, d]));
  if (!m.discovered?.length || terminal.size !== m.dispositions?.length || terminal.size !== m.discovered.length || new Set(m.discovered.map(d => d.url)).size !== m.discovered.length || m.discovered.some(d => !terminal.has(d.url))) throw new Error('Discovered/terminal inventory mismatch');
  const pageRows = [...terminal.values()].filter(d => d.disposition === 'page');
  if (pageRows.length !== m.pages.length || pageRows.some(d => !m.pages.some(p => p.key === d.key && p.path === d.path && p.source.url === d.url))) throw new Error('Terminal/page inventory mismatch');
  if ((m.redirects || []).some(d => !terminal.has(d.from) || !terminal.has(d.to))) throw new Error('Unaccounted redirect endpoint');
  for (const p of m.pages) {
    if (!p.path.startsWith('/') || p.path.startsWith('//') || /[?#\\\s]/.test(p.path) || sha256(`reallyenglish\0${p.path}`) !== p.key || sha256(p.contentHtml) !== p.contentHash) throw new Error(`Invalid manifest page: ${p.path}`);
  }
  return m;
}
export async function saveReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
}
export async function verifyCms() {
  const reportPath = process.env.CMS_VERIFY_REPORT || '.ci/reports/cms.json';
  const report = { success: false, pages: [], checks: [], errors: [] };
  try {
    const manifest = await readManifest(); report.manifestHash = manifest.manifestHash;
    const base = loopback(process.env.CMS_API_URL || 'http://127.0.0.1:1337');
    const token = process.env.CMS_READ_TOKEN;
    if (!token) throw new Error('CMS_READ_TOKEN required');
    const hook = JSON.parse(await readFile(process.env.CMS_VERIFY_HOOK_REPORT || '.ci/reports/cms-hook.json', 'utf8'));
    const names = ['secondSeedIdentity', 'draftOnlyAbsent', 'publishVisible', 'draftUpdateIsolated', 'publishedUpdateVisible', 'unpublishAbsent'];
    if (hook.success !== true || hook.manifestHash !== manifest.manifestHash || names.some(n => hook.checks?.[n] !== true) || hook.pages?.length !== manifest.pages.length || !hook.draftOnly?.path) throw new Error('Missing or mismatched real CMS hook evidence');
    const request = (path, auth = true, extra = {}) => {
      const url = new URL('/api/site/page', base);
      url.search = new URLSearchParams({ brand: 'reallyenglish', path, ...extra }).toString();
      return fetch(url, { headers: auth ? { Authorization: `Bearer ${token}` } : {}, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    };
    for (const p of manifest.pages) {
      const row = { key: p.key, path: p.path, contentHash: p.contentHash, success: false, errors: [] };
      report.pages.push(row);
      try {
        const evidence = hook.pages.filter(x => x.key === p.key);
        if (evidence.length !== 1 || evidence[0].path !== p.path || evidence[0].contentHash !== p.contentHash || !evidence[0].documentId || evidence[0].idempotent !== true) throw new Error('Seed identity evidence mismatch');
        row.documentId = evidence[0].documentId;
        const response = await request(p.path); row.status = response.status;
        if (response.status !== 200) throw new Error(`Expected 200, got ${response.status}`);
        const actual = await response.json();
        const expected = { path: p.path, externalKey: p.key, locale: p.locale, title: p.title, description: p.description, canonical: p.canonical, alternates: p.alternates, contentHtml: p.contentHtml, contentHash: p.contentHash, sourceUrl: p.source.url };
        for (const [key, value] of Object.entries(expected)) if (!equal(actual[key], value)) row.errors.push(`Mismatch: ${key}`);
        if (sha256(actual.contentHtml) !== p.contentHash) row.errors.push('Body hash mismatch');
        if (JSON.stringify(actual).includes(hook.draftOnly.sentinel)) row.errors.push('Draft sentinel leaked');
        row.success = !row.errors.length;
      } catch (error) { row.errors.push(error.message); }
    }
    for (const [name, path, auth, extra, expected] of [
      ['read-token-required', manifest.pages[0].path, false, {}, 401],
      ['draft-only-hidden', hook.draftOnly.path, true, {}, 404],
      ['tenant-query-rejected', manifest.pages[0].path, true, { brand: 'partner-demo' }, 400],
      ['draft-query-rejected', manifest.pages[0].path, true, { status: 'draft' }, 400],
    ]) {
      try { const r = await request(path, auth, extra); report.checks.push({ name, path, status: r.status, expected, success: r.status === expected }); }
      catch (e) { report.checks.push({ name, path, success: false, error: e.message }); }
    }
    report.success = report.pages.length === manifest.pages.length && report.pages.every(p => p.success) && report.checks.every(c => c.success);
  } catch (error) { report.errors.push(error.message); }
  await saveReport(reportPath, report);
  console.log(JSON.stringify({ report: reportPath, success: report.success, pages: report.pages.length }));
  if (!report.success) process.exitCode = 1;
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await verifyCms();
