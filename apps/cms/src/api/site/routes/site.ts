export default {routes: [
  {method:'GET',path:'/site/page',handler:'site.page',config:{auth:false}},
  {method:'GET',path:'/site/brand',handler:'site.brand',config:{auth:false}},
]};