import {readFileSync,writeFileSync} from 'node:fs';
const read=name=>{try{return JSON.parse(readFileSync('.ci/reports/'+name+'.json','utf8'));}catch{return null;}};
const inventory=read('inventory'),cms=read('cms'),content=read('content'),acceptance=read('acceptance');
const rows=(inventory?.pages||[]).map(p=>{
 const seeded=cms?.pages?.filter(x=>x.key===p.key)||[],rendered=content?.pages?.filter(x=>x.key===p.key)||[];
 return {key:p.key,path:p.path,locale:p.locale,source:p.source,assets:p.assets,seeded:seeded.length===1&&seeded[0].success===true,rendered:rendered.length===1&&rendered[0].success===true,documentId:seeded[0]?.documentId,seedStatus:seeded[0]?.status,renderStatus:rendered[0]?.status};
});
const report={sha:process.env.GITHUB_SHA,success:acceptance?.success===true,manifestHash:inventory?.manifestHash,totals:{...inventory?.coverage,pages:rows.length,seeded:rows.filter(x=>x.seeded).length,rendered:rows.filter(x=>x.rendered).length,failed:inventory?.failed?.length,excluded:inventory?.excluded?.length},pages:rows,dispositions:inventory?.dispositions||[],sourceDefects:inventory?.sourceDefects||[],productionGates:{approved:false,editorialApproved:false,sourceDefectsResolved:false,securityReviewApproved:false,productionCredentialsApproved:false},stages:acceptance?.stages||{}};
writeFileSync('.ci/reports/coverage.json',JSON.stringify(report,null,2));console.log(JSON.stringify({coverage:report.totals,technicalSuccess:report.success,productionApproved:false}));
