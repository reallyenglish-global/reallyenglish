import crypto from 'node:crypto';
import sanitizeHtml from 'sanitize-html';

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isLocale = (value: unknown): value is string => typeof value === 'string' && /^(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})*|x-default)$/i.test(value);
export function normalizeRoute(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.length > 1024 || /[\\?#\s\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c|2e|25)/i.test(value)) throw new Error('invalid_path');
  const decoded = decodeURIComponent(value);
  if (/[\\?#\s\u0000-\u001f\u007f%]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..') || /^\/(?:api|health|admin)(?:\/|$)/i.test(decoded)) throw new Error('invalid_path');
  return decoded;
}
export function sourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const rawPath = /^https:\/\/[^/]+(\/[^?#]*)/.exec(value)?.[1] || '/';
    return url.origin === 'https://www.reallyenglish.com' && !url.username && !url.password && !url.search && !url.hash && normalizeRoute(rawPath) === normalizeRoute(url.pathname);
  } catch { return false; }
}
function safeReference(value: string, image = false): boolean {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith('//')) return false;
  if (value.startsWith('#')) return !image;
  try {
    const url = new URL(value, 'https://www.reallyenglish.com');
    if (!image && ['mailto:', 'tel:'].includes(url.protocol)) return true;
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const path = value.startsWith('/') ? value.split(/[?#]/)[0] : /^https:\/\/[^/]+(\/[^?#]*)/.exec(value)?.[1] || '/';
    normalizeRoute(path);
    return !image || !/\.(?:svg|svgz|html?|xml)(?:$)/i.test(url.pathname);
  } catch { return false; }
}
// Applied at ingestion AND immediately before set:html; no active source markup.
export function sanitizeContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['h1','h2','h3','h4','h5','h6','p','ul','ol','li','dl','dt','dd','blockquote','strong','em','b','i','u','s','sub','sup','br','hr','a','img','figure','figcaption','table','caption','thead','tbody','tfoot','tr','th','td','div','section','article','header','footer','nav','main','span','address','time','pre','code'],
    allowedAttributes: { '*': ['id'], a: ['href','title','rel'], img: ['src','alt','width','height','loading'], th: ['colspan','rowspan','scope'], td: ['colspan','rowspan'], ol: ['start'], time: ['datetime'], nav: ['aria-label'] },
    allowedSchemes: ['https','mailto','tel'], allowedSchemesByTag: { img: ['https'] }, allowProtocolRelative: false,
    nonTextTags: ['script','style','textarea','option','noscript','template','svg','math','iframe','object','embed','form'],
    transformTags: {
      a: (tagName, attribs) => {
        const attributes: Record<string, string> = { ...attribs, rel: 'noopener noreferrer' };
        if (attributes.href && !safeReference(attributes.href)) delete attributes.href;
        return { tagName, attribs: attributes };
      },
      img: (tagName, attribs) => {
        const attributes = { ...attribs };
        if (attributes.src && !safeReference(attributes.src, true)) delete attributes.src;
        return { tagName, attribs: attributes };
      },
    },
  });
}
export interface PublicPage {
  path: string; locale: string; title: string; description: string; canonical: string;
  alternates: Array<{ locale: string; path: string }>;
  contentHtml: string; contentHash: string; externalKey: string; sourceUrl: string;
  navigation: Array<{text:string;href:string}>; footer: {html:string};
}
export function projectPage(value: any): PublicPage {
  if (!value || typeof value.path !== 'string' || normalizeRoute(value.path) !== value.path || !isLocale(value.locale) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 2000 ||
      typeof value.description !== 'string' || value.description.length > 20000 || !sourceUrl(value.canonical) ||
      !sourceUrl(value.sourceUrl) || !isHash(value.contentHash) || !isHash(value.externalKey) ||
      typeof value.contentHtml !== 'string' || !value.contentHtml.trim() || Buffer.byteLength(value.contentHtml) > 2_500_000 ||
      !Array.isArray(value.alternates) || value.alternates.length > 100 || value.alternates.some((a: any) => !a || !isLocale(a.locale) || typeof a.path !== 'string' || normalizeRoute(a.path) !== a.path)) throw new Error('invalid_page');
  // The hash names the stored normalized source, not presentation-only link rewriting.
  if (sha256(value.contentHtml) !== value.contentHash || sha256(`reallyenglish\0${value.path}`) !== value.externalKey) throw new Error('invalid_page_hash');
  return {
    path: value.path, locale: value.locale, title: value.title, description: value.description,
    canonical: value.canonical, alternates: value.alternates.map((a: any) => ({ locale: a.locale, path: a.path })),
    contentHtml: value.contentHtml, contentHash: value.contentHash, externalKey: value.externalKey, sourceUrl: value.sourceUrl,
    navigation: Array.isArray(value.navigation) ? value.navigation.filter((x:any)=>x && typeof x.text==='string' && typeof x.href==='string' && safeReference(x.href)).map((x:any)=>({text:x.text,href:x.href})) : [],
    footer: {html:sanitizeContent(typeof value.footer?.html === 'string' ? value.footer.html : '')},
  };
}
