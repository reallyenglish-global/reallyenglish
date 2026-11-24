export interface Brand {
  slug: string;
  name: string;
  shortName: string;
  primaryColor: string;
  accentColor: string;
  logoText: string;
}

export interface HomePage {
  eyebrow: string; title: string; body: string; ctaLabel: string; ctaHref: string;
  features: { title: string; body: string }[];
}

const fallbackBrands: Record<string, Brand> = {
  reallyenglish: { slug: 'reallyenglish', name: 'ReallyEnglish', shortName: 'RE', primaryColor: '#135b4a', accentColor: '#d8f3e8', logoText: 'reallyenglish' },
  'partner-demo': { slug: 'partner-demo', name: 'Partner Demo', shortName: 'PD', primaryColor: '#4b3d80', accentColor: '#ebe6fa', logoText: 'partner' },
};

const fallbackPages: Record<string, HomePage> = {
  reallyenglish: {
    eyebrow: 'English for real-world progress',
    title: 'Help your learners use English with confidence.',
    body: 'Practical digital English learning for education providers and organisations. Explore a flexible learning experience designed to support real goals.',
    ctaLabel: 'Talk to our team', ctaHref: '#contact',
    features: [
      { title: 'Built around learners', body: 'Structured practice and useful feedback help learners make steady progress.' },
      { title: 'Flexible for partners', body: 'Support different audiences, programmes and ways of delivering learning.' },
      { title: 'Clear progress insights', body: 'Give educators a useful view of engagement and learning progress.' },
    ],
  },
  'partner-demo': {
    eyebrow: 'Partner-branded learning',
    title: 'A learning experience that feels like your own.',
    body: 'A white-label concept for organisations that want to offer digital English learning under their own brand.',
    ctaLabel: 'Explore a partnership', ctaHref: '#contact',
    features: [
      { title: 'Your identity', body: 'Use your own brand colours, name and domain.' },
      { title: 'Shared learning platform', body: 'Keep the learning experience connected to a proven service.' },
      { title: 'A flexible partnership', body: 'Shape the offer around your learners and your goals.' },
    ],
  },
};

const safeColor = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;

function hostBrandMap(): Record<string, string> {
  const raw = process.env.BRAND_HOST_MAP;
  if (!raw) return { localhost: 'reallyenglish', '127.0.0.1': 'reallyenglish', 'partner.localhost': 'partner-demo' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([host, slug]) => /^[a-z0-9.-]+$/i.test(host) && typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug)));
  } catch { return {}; }
}

export function configuredBrand(host: string): Brand | null {
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) return null;
  const hostname = host.split(':')[0]!.toLowerCase();
  const mapping = hostBrandMap();
  const slug = Object.hasOwn(mapping, hostname) ? mapping[hostname] : undefined;
  return slug && Object.hasOwn(fallbackBrands, slug) ? fallbackBrands[slug]! : null;
}

export function resolveBrand(host: string): Brand {
  const brand = configuredBrand(host);
  if (!brand) throw new Error('unknown_host');
  return brand;
}

export const contentMode = () => process.env.CMS_CONTENT_MODE ?? 'demo';

export async function loadBrand(fallback: Brand): Promise<Brand> {
  const base = process.env.CMS_API_URL?.trim();
  const token = process.env.CMS_READ_TOKEN;
  if (!base || !token) return fallback;
  let entry;
  try {
    const endpoint = new URL('/api/site/brand', base);
    endpoint.searchParams.set('brand',fallback.slug);
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2500), redirect: 'error',
    });
    if (!response.ok) return fallback;
    entry = await response.json();
  } catch { return fallback; }
  if (entry?.slug !== fallback.slug || typeof entry.name !== 'string') return fallback;
  return {
    ...fallback, name: entry.name,
    logoText: typeof entry.logoText === 'string' ? entry.logoText : fallback.logoText,
    primaryColor: safeColor(entry.primaryColor, fallback.primaryColor),
    accentColor: safeColor(entry.accentColor, fallback.accentColor),
  };
}

export async function loadHomePage(brand: Brand): Promise<HomePage> {
  const fallback = fallbackPages[brand.slug]!;
  // Legacy hero records can still be read with a scoped Strapi collection token.
  const base = process.env.CMS_API_URL, token = process.env.CMS_API_TOKEN;
  if (!base || !token) return fallback;
  try {
    const endpoint = new URL('/api/pages',base);
    endpoint.search = new URLSearchParams({'filters[slug][$eq]':'home','filters[brand][slug][$eq]':brand.slug,'populate[brand]':'*'}).toString();
    const response = await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(2500)});
    if (!response.ok) return fallback;
    const entry = (await response.json())?.data?.[0];
    if (entry?.brand?.slug !== brand.slug || typeof entry.heroTitle !== 'string' || typeof entry.heroBody !== 'string') return fallback;
    const features = Array.isArray(entry.features) ? entry.features.filter((f: any)=>typeof f?.title==='string' && typeof f?.body==='string') : [];
    return {...fallback,title:entry.heroTitle,body:entry.heroBody,features:features.length ? features : fallback.features};
  } catch { return fallback; }
}

export function brandTheme(brand: Brand): { primary: string; accent: string } {
  return { primary: safeColor(brand.primaryColor, '#135b4a'), accent: safeColor(brand.accentColor, '#d8f3e8') };
}
