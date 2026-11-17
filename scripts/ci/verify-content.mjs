import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { readManifest, saveReport, loopback, sha256, equal } from './verify-cms.mjs';
const SOURCE = 'https://www.reallyenglish.com';
const headings = ($, root) => root.find('h1,h2,h3,h4,h5,h6').toArray().map(e => ({ tag: e.tagName, text: $(e).text() }));
const links = ($, root) => root.find('a[href]').toArray().map(e => $(e).attr('href'));
// Hash parsed bodies, not merely the self-reported data-content-hash attribute.
// Parsing both sides accounts only for HTML serialization (entities/void tags).
export function inspectPage(html, page) {
  const $ = load(html), body = $('#source-content');
  const expectedHtml = page.contentHtml.replaceAll('href="https://www.reallyenglish.com/', 'href="/');
  const expected = load(expectedHtml, {}, false), expectedRoot = expected.root();
  const errors = [];
  const check = (ok, name) => { if (!ok) errors.push(name); };
  check(body.length === 1, 'Expected exactly one source-content region');
  check($('html').attr('lang') === page.locale, 'Locale mismatch');
  check($('head title').length === 1 && $('head title').text() === page.title, 'Title mismatch');
  check($('head meta[name="description"]').length === 1 && $('head meta[name="description"]').attr('content') === page.description, 'Description mismatch');
  check($('head link[rel="canonical"]').length === 1 && $('head link[rel="canonical"]').attr('href') === page.canonical, 'Canonical mismatch');
  const alternates = $('head link[rel="alternate"][hreflang]').toArray().map(e => ({ locale: $(e).attr('hreflang'), href: $(e).attr('href') }));
  check(equal(alternates, page.alternates.map(a => ({ locale: a.locale, href: `${SOURCE}${a.path}` }))), 'Hreflang mismatch');
  check(body.attr('data-content-hash') === page.contentHash, 'Declared content hash mismatch');
  check(body.attr('data-key') === page.key, 'External key mismatch');
  const renderedBodyHash = sha256(body.html() || ''), expectedBodyHash = sha256(expectedRoot.html() || '');
  check(renderedBodyHash === expectedBodyHash, 'Rendered full-body digest mismatch');
  const actualHeadings = headings($, body), expectedHeadings = headings(expected, expectedRoot);
  check(equal(actualHeadings, expectedHeadings), 'Heading tree mismatch');
  const actualLinks = links($, body), expectedLinks = links(expected, expectedRoot);
  check(equal(actualLinks, expectedLinks), 'Links or link order mismatch');
  const internalLinks = [];
  for (const href of actualLinks) {
    try {
      const target = new URL(href, `${SOURCE}${page.path}`);
      if (target.origin !== SOURCE) continue;
      check(!href.startsWith(SOURCE) && !href.startsWith('//'), `Internal link not local: ${href}`);
      internalLinks.push({ href, path: decodeURI(target.pathname), query: target.search, fragment: target.hash });
    } catch { errors.push(`Invalid link: ${href}`); }
  }
  return { errors, renderedBodyHash, expectedBodyHash, locale: $('html').attr('lang'), headings: actualHeadings, internalLinks };
}
export async function verifyContent() {
  const reportPath = process.env.CONTENT_VERIFY_REPORT || '.ci/reports/content.json';
  const report = { success: false, pages: [], routes: [], inventory: [], errors: [] };
  try {
    const manifest = await readManifest(); report.manifestHash = manifest.manifestHash;
    const base = loopback(process.env.ASTRO_BASE_URL || process.env.SITE_BASE_URL || 'http://127.0.0.1:4321');
    const hook = JSON.parse(await readFile(process.env.CMS_VERIFY_HOOK_REPORT || '.ci/reports/cms-hook.json', 'utf8'));
    if (!hook.success || hook.manifestHash !== manifest.manifestHash || !hook.draftOnly?.path) throw new Error('Missing current CMS publication evidence');
    const dispositions = new Map();
    for (const row of manifest.dispositions || []) {
      if (dispositions.has(row.url)) throw new Error(`Duplicate disposition: ${row.url}`);
      dispositions.set(row.url, row);
    }
    for (const row of manifest.discovered || []) {
      const terminal = dispositions.get(row.url);
      report.inventory.push({ ...row, terminal });
      if (!terminal) report.errors.push(`No terminal disposition: ${row.url}`);
    }
    if (report.inventory.length !== dispositions.size || !report.inventory.length) report.errors.push('Discovered/terminal sets differ');
    const request = (path) => fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    for (const page of manifest.pages) {
      const row = { key: page.key, path: page.path, sourceHash: page.contentHash, success: false, errors: [] };
      report.pages.push(row);
      try {
        const response = await request(page.path); row.status = response.status;
        if (response.status !== 200) throw new Error(`Expected exact-route 200 without redirect, got ${response.status}`);
        if (!/^text\/html\b/i.test(response.headers.get('content-type') || '')) throw new Error('Not HTML');
        if (new URL(response.url).pathname !== new URL(page.path, base).pathname) throw new Error('Response path mismatch');
        const html = await response.text();
        Object.assign(row, inspectPage(html, page));
        if (html.includes(hook.draftOnly.sentinel)) row.errors.push('Draft sentinel leaked');
        const seed = hook.pages.filter(p => p.key === page.key);
        if (seed.length !== 1 || seed[0].path !== page.path || seed[0].contentHash !== page.contentHash) row.errors.push('CMS/rendered key join failed');
        else row.documentId = seed[0].documentId;
        for (const link of row.internalLinks) {
          if (!link.href.startsWith('#')) {
            const url = new URL(link.href, `${SOURCE}${page.path}`); url.hash = '';
            const disposition = dispositions.get(url.href);
            link.disposition = disposition?.disposition;
            link.sourceStatus = disposition?.status;
            // Query/asset exclusions are evidence, not successful route coverage.
            if (!disposition && !(manifest.excluded || []).some(e => e.url === url.href)) row.errors.push(`Uninventoried internal link: ${link.href}`);
          }
        }
        row.success = !row.errors.length;
      } catch (error) { row.errors.push(error.message); }
    }
    const checks = [...(manifest.failed || []).map(p => ({ path: p.path, expected: 404, kind: 'source-failure', sourceStatus: p.status })), { path: hook.draftOnly.path, expected: 404, kind: 'stored-draft' }];
    for (const redirect of manifest.redirects || []) {
      const from = new URL(redirect.from), to = new URL(redirect.to);
      checks.push({ path: from.pathname + from.search, expected: redirect.status, location: to.pathname + to.search + to.hash, kind: 'source-redirect' });
    }
    for (const check of checks) {
      const row = { ...check, success: false }; report.routes.push(row);
      try {
        const response = await request(check.path); row.status = response.status;
        row.success = response.status === check.expected;
        if (check.location) {
          row.location = response.headers.get('location');
          const target = new URL(row.location || '', base);
          row.success &&= Boolean(row.location) && target.origin === base && target.pathname + target.search + target.hash === check.location;
        }
      } catch (error) { row.error = error.message; }
    }
    report.sourceDefects = manifest.sourceDefects;
    report.editorialSuccess = manifest.editorialSuccess;
    report.success = !report.errors.length && report.pages.length === manifest.pages.length && report.pages.every(p => p.success) && report.routes.every(p => p.success);
  } catch (error) { report.errors.push(error.message); }
  await saveReport(reportPath, report);
  console.log(JSON.stringify({ report: reportPath, success: report.success, pages: report.pages.length, routes: report.routes.length }));
  if (!report.success) process.exitCode = 1;
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await verifyContent();
