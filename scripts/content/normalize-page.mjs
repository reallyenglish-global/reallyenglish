import crypto from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { load } from 'cheerio';
import { normalizePath, sourceUrl, resolveReference, SOURCE_ORIGIN, queryDisposition } from './source-policy.mjs';

const sanitizerOptions = {
  allowedTags: ['h1','h2','h3','h4','h5','h6','p','ul','ol','li','dl','dt','dd','blockquote','strong','em','b','i','u','s','sup','sub','code','pre','br','hr','a','img','figure','figcaption','table','caption','thead','tbody','tfoot','tr','th','td','div','section','article','span'],
  allowedAttributes: { '*': ['id'], a: ['href','title','rel'], img: ['src','alt','width','height','loading'], ol: ['start','reversed'], li: ['value'], th: ['colspan','rowspan','scope'], td: ['colspan','rowspan'] },
  allowedSchemes: ['https','mailto','tel'], allowedSchemesByTag: { img: ['https'] }, allowProtocolRelative: false,
  disallowedTagsMode: 'discard', transformTags: { a: (tagName, attrs) => ({ tagName, attribs: { ...attrs, rel: 'noopener noreferrer' } }) },
};
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function safeReference(value, base, { image = false } = {}) {
  try {
    const url = resolveReference(value, base);
    if (image) {
      // External observed hosts are not automatically trusted. No SVG, CTA or pixels.
      if (url.origin !== SOURCE_ORIGIN || !/\.(?:png|jpe?g|gif|webp|avif)$/i.test(url.pathname) || /track|pixel|beacon|cta/i.test(url.pathname) || url.search) return null;
    } else if (['mailto:', 'tel:'].includes(url.protocol)) return url.href;
    if (url.protocol !== 'https:') return null;
    if (url.origin === SOURCE_ORIGIN) {
      const disposition = queryDisposition(url);
      if (disposition && disposition !== 'tracking_query') return null;
      if (disposition) url.search = '';
    }
    return url.href;
  } catch { return null; }
}
export function normalizePage(html, sourceInput) {
  let source;
  try { source = sourceUrl(sourceInput); } catch { throw new Error('untrusted_source'); }
  const $ = load(html);
  const assets = [];
  $('img,source,video,audio,iframe,embed,object,script[src],link[href]').each((_, el) => {
    const node = $(el);
    if (el.tagName === 'link' && !/stylesheet|preload|icon/i.test(node.attr('rel') || '')) return;
    const refs = [node.attr('src'), node.attr('data-src'), node.attr('poster'), node.attr('data'), el.tagName === 'link' ? node.attr('href') : undefined];
    for (const candidate of (node.attr('srcset') || '').split(',')) if (candidate.trim()) refs.push(candidate.trim().split(/\s+/)[0]);
    if (!refs.some(Boolean)) assets.push({ url: '', disposition: 'missing', reason: 'missing_reference' });
    for (const raw of refs.filter(Boolean)) {
      const safe = el.tagName === 'img' ? safeReference(raw, source.href, { image: true }) : null;
      assets.push({ url: raw, resolvedUrl: safe || undefined, disposition: safe ? 'remote' : 'blocked', reason: safe ? 'vetted_source_raster' : 'unvetted_or_active_media', redirects: [] });
    }
  });
  const requiresLeadForm = $('form,.hs-cta-wrapper,[data-hubspot-form]').length > 0 || /contact/i.test(source.pathname);
  $('script,style,iframe,frame,object,embed,form,input,button,textarea,select,option,svg,math,noscript,template,video,audio,source,.hs-cta-wrapper,[hidden],[aria-hidden="true"]').remove();
  $('*').each((_, el) => {
    const node = $(el);
    if (el.tagName === 'img') {
      // HubSpot lazy images need data-src promoted before active scripts and
      // custom attributes are discarded. Never retain empty/tracking placeholders.
      const safe = [node.attr('src'),node.attr('data-src')].map(raw=>raw && safeReference(raw,source.href,{image:true})).find(Boolean);
      if (!safe) { node.remove(); return; }
      node.attr('src',safe);node.attr('loading','eager');
    }
    for (const name of Object.keys(el.attribs || {})) if (/^on/i.test(name) || ['style','srcset','srcdoc','nonce'].includes(name)) node.removeAttr(name);
    for (const attr of ['href','src']) {
      const raw = node.attr(attr); if (!raw) continue;
      const safe = safeReference(raw, source.href, { image: attr === 'src' });
      if (safe) node.attr(attr, safe); else node.removeAttr(attr);
    }
  });
  let selected;
  for (const selector of ['.body-container-wrapper','.body-container','.blog-post-wrapper']) {
    const candidates = $(selector);
    if (candidates.length > 1) throw new Error('content_region_ambiguous');
    if (candidates.length) { selected = candidates; break; }
  }
  // Legacy HubSpot templates place course/legal sections in the footer wrapper.
  // Preserve that substantive region, but separate the observed shared .hhs-footer.
  const footerWrapper = $('.footer-container-wrapper').clone();
  footerWrapper.find('.hhs-footer,footer').remove();
  const substantiveFooter = footerWrapper.find('h1,h2,h3').length && footerWrapper.text().trim();
  if (substantiveFooter) {
    selected = $('<div></div>').append(selected?.clone()).append(footerWrapper);
  }
  if (!selected?.length || !selected.text().trim()) throw new Error('content_region_empty');
  const linksFor = (region) => region.find('a[href]').toArray().map((el) => {
    const href = $(el).attr('href');
    return { text: $(el).text().trim(), href: href.startsWith(SOURCE_ORIGIN + '/') ? href.slice(SOURCE_ORIGIN.length) : href };
  });
  const contentHtml = sanitizeHtml(selected.html() || '', sanitizerOptions);
  const clean = load(contentHtml);
  if (!clean.text().trim()) throw new Error('sanitized_content_empty');
  const alternates = $('link[rel~="alternate"][hreflang][href]').toArray().flatMap((el) => {
    const href = $(el).attr('href');
    return href?.startsWith(SOURCE_ORIGIN + '/') ? [{ locale: $(el).attr('hreflang'), path: normalizePath(href) }] : [];
  });
  const path = normalizePath(source.href);
  return {
    key: hash(`reallyenglish\0${path}`), brand: 'reallyenglish', path,
    locale: $('html').attr('lang') || 'en', title: $('title').first().text().trim(),
    description: $('meta[name="description"]').attr('content')?.trim() || '',
    canonical: $('link[rel~="canonical"]').attr('href') || source.href, alternates,
    contentHtml, contentHash: hash(contentHtml), text: clean.text().trim(),
    headings: clean('h1,h2,h3,h4,h5,h6').toArray().map((el) => ({ level: Number(el.tagName.slice(1)), text: clean(el).text().trim() })),
    links: linksFor(selected), navigation: linksFor($('header,nav,.header-container-wrapper')),
    footer: { html: sanitizeHtml($('footer,.hhs-footer').toArray().map((el) => $(el).html()).join('\n'), sanitizerOptions), links: linksFor($('footer,.hhs-footer')) },
    requiresLeadForm, source: { url: source.href, fetchedAt: new Date().toISOString(), rawHash: hash(html) }, assets,
  };
}
