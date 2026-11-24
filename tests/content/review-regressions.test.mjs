import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as vite} from 'vite';

const hash = value => createHash('sha256').update(value).digest('hex');
test('a footer-only second import reaches the published document', async t => {
  const server = await vite({configFile:false,cacheDir:'node_modules/.vite-seed-test',optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,hmr:false}});
  t.after(() => server.close());
  const {seedPublicContent} = await server.ssrLoadModule('/apps/cms/src/seed/public-site.ts');
  const dir = await mkdtemp(join(tmpdir(),'site-seed-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const manifest = join(dir,'manifest.json');
  process.env.SEED_PUBLIC_CONTENT='true'; process.env.PUBLIC_CONTENT_MANIFEST=manifest;
  const url='https://www.reallyenglish.com/about', html='<p>Body</p>';
  const page={key:hash('reallyenglish\0/about'),brand:'reallyenglish',path:'/about',locale:'en',title:'About',description:'',canonical:url,alternates:[],contentHtml:html,contentHash:hash(html),source:{url,fetchedAt:'2026-01-01T00:00:00Z',rawHash:hash(html)},assets:[],navigation:[],footer:{links:[],html:''}};
  const docs=()=>{let draft, published;return {findFirst:async q=>q.status==='published'?published:draft, create:async({data})=>(draft={...data,documentId:'abc'}),update:async({data})=>(draft={...draft,...data}),publish:async()=>{published=structuredClone(draft);}}};
  const pages=docs(),brands=docs(),strapi={documents:uid=>uid==='api::page.page'?pages:brands,log:{info(){}}};
  for(const href of ['/old','/new']){
    page.footer.html=`<a href="${href}">Contact</a>`;
    await writeFile(manifest,JSON.stringify({technicalSuccess:true,pages:[page],failed:[]}));
    await seedPublicContent(strapi);
    assert.equal((await pages.findFirst({status:'published'})).footer.html,page.footer.html);
  }
});
