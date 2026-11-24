import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {normalizeRoute,projectPage} from '../../../seed/content-contract';
import type { Core } from '@strapi/strapi';

const timingSafeMatch = (actual: string, expected: string) => {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async ciPublication(ctx: any) {
    if(process.env.CI !== 'true' || process.env.CMS_VERIFY_HOOK !== 'true')return ctx.notFound();
    const token=process.env.CMS_CI_WRITE_TOKEN;
    const supplied=String(ctx.request.headers.authorization || '').replace(/^Bearer\s+/i,'');
    if(!token || !timingSafeMatch(supplied,token))return ctx.unauthorized();
    const action=ctx.request.body?.action;
    if(!['publish','draft-update','unpublish'].includes(action) || Object.keys(ctx.request.body).length!==1)return ctx.badRequest();
    // No client-selected ID/path/content: mutate only the synthetic startup probe.
    const hook=JSON.parse(await readFile(process.env.CMS_VERIFY_HOOK_REPORT!,'utf8'));
    const probe=hook.draftOnly;
    if(!hook.success || !probe?.path?.startsWith('/ci-draft-'))return ctx.badRequest();
    const docs:any=strapi.documents('api::page.page');
    const draft=await docs.findOne({documentId:probe.documentId,status:'draft'});
    if(!draft || draft.path!==probe.path || draft.externalKey!==probe.key)return ctx.badRequest();
    if(action==='draft-update'){
      await docs.update({documentId:probe.documentId,data:{contentHtml:`<p class="editor-style">${probe.sentinel}_LIVE</p>`}});
    }else if(action==='publish')await docs.publish({documentId:probe.documentId});
    else await docs.unpublish({documentId:probe.documentId});
    ctx.body={ok:true};
  },
  async page(ctx: any) {
    const token = process.env.CMS_READ_TOKEN;
    const supplied = String(ctx.request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token || !timingSafeMatch(supplied, token)) return ctx.unauthorized();
    const { brand, path } = ctx.query;
    if (Object.keys(ctx.query).some((key) => !['brand', 'path'].includes(key)) || brand !== 'reallyenglish' ||
      typeof path !== 'string' || !path.startsWith('/') || path.length > 1024 || path.includes('..') || path.includes('\\\\')) {
      return ctx.badRequest('invalid_query');
    }
    const result = await strapi.documents('api::page.page').findFirst({
      filters: { path, brand: {slug:brand} }, status: 'published',
      fields: ['path', 'locale', 'title', 'description', 'canonical', 'alternates', 'contentHtml', 'contentHash', 'externalKey', 'sourceUrl', 'slug', 'navigation', 'footer'],
    });
    if (!result) return ctx.notFound();
    ctx.set('Cache-Control', 'no-store');
    ctx.body = projectPage(result);
  },
  async brand(ctx: any) {
    const token = process.env.CMS_READ_TOKEN;
    const supplied = String(ctx.request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token || !timingSafeMatch(supplied, token)) return ctx.unauthorized();
    const { brand } = ctx.query;
    if (brand !== 'reallyenglish' && brand !== 'partner-demo') {
      return ctx.badRequest('invalid_brand');
    }
    const result = await strapi.documents('api::brand.brand').findFirst({
      filters: { slug: brand }, status: 'published',
      fields: ['slug', 'name', 'logoText', 'primaryColor', 'accentColor', 'hostname'],
    });
    if (!result) return ctx.notFound();
    ctx.set('Cache-Control', 'no-store');
    ctx.body = result;
  },
});