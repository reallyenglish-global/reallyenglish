import {seedPublicContent} from './seed/public-site';
import {sanitizeContent,sha256} from './seed/content-contract';
export default {
  register({strapi}: any) {
    strapi.documents.use(async (context: any, next: () => Promise<unknown>) => {
      if (context.uid === 'api::page.page' && ['create','update'].includes(context.action)) {
        const data = context.params.data;
        // Never accept a client-calculated hash, including on partial metadata edits.
        delete data.contentHash;
        if ('contentHtml' in data) {
          if (typeof data.contentHtml !== 'string' || Buffer.byteLength(data.contentHtml) > 2_500_000) throw new Error('invalid_page_body');
          const html = sanitizeContent(data.contentHtml);
          if (!html.trim() || Buffer.byteLength(html) > 2_500_000) throw new Error('invalid_page_body');
          data.contentHtml = html;
          data.contentHash = sha256(html);
        }
      }
      return next();
    });
  },
  async bootstrap({strapi}: any) {
    await seedPublicContent(strapi);
    if (process.env.CI === 'true' && process.env.CMS_VERIFY_HOOK === 'true') {
      const verify = require(process.cwd() + '/scripts/ci-verify.cjs');
      await verify(strapi, {seedPublicContent});
    }
  },
};