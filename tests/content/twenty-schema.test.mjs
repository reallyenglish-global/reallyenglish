import test from 'node:test';
import assert from 'node:assert/strict';
import {leadFieldDefinition} from '../../scripts/ci/twenty-schema.mjs';
test('Twenty required fields carry type-compatible non-null defaults',()=>{
 for(const [name,type,value] of [['firstName','TEXT',"''"],['dedupKey','TEXT',"''"],['consent','BOOLEAN',false],['consentAt','DATE_TIME','now']]){
  const f=leadFieldDefinition('object',name,type);
  assert.equal(f.isNullable,false);assert.equal(f.defaultValue,value);
  assert.equal(f.isUnique,name==='dedupKey');
 }
 const optional=leadFieldDefinition('object','companyName','TEXT');
 assert.equal(optional.isNullable,true);assert.equal(optional.defaultValue,null);
});
