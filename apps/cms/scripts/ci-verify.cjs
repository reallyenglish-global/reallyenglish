'use strict';
// Call once AFTER seedPublicContent, before readiness. Never enable outside disposable CI.
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { dirname } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const assert = (ok, message) => { if (!ok) throw new Error(message); };
module.exports = async function verifyCms(strapi, { seedPublicContent, manifestPath = process.env.PUBLIC_CONTENT_MANIFEST, reportPath = process.env.CMS_VERIFY_HOOK_REPORT || '.ci/reports/cms-hook.json' } = {}) {
  assert(process.env.CI === 'true' && process.env.SEED_PUBLIC_CONTENT === 'true', 'CMS verification requires disposable CI and enabled seed');
  assert(typeof seedPublicContent === 'function', 'Pass the real seedPublicContent function');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert(manifest.technicalSuccess === true && manifest.pages?.length && !manifest.pending?.length, 'Incomplete manifest');
  const docs = strapi.documents('api::page.page');
  const report = { manifestHash: manifest.manifestHash, success: false, layer: 'real-strapi-document-service', pages: [], checks: {}, draftOnly: null };
  let probeId;
  const inventory = async (status) => {
    const rows = []; let start = 0;
    for (;;) {
      const batch = await docs.findMany({ status, filters: { brand: { slug: 'reallyenglish' } }, start, limit: 100, sort: ['externalKey:asc'] });
      rows.push(...batch); if (batch.length < 100) break; start += batch.length;
    }
    return rows;
  };
  try {
    const before = await inventory('published');
    const draftsBefore = await inventory('draft');
    assert(before.length === manifest.pages.length && draftsBefore.length === manifest.pages.length, 'Initial inventory count mismatch');
    await seedPublicContent(strapi);
    const after = await inventory('published');
    const draftsAfter = await inventory('draft');
    assert(after.length === before.length && draftsAfter.length === draftsBefore.length, 'Second seed changed document count');
    for (const page of manifest.pages) {
      const a = before.filter((x) => x.externalKey === page.key), b = after.filter((x) => x.externalKey === page.key);
      const da = draftsBefore.filter((x) => x.externalKey === page.key), db = draftsAfter.filter((x) => x.externalKey === page.key);
      assert(a.length === 1 && b.length === 1 && da.length === 1 && db.length === 1, `Duplicate/missing key: ${page.path}`);
      assert(a[0].documentId === b[0].documentId && da[0].documentId === db[0].documentId && b[0].documentId === db[0].documentId, `Seed identity changed: ${page.path}`);
      assert(a[0].publishedAt === b[0].publishedAt && a[0].id === b[0].id, `Unchanged page republished: ${page.path}`);
      assert(b[0].path === page.path && b[0].contentHash === page.contentHash && hash(b[0].contentHtml) === page.contentHash, `Seed content mismatch: ${page.path}`);
      report.pages.push({ key: page.key, path: page.path, documentId: b[0].documentId, contentHash: b[0].contentHash, idempotent: true });
    }
    report.checks.secondSeedIdentity = true;
    // An isolated synthetic document avoids editing imported editorial content.
    const path = `/ci-draft-${randomUUID()}`;
    const sentinel = `CI_DRAFT_${randomUUID()}`;
    const brand = await strapi.documents('api::brand.brand').findFirst({ filters: { slug: 'reallyenglish' }, status: 'published' });
    const data = { externalKey: hash(`reallyenglish\0${path}`), path, slug: hash(path).slice(0, 32), locale: 'en', title: sentinel, description: 'Synthetic CI publication probe', canonical: `https://www.reallyenglish.com${path}`, alternates: [], contentHtml: `<p>${sentinel}</p>`, sourceUrl: `https://www.reallyenglish.com${path}`, sourceFetchedAt: new Date().toISOString(), sourceRawHash: hash(sentinel), contentHash: hash(`<p>${sentinel}</p>`), assets: [], brand: { connect: [{ documentId: brand.documentId }] } };
    const probe = await docs.create({ data }); probeId = probe.documentId;
    const published = () => docs.findOne({ documentId: probeId, status: 'published' });
    assert(!(await published()), 'Draft-only document leaked into published status');
    report.checks.draftOnlyAbsent = true;
    await docs.publish({ documentId: probeId });
    assert((await published())?.title === sentinel, 'Publish not visible');
    report.checks.publishVisible = true;
    const changed = `${sentinel}_UPDATED`, contentHtml = `<p>${changed}</p>`;
    await docs.update({ documentId: probeId, data: { title: changed, contentHtml } });
    assert((await published())?.title === sentinel, 'Draft update leaked before publish');
    assert((await docs.findOne({ documentId: probeId, status: 'draft' }))?.title === changed, 'Draft update missing');
    report.checks.draftUpdateIsolated = true;
    await docs.publish({ documentId: probeId });
    const updated = await published();
    assert(updated?.title === changed && updated.contentHash === hash(contentHtml) && hash(updated.contentHtml) === hash(contentHtml), 'Published update missing');
    report.checks.publishedUpdateVisible = true;
    await docs.unpublish({ documentId: probeId });
    assert(!(await published()), 'Unpublish still visible');
    report.checks.unpublishAbsent = true;
    // Keep this draft until HTTP checks finish, proving a real stored draft returns 404.
    report.draftOnly = { path, key: data.externalKey, documentId: probeId, sentinel: changed };
    report.success = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
};
