import { configuredBrand } from './site';
import { projectPage, sanitizeContent, normalizeRoute, type PublicPage } from '../../apps/cms/src/seed/content-contract';
export type SitePage = PublicPage;
export async function loadCmsPage(host: string, path: string): Promise<SitePage | null> {
  const brand = configuredBrand(host);
  if (brand?.slug !== 'reallyenglish') return null;
  const base = process.env.CMS_API_URL;
  const token = process.env.CMS_READ_TOKEN;
  if (!base || !token) return null;
  try {
    if (normalizeRoute(path) !== path) return null;
    const endpoint = new URL('/api/site/page', base);
    endpoint.search = new URLSearchParams({ brand: brand.slug, path }).toString();
    const response = await fetch(endpoint, {headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'error'});
    if (!response.ok) return null;
    const page = projectPage(await response.json());
    if (page.path !== path || sanitizeContent(page.contentHtml) !== page.contentHtml) return null;
    return page;
  } catch { return null; }
}