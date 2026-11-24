import { configuredBrand } from './site';
import { projectPage, sanitizeContent, normalizeRoute, type PublicPage } from '../../apps/cms/src/seed/content-contract';
export type SitePage = PublicPage;
export async function loadCmsPage(host: string, path: string): Promise<SitePage | null | Response> {
  const brand = configuredBrand(host);
  if (brand?.slug !== 'reallyenglish') return null;
  const base = process.env.CMS_API_URL;
  const token = process.env.CMS_READ_TOKEN;
  const unavailable = () => new Response('Content unavailable', {status:503, headers:{'Cache-Control':'no-store'}});
  try { if (normalizeRoute(path) !== path) return null; } catch { return null; }
  if (!base || !token) return unavailable();
  try {
    const endpoint = new URL('/api/site/page', base);
    endpoint.search = new URLSearchParams({ brand: brand.slug, path }).toString();
    const response = await fetch(endpoint, {headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'error'});
    if (response.status === 404) return null;
    if (!response.ok) return unavailable();
    const page = projectPage(await response.json());
    if (page.path !== path || sanitizeContent(page.contentHtml) !== page.contentHtml) return unavailable();
    return page;
  } catch { return unavailable(); }
}