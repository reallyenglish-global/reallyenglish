import dns from 'node:dns/promises';
import net from 'node:net';

export const SOURCE_ORIGIN = 'https://www.reallyenglish.com';
export function isPublicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only global unicast; exclude special-use/documentation/transition ranges.
  if (net.isIPv6(address)) {
    const expanded = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    const first = parseInt(expanded.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !/^2001:(?:[0-9a-f]{1,3}:|db8:)/.test(expanded) &&
      !expanded.startsWith('2002:') && !expanded.startsWith('3fff:');
  }
  return false;
}

export function normalizePath(input) {
  if (typeof input !== 'string' || /[\u0000-\u0020\u007f\\]/.test(input) || input.startsWith('//')) throw new Error('encoded_path_denied');
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i.exec(input);
  const raw = absolute ? (absolute[1] || '/') : input.split(/[?#]/, 1)[0] || '/';
  if (!raw.startsWith('/') || /%(?:2f|5c|2e|25)/i.test(raw)) throw new Error('encoded_path_denied');
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw new Error('encoded_path_denied'); }
  if (/[\u0000-\u0020\u007f\\?#]/.test(decoded) || decoded.includes('//')) throw new Error('encoded_path_denied');
  if (decoded.split('/').some((part) => part === '.' || part === '..')) throw new Error('dot_segment_denied');
  const url = new URL(input, SOURCE_ORIGIN);
  if (url.origin !== SOURCE_ORIGIN || url.username || url.password) throw new Error('invalid_path_origin');
  return decoded;
}

export function sourceUrl(input) {
  const url = new URL(input);
  if (url.origin !== SOURCE_ORIGIN || url.username || url.password) throw new Error('source_origin_denied');
  normalizePath(input);
  return url;
}

export async function resolveSource(input, { resolve = dns.lookup } = {}) {
  const url = sourceUrl(input);
  const answers = await resolve(url.hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some(({ address, family }) => !isPublicAddress(address) || net.isIP(address) !== family)) throw new Error('source_dns_denied');
  return { url, address: answers[0].address, family: answers[0].family };
}
export async function validateSourceUrl(input, options) { return (await resolveSource(input, options)).url; }

export function resolveReference(raw, base) {
  if (typeof raw !== 'string' || raw.startsWith('//') || /[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error('unsafe_reference');
  // Inspect before WHATWG URL removes dot segments.
  const path = raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0];
  if (/%(?:2f|5c|2e|25)/i.test(path) || path.split('/').some((s) => s === '.' || s === '..')) throw new Error('unsafe_reference');
  const url = new URL(raw, base);
  if (url.username || url.password) throw new Error('unsafe_reference');
  if (url.origin === SOURCE_ORIGIN) normalizePath(url.href);
  return url;
}

export function queryDisposition(url) {
  if (!url.search) return null;
  const tracking = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']);
  const keys = [...url.searchParams.keys()];
  return keys.every((key) => tracking.has(key.toLowerCase())) ? 'tracking_query' :
    keys.some((key) => /preview|search|preferences|^q$|^page$/i.test(key)) ? 'non_content_query' : 'unclassified_query';
}
