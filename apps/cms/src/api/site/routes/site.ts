export default {routes: [
  ...(process.env.CI === 'true' && process.env.CMS_VERIFY_HOOK === 'true' ? [{method:'POST',path:'/site/ci-publication',handler:'site.ciPublication',config:{auth:false}}] : []),
  {method:'GET',path:'/site/page',handler:'site.page',config:{auth:false}},
  {method:'GET',path:'/site/brand',handler:'site.brand',config:{auth:false}},
]};