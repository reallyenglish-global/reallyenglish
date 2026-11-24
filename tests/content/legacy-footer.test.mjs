import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePage } from '../../scripts/content/normalize-page.mjs';
// Synthetic structural fixtures based on observed legal/course HubSpot templates;
// not copied source bodies and not a substitute for the hosted whole inventory.
for (const [path,title,text] of [['/terms-of-use','Legal terms','Synthetic legal obligations.'],['/business-speaking','Course details','Synthetic course learning outcomes.']]) {
  test(`preserves substantive legacy footer content: ${path}`, () => {
    const page = normalizePage(`<html><head><title>${title}</title></head><body><div class="body-container-wrapper"><div></div></div><div class="footer-container-wrapper"><section><h2>${title}</h2><p>${text}</p><script>bad()</script><form>private input</form></section><div class="hhs-footer"><p>Shared footer</p></div></div></body></html>`, `https://www.reallyenglish.com${path}`);
    assert.ok(page.text.includes(text));
    assert.ok(!page.text.includes('Shared footer'));
    assert.ok(page.footer.html.includes('Shared footer'));
    assert.doesNotMatch(page.contentHtml, /script|private input|bad\(\)/);
  });
}
test('shared footer alone cannot mask an empty content region', () => {
  assert.throws(() => normalizePage('<div class="body-container-wrapper"></div><div class="footer-container-wrapper"><div class="hhs-footer"><h2>Navigation</h2></div></div>', 'https://www.reallyenglish.com/empty'), /content_region_empty/);
});
