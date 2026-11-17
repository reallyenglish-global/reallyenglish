import {seedPublicContent} from './seed/public-site';
export default {
  register() {},
  async bootstrap({strapi}: any) { await seedPublicContent(strapi); },
};