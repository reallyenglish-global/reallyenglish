import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const m=JSON.parse(readFileSync('.ci/content/manifest.json','utf8'));
const report={manifestHash:m.manifestHash,coverage:m.coverage,technicalSuccess:m.technicalSuccess,editorialSuccess:m.editorialSuccess,failed:m.failed,pending:m.pending,issues:m.inventoryIssues,sourceDefects:m.sourceDefects,discovered:m.discovered,redirects:m.redirects,excluded:m.excluded,terminal:m.terminal,pages:m.pages.map(p=>({key:p.key,path:p.path,locale:p.locale,contentHash:p.contentHash,source:p.source,assets:p.assets}))};
mkdirSync('.ci/reports',{recursive:true});
writeFileSync('.ci/reports/inventory.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({failed:m.failed,issues:m.inventoryIssues,pages:m.pages.length},null,2));
