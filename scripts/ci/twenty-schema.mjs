import assert from 'node:assert/strict';
const definitions = {
 firstName:'TEXT',lastName:'TEXT',email:'TEXT',companyName:'TEXT',message:'TEXT',brandSlug:'TEXT',
 sourceUrl:'TEXT',sourcePath:'TEXT',locale:'TEXT',consent:'BOOLEAN',consentAt:'DATE_TIME',
 submissionId:'TEXT',dedupKey:'TEXT',consentVersion:'TEXT',payloadHash:'TEXT',
};
export async function provisionLeadSchema(base, key) {
 const request=async(path,body)=>{
  const response=await fetch(`${base}/rest/metadata/${path}`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error(`metadata_${path}_${response.status}`);
  return response.json();
 };
 const unwrap=(value,plural)=>{
  const candidate=value.data?.[plural] ?? value.data ?? value[plural] ?? value;
  if(Array.isArray(candidate)) return candidate;
  if(candidate.edges) return candidate.edges.map(e=>e.node);
  throw new Error(`metadata_shape_${plural}:${Object.keys(value).join(',')}`);
 };
 let objects=unwrap(await request('objects'),'objects');
 let object=objects.find(o=>o.nameSingular==='websiteLead');
 if(!object) {
  await request('objects',{nameSingular:'websiteLead',namePlural:'websiteLeads',labelSingular:'Website Lead',labelPlural:'Website Leads',skipNameField:false});
  objects=unwrap(await request('objects'),'objects'); object=objects.find(o=>o.nameSingular==='websiteLead');
 }
 assert.ok(object?.id,'object_readback');
 assert.equal(object.namePlural,'websiteLeads');
 let fields=unwrap(await request('fields'),'fields').filter(f=>f.objectMetadataId===object.id);
 for(const [name,type] of Object.entries(definitions)) {
  const found=fields.find(f=>f.name===name);
  if(found) {assert.equal(found.type,type);continue;}
  await request('fields',{objectMetadataId:object.id,name,label:name.replace(/([A-Z])/g,' $1'),type,isNullable:name==='companyName',isUnique:name==='dedupKey'});
 }
 fields=unwrap(await request('fields'),'fields').filter(f=>f.objectMetadataId===object.id);
 for(const [name,type] of Object.entries(definitions)) {const f=fields.find(f=>f.name===name);assert.equal(f?.type,type);assert.equal(f?.isUnique,name==='dedupKey');}
 for(let i=0;i<30;i++) {
  const response=await fetch(`${base}/rest/websiteLeads`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
  if(response.ok) return {objectId:object.id,fields:Object.keys(definitions)};
  await new Promise(r=>setTimeout(r,2000));
 }
 throw new Error('lead_api_readiness_timeout');
}
