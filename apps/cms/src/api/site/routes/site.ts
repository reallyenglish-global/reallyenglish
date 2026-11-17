export default [
  {
    method: 'GET',
    path: '/api/site/page',
    handler: 'page.site',
    config: { auth: false, policies: [] },
  },
  {
    method: 'GET',
    path: '/api/site/brand',
    handler: 'brand.site',
    config: { auth: false, policies: [] },
  },
];