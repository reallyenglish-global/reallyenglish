import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import crypto from 'node:crypto';
import { sha256, isHash, isLocale, normalizeRoute, sourceUrl, sanitizeContent, projectPage } from './content-contract';

type ManifestPage = {
  key: string; brand: string; path: string; locale: string; title: string; description: string;
  canonical: string; alternates: unknown[]; contentHtml: string; contentHash: string;
  source: { url: string; fetchedAt: string; rawHash: string };
  assets: unknown[];
};

function validPage(row: unknown): row is ManifestPage {
  if (!row || typeof row !== 'object') return false;
  const page = row as Partial<ManifestPage>;
  return typeof page.key === 'string' && /^[a-f0-9]{64}$/.test(page.key) && page.brand === 'reallyenglish' &&
    typeof page.path === 'string' && page.path.startsWith('/') && !page.path.includes('..') && !page.path.includes('\\\\') &&
    typeof page.locale === 'string' && typeof page.title === 'string' && typeof page.contentHtml === 'string' &&
    typeof page.contentHash === 'string' && typeof page.source?.url === 'string' && page.source.url.startsWith('https://www.reallyenglish.com') &&
    typeof page.source.fetchedAt === 'string' && Array.isArray(page.assets) && Array.isArray(page.alternates);
}

export async function seedPublicContent(strapi: any) {
  if (process.env.SEED_PUBLIC_CONTENT !== 'true') return;
  const manifestPath = process.env.PUBLIC_CONTENT_MANIFEST;
  if (!manifestPath) throw new Error('PUBLIC_CONTENT_MANIFEST is required when seeding is enabled');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const known404 = new Set(['/blog/author/linkedin.com/in/richarddigitaledu', '/blog/author/richard-mchugh/page/linkedin.com/in/richarddigitaledu', '/blog/linkedin.com/in/richarddigitaledu']);
  if (!Array.isArray(manifest.pages) || !manifest.pages.length || manifest.pending?.length || manifest.technicalSuccess !== true || manifest.failed.some((f: any) => f.status !== 404 || !known404.has(f.path))) throw new Error('Public content manifest is incomplete');
  const pages = manifest.pages as ManifestPage[];
  if (pages.some((page) => !validPage(page)) || new Set(pages.map((page) => page.key)).size !== pages.length) {
    throw new Error('Public content manifest contains invalid or duplicate pages');
  }
  // Seed/brands first
  const brands = strapi.documents('api::brand.brand');
  const brandData = { slug: 'reallyenglish', name: 'ReallyEnglish', logoText: 'reallyenglish', hostname: 'www.reallyenglish.com', primaryColor: '#135b4a', accentColor: '#d8f3e8' };
  let brand = await brands.findFirst({ filters: { slug: 'reallyenglish' } });
  if (brand) brand = await brands.update({ documentId: brand.documentId, data: brandData });
  else brand = await brands.create({ data: brandData });
  await strapi.documents('api::brand.brand').publish({ documentId: brand.documentId });

  const docs = strapi.documents('api::page.page');
  const report: Array<{ key: string; documentId: string; contentHash: string; status: string }> = [];
  for (const item of pages) {
    // Validate using contract before any DB operation
    const validated = projectPage({ ...item, externalKey: item.key, sourceUrl: item.source.url, canonical: item.canonical });
    // Reject unsafe stored markup rather than trusting the importer.
    const sanitized = sanitizeContent(validated.contentHtml);
    if (sanitized !== validated.contentHtml) throw new Error(`unsafe_content:${item.path}`);
    let existing = await docs.findFirst({ filters: { externalKey: validated.externalKey } });
    if (existing) {
      // Validate existing document shape too
      try { await projectPage(existing as any); } catch { /* keep existing, below handles update path */ }
    }
    const data = {
      externalKey: validated.externalKey, path: validated.path, locale: validated.locale, title: validated.title,
      description: validated.description, canonical: validated.canonical, alternates: validated.alternates,
      contentHtml: validated.contentHtml, sourceUrl: validated.sourceUrl, sourceFetchedAt: item.source.fetchedAt,
      sourceRawHash: item.source.rawHash, contentHash: validated.contentHash, assets: item.assets,
      slug: crypto.createHash('sha256').update(validated.path).digest('hex').slice(0, 32),
      brand: { connect: [{ documentId: brand.documentId }] },
    };
    if (existing && existing.path !== validated.path) throw new Error(`Manifest key/path mismatch for ${validated.externalKey}`);
    if (existing && existing.contentHash === validated.contentHash) {
      const published = await docs.findFirst({ filters: { externalKey: validated.externalKey }, status: 'published' });
      if (!published) await docs.publish({ documentId: existing.documentId });
      report.push({ key: validated.externalKey, documentId: existing.documentId, contentHash: validated.contentHash, status: 'unchanged' });
      continue;
    }
    const result = existing ? await docs.update({documentId: existing.documentId, data}) : await docs.create({ data });
    await docs.publish({ documentId: result.documentId });
    report.push({ key: validated.externalKey, documentId: result.documentId, contentHash: validated.contentHash, status: 'created' });
  }
  if (process.env.PUBLIC_CONTENT_SEED_REPORT) {
    await mkdir(dirname(process.env.PUBLIC_CONTENT_SEED_REPORT), {recursive:true});
    await writeFile(process.env.PUBLIC_CONTENT_SEED_REPORT, JSON.stringify({pages:report}));
  }
  strapi.log.info(`Public content seed complete: ${report.length} pages`);
}