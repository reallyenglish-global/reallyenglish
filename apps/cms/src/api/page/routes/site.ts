export default [
  {
    method: 'GET',
    path: '/site/page',
    handler: 'page.site',
    config: { auth: false, policies: [] },
  },
];
