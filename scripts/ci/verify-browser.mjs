import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';

// Only disposable runner and synthetic @example.invalid data. Browser requests
// outside the app are read-only public images/styles; scripts and forms fail closed.
export async function verifyBrowser(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');
 const base='http://127.0.0.1:4321', manifest=JSON.parse(readFileSync('.ci/content/manifest.json','utf8'));
 const required=['/','/zh-cn/','/pt/','/contact-reallyenglish','/zh-cn/contact-reallyenglish','/uk/eula'];
 for(const predicate of [p=>/case-study/.test(p.path),p=>/^\/blog\/[^/]+$/.test(p.path),p=>p.path==='/blog',p=>/practical-english/.test(p.path)]){
  const page=manifest.pages.find(predicate);assert.ok(page,'representative page missing');required.push(page.path);
 }
 const paths=[...new Set(required)];for(const path of paths)assert.ok(manifest.pages.some(p=>p.path===path),path);
 const report={success:false,viewports:[],forms:[],externalDependencies:[],errors:[]};
 mkdirSync('.ci/reports/screenshots',{recursive:true});
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900}}), page=await context.newPage();
   const runtime=[];page.on('pageerror',e=>runtime.push(e.message.slice(0,200)));
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===base)return route.continue();
    const allowed=req.method()==='GET' && ['image','stylesheet','font'].includes(req.resourceType()) && url.protocol==='https:';
    report.externalDependencies.push({url:url.origin+url.pathname,type:req.resourceType(),allowed});
    if(!allowed)report.errors.push('Forbidden external request: '+url.origin+url.pathname);
    return allowed?route.continue():route.abort();
   });
   for(const path of paths){
    const response=await page.goto(base+path,{waitUntil:'networkidle',timeout:45000});assert.equal(response.status(),200,path);
    assert.equal(await page.locator('nav[aria-label="Main"]').count(),1);
    assert.ok((await page.locator('#source-content').innerText()).length>40);
    assert.equal(await page.locator('form:not([data-lead-form])').count(),0);
    assert.equal(await page.locator('script[src^="http"]').count(),0);
    const broken=await page.locator('#source-content img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src));
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    const name=`${width}-${path.replace(/[^a-z0-9]/gi,'_')||'home'}.png`;
    await page.screenshot({path:'.ci/reports/screenshots/'+name,fullPage:true});
    report.viewports.push({path,width,brokenImages:broken,overflow,screenshot:name});
    if(broken.length)report.errors.push(`Broken source images ${path} ${width}: ${broken.length}`);
    if(overflow)report.errors.push(`Horizontal overflow ${path} ${width}`);
   }
   assert.deepEqual(runtime,[],'browser runtime errors');
   await context.close();
  }
  const context=await browser.newContext(),page=await context.newPage();
  for(const path of ['/contact-reallyenglish','/zh-cn/contact-reallyenglish']){
   await page.goto(base+path,{waitUntil:'networkidle'});
   const email=`browser-${randomUUID()}@example.invalid`,form=page.locator('[data-lead-form]');
   for(const [name,value] of Object.entries({firstName:'CI',lastName:'Synthetic',email,companyName:'Disposable CI only',message:'Synthetic browser enquiry, no real contact requested.'}))await form.locator(`[name="${name}"]`).fill(value);
   await form.locator('[name="consent"]').check();
   const responsePromise=page.waitForResponse(r=>r.url()===base+'/api/leads'&&r.request().method()==='POST');
   await form.locator('button[type="submit"]').click();
   const response=await responsePromise,body=await response.json(),payload=response.request().postDataJSON();
   assert.equal(response.status(),200);assert.equal(body.ok,true);assert.notEqual(body.mode,'demo');
   await page.locator('[data-form-status]').filter({hasText:'received'}).waitFor();
   const dedup=createHash('sha256').update('reallyenglish\0'+payload.submissionId).digest('hex');
   const url=new URL('/rest/websiteLeads',process.env.TWENTY_BASE_URL);url.searchParams.set('filter',`dedupKey[eq]:${dedup}`);
   const read=await fetch(url,{headers:{authorization:`Bearer ${process.env.TWENTY_API_KEY}`}});assert.ok(read.ok);
   const rows=(await read.json()).data.websiteLeads;assert.equal(rows.length,1);
   assert.equal(rows[0].email,email);assert.equal(rows[0].locale,manifest.pages.find(p=>p.path===path).locale);assert.equal(rows[0].sourcePath,path);
   report.forms.push({path,submissionId:payload.submissionId,recordId:rows[0].id,locale:rows[0].locale,success:true});
  }
  await context.close();report.success=report.errors.length===0;
 }catch(e){report.errors.push(e.message);}finally{await browser.close();writeFileSync('.ci/reports/browser.json',JSON.stringify(report,null,2));}
 assert.equal(report.success,true,JSON.stringify(report.errors));return report;
}
