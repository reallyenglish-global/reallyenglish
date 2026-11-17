import { defineMiddleware } from 'astro:middleware';
import { readFileSync } from 'node:fs';
import { configuredBrand } from './lib/site';
import { normalizeRoute, sourceUrl } from '../apps/cms/src/seed/content-contract';
const redirects = new Map<string,{to:string,status:number}>();
// Redirect configuration only; page bodies always come from published Strapi.
if (process.env.PUBLIC_CONTENT_MANIFEST) {
  const manifest = JSON.parse(readFileSync(process.env.PUBLIC_CONTENT_MANIFEST,'utf8'));
  if (manifest.technicalSuccess !== true) throw new Error('incomplete_route_manifest');
  for (const row of manifest.redirects || []) {
    const from=new URL(row.from), to=new URL(row.to);
    if (!sourceUrl(row.from) || !sourceUrl(row.to) || ![301,302,303,307,308].includes(row.status)) throw new Error('invalid_route_redirect');
    redirects.set(normalizeRoute(from.pathname),{to:normalizeRoute(to.pathname),status:row.status});
  }
}
export const onRequest = defineMiddleware(async(context,next)=>{
  const brand=configuredBrand(context.request.headers.get('host') || '');
  if(brand?.slug==='reallyenglish' && ['GET','HEAD'].includes(context.request.method)) {
    const redirect=redirects.get(context.url.pathname);
    if(redirect) return new Response(null,{status:redirect.status,headers:{Location:redirect.to}});
  }
  return next();
});
