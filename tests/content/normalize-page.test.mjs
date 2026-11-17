import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePage } from '../../scripts/content/normalize-page.mjs';

const source = 'https://www.reallyenglish.com/en/contact';

test('extracts source region, metadata, locale and safe content', () => {
  const result = normalizePage(`<!doctype html><html lang="en-gb"><head><title>Contact</title><meta name="description" content="Say hello"><link rel="canonical" href="/en/contact"></head><body><div class="body-container-wrapper"><h1>Contact</h1><p>Talk to us <a href="/about">about us</a>.</p><img src="/media/team.jpg" alt="Team"></div></body></html>`, source);
  assert.equal(result.path, '/en/contact');
  assert.equal(result.locale, 'en-gb');
  assert.equal(result.title, 'Contact');
  assert.match(result.contentHtml, /Talk to us/);
  assert.match(result.contentHtml, /rel="noopener noreferrer"/);
  assert.equal(result.assets.length, 1);
  assert.equal(result.source.rawHash.length, 64);
});

test('removes executable embeds, forms, inline event handlers and unsafe URLs', () => {
  const result = normalizePage(`<html><head><title>Unsafe</title></head><body><div class="body-container"><h1 onclick="alert(1)">Hi</h1><script>alert(1)</script><form><input value="secret"></form><a href="javascript:alert(1)">bad</a><iframe src="https://evil.test"></iframe><img src="//tracker.test/pixel" onerror="alert(1)"></div></body></html>`, source);
  assert.doesNotMatch(result.contentHtml, /script|iframe|form|input|onclick|javascript:|tracker\.test|onerror/i);
  assert.match(result.contentHtml, /Hi/);
});

test('preserves semantic text, footer, alternates and records blocked media', () => {
  const result = normalizePage(`<html lang="zh-cn"><head><link rel="alternate" hreflang="pt" href="/pt/"></head><body><header><nav><a href="/courses">Courses</a></nav></header><div class="body-container"><h6>中文</h6><dl><dt>Term</dt><dd>Definition</dd></dl><table><caption>Results</caption><tr><th>A</th><td>B</td></tr></table><a href="/%252e%252e/x">bad</a><img src="/photo.jpg" alt="Author"><img src="https://no-cache.hubspot.com/pixel"><a href="https://example.org/author">Attribution</a></div><footer><p>Legal text</p><a href="/legal">Legal</a></footer></body></html>`, source);
  assert.match(result.contentHtml, /<h6>中文<\/h6>/);
  assert.match(result.contentHtml, /<dd>Definition<\/dd>/);
  assert.match(result.contentHtml, /<caption>Results<\/caption>/);
  assert.match(result.footer.html, /Legal text/);
  assert.equal(result.navigation[0].href, '/courses');
  assert.deepEqual(result.alternates, [{locale:'pt',path:'/pt/'}]);
  assert.equal(result.assets.filter((a)=>a.disposition==='blocked').length,1);
  assert.doesNotMatch(result.contentHtml, /%252e|hubspot/);
  assert.match(result.contentHtml, /https:\/\/example.org\/author/);
});

test('fails closed for unsupported source extraction', () => {
  assert.throws(() => normalizePage('<html><body><p>no reviewed region</p></body></html>', source), /content_region_empty/);
  assert.throws(() => normalizePage('<div class="body-container">x</div>', 'https://example.test'), /untrusted_source/);
});
