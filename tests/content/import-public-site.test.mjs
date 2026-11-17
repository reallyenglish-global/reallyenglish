import test from 'node:test';
import assert from 'node:assert/strict';
import { importPublicSite, parseSitemap, canonicalJson } from '../../scripts/content/import-public-site.mjs';
const root='https://www.reallyenglish.com';
const html=(links='')=>`<html lang="zh-cn"><title>中文</title><div class="body-container"><h1>标题</h1><p>Full paragraph</p>${links}</div></html>`;
test('namespaced sitemap handles all entries and rejects DTD/malformed XML',()=>{
  const result=parseSitemap('<s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"><s:url><s:loc>https://www.reallyenglish.com/中文/</s:loc><s:lastmod>2026-01-01</s:lastmod></s:url></s:urlset>',root);
  assert.equal(result.entries.length,1); assert.equal(result.entries[0].lastmod,'2026-01-01');
  assert.throws(()=>parseSitemap('<!DOCTYPE x><urlset/>',root),/doctype/);
  assert.throws(()=>parseSitemap('<urlset>',root),/malformed/);
});
test('inventory traverses beyond a batch, redirects and pagination; known 404 remains failed',async()=>{
  const urls=['/','/two','/three','/four','/old'];
  const sitemap=`<urlset>${urls.map((p)=>`<url><loc>${root}${p}</loc></url>`).join('')}</urlset>`;
  const calls=[];
  const get=async(url)=>{
    calls.push(url);
    if(url.endsWith('/sitemap.xml')) return {status:200,url,headers:{'content-type':'application/xml'},body:sitemap,chain:[]};
    const path=new URL(url).pathname;
    if(path==='/old') return {status:200,url:root+'/new',headers:{'content-type':'text/html'},body:html(),chain:[{from:url,to:root+'/new',status:301}]};
    const body=path==='/'?html('<a href="/archive/page/2">Next</a><a href="/blog/linkedin.com/in/richarddigitaledu">broken</a><a href="/?q=x">search</a><a href="/two?utm_source=test">track</a>'):html();
    return {status:path.includes('linkedin.com')?404:200,url,headers:{'content-type':'text/html'},body,chain:[]};
  };
  const m=await importPublicSite({output:null,enforceBaseline:false,get,minIntervalMs:0});
  assert.equal(m.pending.length,0); assert.equal(m.technicalSuccess,true); assert.equal(m.editorialSuccess,false);
  assert.equal(m.sourceDefects.length,1); assert.equal(m.sourceDefects[0].known,true);
  assert.ok(m.pages.some((p)=>p.path==='/archive/page/2'));
  assert.ok(m.pages.some((p)=>p.path==='/new'));
  assert.ok(m.excluded.some((x)=>x.reason==='non_content_query'));
  assert.ok(!calls.some((u)=>u.includes('?')));
  assert.deepEqual(new Set(m.discovered.map((x)=>x.url)),new Set(m.dispositions.map((x)=>x.url)));
  assert.equal(m.dispositions.length,m.discovered.length);
});
test('page cap leaves pending and fails closed',async()=>{
 const m=await importPublicSite({output:null,enforceBaseline:false,maxPages:1,minIntervalMs:0,get:async(url)=>({url,status:200,headers:{'content-type':'text/html'},chain:[],body:url.endsWith('.xml')?`<urlset><url><loc>${root}/</loc></url><url><loc>${root}/two</loc></url></urlset>`:html()})});
 assert.equal(m.technicalSuccess,false);assert.equal(m.pending.length,1);
});
test('canonical JSON sorts nested objects',()=>assert.equal(canonicalJson({z:1,a:{y:2,x:3}}),'{"a":{"x":3,"y":2},"z":1}'));
