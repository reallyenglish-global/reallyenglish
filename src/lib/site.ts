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

export function resolveBrand(host: string): Brand {
  const normalizedHost = host.split(':')[0]?.toLowerCase() ?? '';
  const slug = hostBrandMap()[normalizedHost] ?? 'reallyenglish';
  const fallback = fallbackBrands[slug];
  return fallback ?? { ...fallbackBrands.reallyenglish!, slug, name: slug.replace(/-/g, ' '), shortName: slug.slice(0, 2).toUpperCase(), logoText: slug };
}

function unwrap<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null) ?? null;
}

async function cmsEntry(path: string): Promise<Record<string, unknown> | null> {
  const base = process.env.CMS_API_URL?.trim();
  if (!base) return null;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      headers: process.env.CMS_API_TOKEN ? { Authorization: `Bearer ${process.env.CMS_API_TOKEN}` } : {},
      signal: AbortSignal.timeout(2500), redirect: 'error',
    });
    if (!response.ok) return null;
    return unwrap<Record<string, unknown>>(await response.json());
  } catch { return null; }
}

export async function loadBrand(fallback: Brand): Promise<Brand> {
  const query = new URLSearchParams({ 'filters[slug][$eq]': fallback.slug });
  const entry = await cmsEntry(`/api/brands?${query}`);
  if (!entry || typeof entry.name !== 'string') return fallback;
  return {
    ...fallback, name: entry.name,
    logoText: typeof entry.logoText === 'string' ? entry.logoText : fallback.logoText,
    primaryColor: safeColor(entry.primaryColor, fallback.primaryColor),
    accentColor: safeColor(entry.accentColor, fallback.accentColor),
  };
}

export async function loadHomePage(brand: Brand): Promise<HomePage> {
  const fallback = fallbackPages[brand.slug] ?? fallbackPages.reallyenglish!;
  const query = new URLSearchParams({
    'filters[slug][$eq]': 'home', 'filters[brand][slug][$eq]': brand.slug,
    'populate[brand]': '*',
  });
  const entry = await cmsEntry(`/api/pages?${query}`);
  if (!entry || typeof entry.heroTitle !== 'string' || typeof entry.heroBody !== 'string') return fallback;
  const features = Array.isArray(entry.features) ? entry.features.filter((item): item is { title: string; body: string } => Boolean(item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string' && typeof (item as { body?: unknown }).body === 'string')) : fallback.features;
  const href = typeof entry.ctaHref === 'string' && (entry.ctaHref.startsWith('/') || entry.ctaHref.startsWith('#')) ? entry.ctaHref : fallback.ctaHref;
  return {
    eyebrow: typeof entry.eyebrow === 'string' ? entry.eyebrow : fallback.eyebrow,
    title: entry.heroTitle, body: entry.heroBody,
    ctaLabel: typeof entry.ctaLabel === 'string' ? entry.ctaLabel : fallback.ctaLabel,
    ctaHref: href, features: features.length ? features : fallback.features,
  };
}

export function brandTheme(brand: Brand): { primary: string; accent: string } {
  return { primary: safeColor(brand.primaryColor, '#135b4a'), accent: safeColor(brand.accentColor, '#d8f3e8') };
}
