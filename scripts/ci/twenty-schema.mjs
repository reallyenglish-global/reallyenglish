import assert from 'node:assert/strict';
const definitions = {
 firstName:'TEXT',lastName:'TEXT',email:'TEXT',companyName:'TEXT',message:'TEXT',brandSlug:'TEXT',
 sourceUrl:'TEXT',sourcePath:'TEXT',locale:'TEXT',consent:'BOOLEAN',consentAt:'DATE_TIME',
 submissionId:'TEXT',dedupKey:'TEXT',consentVersion:'TEXT',payloadHash:'TEXT',
};
// Pinned Twenty d690a8c: unique scalar indexes reject defined defaults.
// Creation permits non-null TEXT without a default; the null-default guard in
// flat-field-metadata-validator.service.ts applies to UPDATE, not CREATE.
// Never mutate dedupKey's constraints or add a shared empty-string default.
export function leadFieldDefinition(objectMetadataId, name, type) {
 return {objectMetadataId,name,label:name.replace(/([A-Z])/g,' $1'),type,
  isNullable:name==='companyName',isUnique:name==='dedupKey',
  ...(name==='dedupKey'?{}:{defaultValue:name==='companyName'?null:type==='TEXT'?"''":type==='BOOLEAN'?false:'now'})};
}
export const isDeferredDdlRefusal = result => typeof result==='string' && /^\d+ deferred schema operation\(s\) are still running on workspace [a-f0-9-]+$/.test(result);
export async function provisionLeadSchema(base, key) {
 const request=async(path,body)=>{
  const deadline=Date.now()+180000;
  for(;;){
  const response=await fetch(`${base}/rest/metadata/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  if(!response.ok) {
   const result=await response.json().catch(()=>({}));
   // Pinned schema-operation executor explicitly refuses the next migration while
   // deferred DDL runs. Only this pre-mutation refusal is safe to retry; arbitrary
   // 500s and validation errors are never suppressed or blindly replayed.
   if(isDeferredDdlRefusal(result) && Date.now()<deadline){
    console.log(JSON.stringify({stage:'schema-ddl-wait',path,field:body?.name}));
    await new Promise(r=>setTimeout(r,2000));continue;
   }
   const messages=[result?.message,...(Array.isArray(result?.errors)?result.errors:[]).map(e=>e.message)].filter(x=>typeof x==='string').map(x=>x.replace(/[A-Za-z0-9_.-]{32,}/g,'[redacted]').slice(0,300));
   console.error(JSON.stringify({stage:'metadata',method:body?'POST':'GET',path,status:response.status,field:body?.name,type:body?.type,messages,responseShape:JSON.stringify(result).replace(/[A-Za-z0-9_.-]{32,}/g,'[redacted]').slice(0,5000)}));
   throw new Error(`metadata_${path}_${response.status}`);
  }
  return response.json();
  }
 };
 const unwrap=(value,plural)=>{
  const candidate=value.data?.[plural] ?? value.data ?? value[plural] ?? value;
  if(Array.isArray(candidate)) return candidate;
  if(candidate.edges) return candidate.edges.map(e=>e.node);
  throw new Error(`metadata_shape_${plural}:${Object.keys(value).join(',')}`);
 };
 const requestOne=request;
 const list=async(path,plural)=>{
  const rows=[];let cursor;
  for(let page=0;page<50;page++){
   const value=await requestOne(`${path}?limit=100${cursor?'&starting_after='+encodeURIComponent(cursor):''}`);
   const batch=unwrap(value,plural);rows.push(...batch);
   const info=value.pageInfo || value.data?.pageInfo;
   if(info?.hasNextPage===false || (!info && batch.length<100)) return rows;
   const next=info?.endCursor || batch.at(-1)?.id;
   if(!next || next===cursor)throw new Error('metadata_pagination_stalled');
   cursor=next;
  }throw new Error('metadata_pagination_limit');
 };
 let objects=await list('objects','objects');
 let object=objects.find(o=>o.nameSingular==='websiteLead');
 if(!object) {
  await request('objects',{nameSingular:'websiteLead',namePlural:'websiteLeads',labelSingular:'Website Lead',labelPlural:'Website Leads',skipNameField:false});
  objects=await list('objects','objects'); object=objects.find(o=>o.nameSingular==='websiteLead');
 }
 assert.ok(object?.id,'object_readback');
 assert.equal(object.namePlural,'websiteLeads');
 let fields=(await list('fields','fields')).filter(f=>f.objectMetadataId===object.id);
 for(const [name,type] of Object.entries(definitions)) {
  const found=fields.find(f=>f.name===name);
  if(found) {assert.equal(found.type,type);continue;}
  await request('fields',leadFieldDefinition(object.id,name,type));
 }
 fields=(await list('fields','fields')).filter(f=>f.objectMetadataId===object.id);
 for(const [name,type] of Object.entries(definitions)) {const f=fields.find(f=>f.name===name);assert.equal(f?.type,type);assert.equal(f?.isUnique,name==='dedupKey');assert.equal(f?.isNullable,name==='companyName');if(name==='dedupKey')assert.equal(f.defaultValue ?? null,null);}
 for(let i=0;i<30;i++) {
  const response=await fetch(`${base}/rest/websiteLeads`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
  if(response.ok) return {objectId:object.id,fields:Object.keys(definitions)};
  await new Promise(r=>setTimeout(r,2000));
 }
 throw new Error('lead_api_readiness_timeout');
}
