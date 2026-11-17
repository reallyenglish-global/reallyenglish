import {seedPublicContent} from './seed/public-site';
export default {
  register() {},
  async bootstrap({strapi}: any) {
    await seedPublicContent(strapi);
    if (process.env.CI === 'true' && process.env.CMS_VERIFY_HOOK === 'true') {
      const verify = require(process.cwd() + '/scripts/ci-verify.cjs');
      await verify(strapi, {seedPublicContent});
    }
  },
};