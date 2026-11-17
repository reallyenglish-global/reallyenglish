import crypto from 'node:crypto';
import {normalizeRoute,projectPage} from '../../../seed/content-contract';
import type { Core } from '@strapi/strapi';

const timingSafeMatch = (actual: string, expected: string) => {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export default ({ strapi }: { strapi: Core.Strapi }) => ({
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
      fields: ['path', 'locale', 'title', 'description', 'canonical', 'alternates', 'contentHtml', 'contentHash', 'externalKey', 'sourceUrl', 'slug'],
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