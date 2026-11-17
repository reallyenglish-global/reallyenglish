import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
export async function verifyPublication(token){
 const hook=JSON.parse(readFileSync('.ci/reports/cms-hook.json','utf8')),probe=hook.draftOnly;
 const endpoint='http://127.0.0.1:1337/api/site/ci-publication';
 const mutate=(action,key=token)=>fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({action})});
 const page=()=>fetch('http://127.0.0.1:4321'+probe.path,{redirect:'manual'});
 const report={success:false,checks:[]};
 try{
  assert.equal((await mutate('publish',process.env.CMS_READ_TOKEN)).status,401);report.checks.push('read-token-cannot-write');
  assert.equal((await page()).status,404);report.checks.push('draft-absent');
  assert.equal((await mutate('publish')).status,200);
  let response=await page();assert.equal(response.status,200);assert.ok((await response.text()).includes(probe.sentinel));report.checks.push('published-visible');
  assert.equal((await mutate('draft-update')).status,200);
  response=await page();let html=await response.text();assert.equal(response.status,200);assert.ok(html.includes(probe.sentinel));assert.ok(!html.includes(probe.sentinel+'_LIVE'));report.checks.push('draft-update-isolated');
  assert.equal((await mutate('publish')).status,200);response=await page();assert.equal(response.status,200);assert.ok((await response.text()).includes(probe.sentinel+'_LIVE'));report.checks.push('published-update-without-rebuild');
  assert.equal((await mutate('unpublish')).status,200);assert.equal((await page()).status,404);report.checks.push('unpublish-absent');report.success=true;
 }finally{writeFileSync('.ci/reports/publication.json',JSON.stringify(report,null,2));}
 return report;
}
