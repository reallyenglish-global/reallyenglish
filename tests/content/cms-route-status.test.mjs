import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,get} from 'node:http';
import {dev} from 'astro';
import {execFileSync} from 'node:child_process';
import {load} from 'cheerio';

test('public article route distinguishes missing content from CMS outage',async t=>{
  let status=404;
  const cms=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/site/brand') {
      const slug=url.searchParams.get('brand');
      return res.end(JSON.stringify({slug,name:slug,logoText:`CMS ${slug}`,primaryColor:slug==='partner-demo'?'#123456':'#abcdef'}));
    }
    res.writeHead(status).end();
  });
  await new Promise(resolve=>cms.listen(0,'127.0.0.1',resolve)); t.after(()=>cms.close());
  const overlay=execFileSync('kubectl',['kustomize','k8s/overlays/local'],{encoding:'utf8'});
  const setting=key=>overlay.match(new RegExp(`^  ${key}: (.+)$`,'m'))?.[1].replace(/^["']|["']$/g,'');
  assert.equal(setting('CMS_CONTENT_MODE'),'demo');
  assert.equal(setting('CMS_API_URL'),'http://cms:1337');
  assert.match(overlay,/configMapRef:\s+name: website-config/);
  process.env.CMS_API_URL=setting('CMS_API_URL');
  process.env.CMS_CONTENT_MODE=setting('CMS_CONTENT_MODE');
  process.env.BRAND_HOST_MAP=setting('BRAND_HOST_MAP');
  delete process.env.CMS_READ_TOKEN;
  delete process.env.CMS_API_TOKEN;
  const site=await dev({server:{host:'127.0.0.1',port:0},logLevel:'silent'}); t.after(()=>site.stop());
  const home=host=>new Promise((resolve,reject)=>get({hostname:'127.0.0.1',port:site.address.port,path:'/',headers:{host}},res=>{
    let body='';res.setEncoding('utf8').on('data',s=>body+=s).on('end',()=>resolve(new Response(body,{status:res.statusCode})));
  }).on('error',reject));
  assert.equal((await home('localhost')).status,200);
  process.env.CMS_API_URL=`http://127.0.0.1:${cms.address().port}`; process.env.CMS_READ_TOKEN='synthetic';
  for(const [host,slug,color] of [['localhost','reallyenglish','#abcdef'],['partner.localhost','partner-demo','#123456']]) {
    const $=load(await (await home(host)).text());
    assert.equal($('header a').first().text(),`CMS ${slug}`);
    assert.equal($('meta[name=theme-color]').attr('content'),color);
    assert.equal($('form').attr('method')?.toLowerCase(),'post');
    assert.equal($('form').attr('action'),'/api/leads');
  }
  process.env.CMS_CONTENT_MODE='published';
  for(status of [404,503]){
    assert.equal((await home('localhost')).status,status);
    const res=await fetch(`http://localhost:${site.address.port}/about`,{headers:{Host:'localhost'}});
    assert.equal(res.status,status,(await res.text()).slice(0,1600));
  }
});
