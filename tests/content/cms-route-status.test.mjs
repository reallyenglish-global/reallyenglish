import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {dev} from 'astro';

test('public article route distinguishes missing content from CMS outage',async t=>{
  let status=404;
  const cms=createServer((req,res)=>{res.writeHead(status).end()});
  await new Promise(resolve=>cms.listen(0,'127.0.0.1',resolve)); t.after(()=>cms.close());
  process.env.CMS_API_URL=`http://127.0.0.1:${cms.address().port}`; process.env.CMS_READ_TOKEN='synthetic';
  const site=await dev({server:{host:'127.0.0.1',port:0},logLevel:'silent'}); t.after(()=>site.stop());
  for(status of [404,503]){
    const res=await fetch(`http://localhost:${site.address.port}/about`,{headers:{Host:'localhost'}});
    assert.equal(res.status,status,(await res.text()).slice(0,1600));
  }
});
