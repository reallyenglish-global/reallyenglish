import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { normalizePage } from './normalize-page.mjs';
import { normalizePath, sourceUrl, resolveReference, queryDisposition, SOURCE_ORIGIN as ROOT } from './source-policy.mjs';
import { getSource } from './fetch-source.mjs';

export const KNOWN_404 = new Set(['/blog/author/linkedin.com/in/richarddigitaledu', '/blog/author/richard-mchugh/page/linkedin.com/in/richarddigitaledu', '/blog/linkedin.com/in/richarddigitaledu']);
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const array = (x) => x == null ? [] : Array.isArray(x) ? x : [x];
export function parseSitemap(xml, base) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('sitemap_doctype_denied');
  if (XMLValidator.validate(xml) !== true) throw new Error('malformed_sitemap');
  const doc = new XMLParser({ removeNSPrefix: true, parseTagValue: false, ignoreAttributes: true, processEntities: true }).parse(xml);
  const roots = Object.keys(doc).filter((k) => !k.startsWith('?'));
  if (roots.length !== 1 || !['urlset','sitemapindex'].includes(roots[0])) throw new Error('unsupported_sitemap');
  const root = roots[0];
  const entries = array(doc[root]?.[root === 'urlset' ? 'url' : 'sitemap']).map((entry) => {
    if (typeof entry.loc !== 'string' || !entry.loc.trim()) throw new Error('sitemap_empty_loc');
    const originalUrl = entry.loc.trim();
    const url = resolveReference(originalUrl, base);
    sourceUrl(url.href);
    return { url: url.href, originalUrl, lastmod: typeof entry.lastmod === 'string' ? entry.lastmod : undefined };
  });
  return { root, entries };
}
export function pageLinks(html, base) {
  const $ = load(html);
  return $('a[href]').toArray().map((el) => {
    const raw = $(el).attr('href');
    try {
      const url = resolveReference(raw, base);
      if (url.origin !== ROOT) return { url: url.href, reason: 'external_link' };
      if (raw.startsWith('#')) return { url: url.href, reason: 'same_page_fragment' };
      return { url: url.href };
    } catch { return { url: raw, reason: 'unsafe_reference' }; }
  });
}
export async function importPublicSite({ output = '.ci/content/manifest.json', maxPages = 1000, maxSitemaps = 50, maxTotalBytes = 200_000_000, minIntervalMs = 250, enforceBaseline = true, get = getSource } = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000 || !Number.isInteger(maxSitemaps) || maxSitemaps < 1 || maxSitemaps > 50 || !Number.isFinite(minIntervalMs) || minIntervalMs < 0) throw new Error('invalid_limits');
  const started = Date.now(); let bytes = 0; let nextSlot = 0;
  const discovered = new Map(), terminal = new Map(), queue = new Map(), pages = new Map();
  const redirects = [], excluded = [], failed = [], fetched = [], sitemaps = [], inventoryIssues = [];
  const schedule = async () => { const at = Math.max(Date.now(), nextSlot); nextSlot = at + minIntervalMs; await new Promise((r) => setTimeout(r, at - Date.now())); };
  const fetch = (url) => get(url, { schedule, onResponse: (r) => { bytes += r.bytes ?? Buffer.byteLength(r.body); if (bytes > maxTotalBytes) throw new Error('total_body_limit'); } });
  const discover = (href, discoveredBy, extra = {}) => {
    const url = sourceUrl(href); const path = normalizePath(href);
    url.hash = ''; const id = url.href;
    if (!discovered.has(id)) discovered.set(id, { url: id, path, discoveredBy, ...extra });
    const reason = queryDisposition(url) || (/^\/(?:api|health|admin)(?:\/|$)/.test(path) ? 'reserved_route' : null);
    if (reason) {
      terminal.set(id, { url: id, path, disposition: 'excluded', reason });
      excluded.push({ url: id, path, reason });
      if (reason === 'tracking_query') { url.search = ''; discover(url.href, discoveredBy); }
    } else if (!terminal.has(id) && !queue.has(id)) queue.set(id, { url: id, path, ...extra });
    return id;
  };
  const snapshot = () => {
    const sort = (list) => [...list].sort((a,b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    const unique = (list) => [...new Map(list.map((x) => [canonicalJson(x),x])).values()];
    const manifest = { version: 1, importerVersion: '1.1.0', generatedAt: new Date().toISOString(),
      sourceSitemapHashes: sitemaps.map((s) => s.hash), sitemaps: sort(sitemaps),
      discovered: sort(discovered.values()), dispositions: sort(terminal.values()), fetched: sort(fetched),
      redirects: sort(unique(redirects)), excluded: sort(unique(excluded)), failed: sort(failed),
      pending: [...discovered.keys()].filter((url) => !terminal.has(url)).sort(), pages: sort(pages.values()),
      sourceDefects: failed.filter((x) => x.status === 404).map((x) => ({ ...x, known: KNOWN_404.has(x.path) })),
      inventoryIssues, totalBytes: bytes, elapsedMs: Date.now() - started,
      baseline: { sitemapPaths: 112, requestedPaths: 179, known404Paths: [...KNOWN_404] },
    };
    manifest.coverage = { sitemapPaths: new Set(manifest.discovered.filter((x) => x.discoveredBy === 'sitemap').map((x) => x.path)).size,
      requestedPaths: new Set(manifest.discovered.filter((x) => !new URL(x.url).search).map((x) => x.path)).size,
      discovered: discovered.size, terminal: terminal.size, pending: manifest.pending.length };
    manifest.technicalSuccess = !manifest.pending.length && !inventoryIssues.length && failed.every((x) => x.status === 404 && KNOWN_404.has(x.path));
    manifest.editorialSuccess = manifest.technicalSuccess && !failed.length;
    manifest.manifestHash = hash(canonicalJson(manifest));
    return manifest;
  };
  const persist = async () => {
    const manifest = snapshot();
    if (output !== null) { const dest = resolve(output); await mkdir(dirname(dest), { recursive: true }); await writeFile(`${dest}.tmp`, `${JSON.stringify(manifest,null,2)}\n`, { mode: 0o600 }); await rename(`${dest}.tmp`, dest); }
    return manifest;
  };
  const seenMaps = new Set();
  const visit = async (url, ancestors = new Set()) => {
    if (ancestors.has(url)) { inventoryIssues.push({ url, reason: 'sitemap_cycle' }); return; }
    if (seenMaps.has(url)) { inventoryIssues.push({ url, reason: 'duplicate_sitemap' }); return; }
    if (seenMaps.size >= maxSitemaps) throw new Error('sitemap_limit');
    seenMaps.add(url);
    const response = await fetch(url);
    if (response.status !== 200) throw new Error(`sitemap_http_${response.status}`);
    sitemaps.push({ url, finalUrl: response.url, hash: hash(response.body), redirects: response.chain });
    const parsed = parseSitemap(response.body, response.url);
    for (const entry of parsed.entries) {
      if (parsed.root === 'sitemapindex') await visit(entry.url, new Set([...ancestors,url]));
      else {
        if (discovered.has(entry.url)) inventoryIssues.push({ url: entry.url, reason: 'duplicate_sitemap_url' });
        discover(entry.url, 'sitemap', { originalUrl: entry.originalUrl, lastmod: entry.lastmod });
      }
    }
  };
  try { await visit(`${ROOT}/sitemap.xml`); } catch (error) { inventoryIssues.push({ reason: error.message }); }
  let attempted = 0;
  const processItem = async (item) => {
    let finalUrl = item.url;
    try {
      const result = await fetch(item.url);
      finalUrl = result.url;
      for (const redirect of result.chain) {
        const from = discover(redirect.from, 'redirect_source');
        discover(redirect.to, 'redirect_target');
        terminal.set(from, { url: from, path: normalizePath(from), disposition: 'redirect', to: redirect.to, status: redirect.status });
        queue.delete(from); redirects.push(redirect);
      }
      const id = discover(result.url, 'redirect_target'); queue.delete(id);
      const path = normalizePath(id);
      if (terminal.has(id)) return;
      const source = { url: id, path, status: result.status, fetchedAt: new Date().toISOString(), rawHash: hash(result.body), bytes: Buffer.byteLength(result.body) };
      fetched.push(source);
      if (result.status !== 200) { failed.push(source); terminal.set(id, { ...source, disposition: 'failed' }); return; }
      const type = result.headers['content-type'] || '';
      if (!/^text\/html(?:;|$)/i.test(type)) { const row = { url: id, path, reason: 'non_html', contentType: type }; excluded.push(row); terminal.set(id, { ...row, disposition: 'excluded' }); return; }
      // Inventory is independent of extraction success.
      for (const link of pageLinks(result.body, id)) {
        if (link.reason) { excluded.push({ ...link, discoveredBy: id }); continue; }
        discover(link.url, id);
      }
      const record = normalizePage(result.body,id);
      record.source = { ...record.source, fetchedAt: source.fetchedAt, lastmod: discovered.get(id)?.lastmod ?? item.lastmod };
      pages.set(path,record); terminal.set(id, { url: id, path, disposition: 'page', key: record.key });
    } catch (error) {
      for (const redirect of error.chain || []) {
        const from = discover(redirect.from, 'redirect_source');
        discover(redirect.to, 'redirect_target');
        terminal.set(from, { url: from, path: normalizePath(from), disposition: 'redirect', to: redirect.to, status: redirect.status });
        queue.delete(from); redirects.push(redirect);
      }
      const failedUrl = error.chain?.at(-1)?.to || error.requestUrl || finalUrl;
      const id = discover(failedUrl, 'failed_request'); queue.delete(id);
      const row = { url: id, path: normalizePath(id), error: error.message };
      failed.push(row);
      terminal.set(id, { ...row, disposition: 'failed' });
    }
  };
  while (queue.size && bytes <= maxTotalBytes) {
    for (const id of queue.keys()) if (terminal.has(id)) queue.delete(id);
    if (!queue.size) break;
    if (attempted >= maxPages) { inventoryIssues.push({ reason: 'page_limit' }); break; }
    const batch = [...queue.values()].slice(0, Math.min(3, maxPages - attempted));
    for (const item of batch) queue.delete(item.url);
    attempted += batch.length;
    await Promise.all(batch.map(processItem));
    await persist();
  }
  if (enforceBaseline) {
    const report = snapshot();
    if (report.coverage.sitemapPaths < 112 || report.coverage.requestedPaths < 179) inventoryIssues.push({ reason: 'inventory_below_reviewed_baseline', observed: report.coverage });
    for (const path of KNOWN_404) if (![...discovered.values()].some((item) => item.path === path)) inventoryIssues.push({ reason: 'known_defect_missing_from_inventory', path });
  }
  return persist();
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); const index = Math.max(args.indexOf('--out'),args.indexOf('--output'));
  const maxIndex = args.indexOf('--max-pages');
  importPublicSite({ ...(index >= 0 ? { output: args[index+1] } : {}), ...(maxIndex >= 0 ? { maxPages: Number(args[maxIndex+1]) } : {}) }).then((m) => {
    console.log(JSON.stringify({ coverage: m.coverage, technicalSuccess: m.technicalSuccess, editorialSuccess: m.editorialSuccess, failed: m.failed.length, manifestHash: m.manifestHash },null,2));
    if (!m.technicalSuccess) process.exitCode = 1;
  }).catch((e) => { console.error(e); process.exitCode = 1; });
}
