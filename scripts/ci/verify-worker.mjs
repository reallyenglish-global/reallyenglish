import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export async function verifyWorker(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');
 const {workspaceId}=JSON.parse(readFileSync('.ci/private/twenty.json','utf8'));
 const id=execFileSync('docker',['compose','-f','compose.ci.yml','ps','-q','twenty-worker'],{encoding:'utf8'}).trim();
 const container=JSON.parse(execFileSync('docker',['inspect',id],{encoding:'utf8'}))[0];assert.equal(container.State.Running,true);
 // Read retained BullMQ completion records only; never emit job payloads/logs.
 const script=`const {Queue}=require('bullmq');(async()=>{const rows=[];for(const name of ['workspace-queue','trigger-queue','entity-events-to-db-queue']){const q=new Queue(name,{connection:{host:'redis',port:6379}});for(const j of await q.getJobs(['completed'],0,499)){if(j.data?.workspaceId===process.argv[1]&&j.finishedOn)rows.push({queue:name,name:j.name,id:j.id,processedOn:j.processedOn,finishedOn:j.finishedOn});}await q.close();}console.log(JSON.stringify(rows));})().catch(()=>process.exit(1));`;
 let rows=[];
 for(let i=0;i<30;i++){
  rows=JSON.parse(execFileSync('docker',['compose','-f','compose.ci.yml','exec','-T','twenty-worker','node','-e',script,workspaceId],{encoding:'utf8',timeout:30000}));
  if(rows.length)break;await new Promise(r=>setTimeout(r,2000));
 }
 const report={success:rows.length>0,workspaceId,workerRunning:true,completed:rows};writeFileSync('.ci/reports/worker.json',JSON.stringify(report,null,2));
 assert.ok(report.success,'No completed workspace job: worker presence is not consumption evidence');return report;
}
