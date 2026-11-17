import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import { verifyCms } from './verify-cms.mjs';
import { verifyContent } from './verify-content.mjs';
import { verifyLeads } from './verify-leads.mjs';
if(process.env.GITHUB_ACTIONS !== 'true') throw new Error('hosted_disposable_only');
const root=process.cwd(), reports=resolve('.ci/reports');
mkdirSync(reports,{recursive:true}); mkdirSync('.ci/private',{recursive:true,mode:0o700});
const secrets=[];
const secret=()=>{const s=randomBytes(32).toString('hex');secrets.push(s);console.log(`::add-mask::${s}`);return s;};
const children=[];
const start=(args,cwd,env,name)=>{const fd=openSync(resolve(`.ci/private/${name}.log`),'w',0o600);const child=spawn(process.execPath,args,{cwd,env:{...process.env,...env},stdio:['ignore',fd,fd]});closeSync(fd);children.push(child);return child;};
const stop=async(child)=>{if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,10000))]);if(child.exitCode===null)child.kill('SIGKILL');};
const ready=async(url,child)=>{for(let i=0;i<180;i++){if(child.exitCode!==null)throw new Error('service_exited_'+child.exitCode);try{if((await fetch(url,{signal:AbortSignal.timeout(2000)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,2000));}throw new Error('service_readiness_timeout');};
const privateIP=service=>{const id=execFileSync('docker',['compose','-f','compose.ci.yml','ps','-q',service],{encoding:'utf8'}).trim();const o=JSON.parse(execFileSync('docker',['inspect',id],{encoding:'utf8'}))[0];const ip=Object.values(o.NetworkSettings.Networks)[0].IPAddress;if(!/^(172\.|10\.|192\.168\.)/.test(ip))throw new Error('not_private');return ip;};
const twenty=JSON.parse(readFileSync('.ci/private/twenty.json','utf8')); secrets.push(twenty.apiKey);
// Loopback-only transport proxy into isolated Docker bridge; not a mock server.
const proxy=http.createServer((req,res)=>{const upstream=http.request(new URL(req.url,twenty.base),{method:req.method,headers:{...req.headers,host:'localhost:3000'}},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
await new Promise(r=>proxy.listen(3000,'127.0.0.1',r));
const manifest=JSON.parse(readFileSync('.ci/content/manifest.json','utf8'));
const env={HOST:'127.0.0.1',PORT:'1337',NODE_ENV:'production',CI:'true',DATABASE_CLIENT:'postgres',DATABASE_HOST:privateIP('cms-db'),DATABASE_NAME:'strapi',DATABASE_USERNAME:'postgres',DATABASE_PASSWORD:process.env.TWENTY_DB_PASSWORD,APP_KEYS:`${secret()},${secret()}`,API_TOKEN_SALT:secret(),ADMIN_JWT_SECRET:secret(),TRANSFER_TOKEN_SALT:secret(),JWT_SECRET:secret(),ENCRYPTION_KEY:secret(),CMS_READ_TOKEN:secret(),SEED_PUBLIC_CONTENT:'true',PUBLIC_CONTENT_MANIFEST:resolve('.ci/content/manifest.json'),PUBLIC_CONTENT_SEED_REPORT:resolve('.ci/reports/seed.json'),CMS_VERIFY_HOOK:'true',CMS_VERIFY_HOOK_REPORT:resolve('.ci/reports/cms-hook.json'),STRAPI_TELEMETRY_DISABLED:'true'};
Object.assign(process.env,{PUBLIC_CONTENT_MANIFEST:env.PUBLIC_CONTENT_MANIFEST,CMS_VERIFY_HOOK_REPORT:env.CMS_VERIFY_HOOK_REPORT,CMS_API_URL:'http://127.0.0.1:1337',CMS_READ_TOKEN:env.CMS_READ_TOKEN,ASTRO_BASE_URL:'http://127.0.0.1:4321',TWENTY_BASE_URL:'http://127.0.0.1:3000',TWENTY_API_KEY:twenty.apiKey,LEAD_LOCALE:manifest.pages.find(p=>p.path==='/').locale});
const astroEnv={HOST:'127.0.0.1',PORT:'4321',CRM_MODE:'twenty',BRAND_HOST_MAP:JSON.stringify({'127.0.0.1':'reallyenglish',localhost:'reallyenglish','partner.localhost':'partner-demo'}),PUBLIC_CONTENT_MANIFEST:env.PUBLIC_CONTENT_MANIFEST};
let stage='cms';const report={sha:process.env.GITHUB_SHA,success:false,stages:{}};
try{
 const cms=start(['node_modules/@strapi/strapi/bin/strapi.js','start'],resolve('apps/cms'),env,'cms');
 await ready('http://127.0.0.1:1337/_health',cms);
 const cmsReport=await verifyCms();if(!cmsReport.success)throw new Error('cms_verification_failed');report.stages.cms=true;
 stage='astro';let astro=start(['dist/server/entry.mjs'],root,astroEnv,'astro');await ready('http://127.0.0.1:4321/health',astro);
 const content=await verifyContent();if(!content.success)throw new Error('render_verification_failed');report.stages.content=true;
 stage='crm';const crm=await verifyLeads();writeFileSync(resolve(reports,'crm.json'),JSON.stringify(crm,null,2));report.stages.crm=true;
 stage='crm-outage';await stop(astro);astro=start(['dist/server/entry.mjs'],root,{...astroEnv,TWENTY_BASE_URL:'http://127.0.0.1:1'},'astro-outage');await ready('http://127.0.0.1:4321/health',astro);const outage=await verifyLeads({unavailable:true});writeFileSync(resolve(reports,'crm-outage.json'),JSON.stringify(outage,null,2));report.stages.outage=true;
 report.success=true;
}catch(e){report.error={stage,message:e.message};console.error(JSON.stringify(report.error));process.exitCode=1;
 // Emit only bounded redacted startup diagnostics, never raw service/CRM logs.
 if(stage==='cms') {let log='';try{log=readFileSync('.ci/private/cms.log','utf8');}catch{}for(const s of secrets)log=log.replaceAll(s,'[secret]');log=log.replaceAll(process.env.TWENTY_DB_PASSWORD,'[secret]');console.error(log.slice(-6000));}
}finally{for(const child of children)await stop(child);await new Promise(r=>proxy.close(r));writeFileSync(resolve(reports,'acceptance.json'),JSON.stringify(report,null,2));}
