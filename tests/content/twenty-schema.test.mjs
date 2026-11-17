import test from 'node:test';
import assert from 'node:assert/strict';
import {leadFieldDefinition,isDeferredDdlRefusal} from '../../scripts/ci/twenty-schema.mjs';
test('only explicit deferred-DDL pre-mutation refusal is retryable',()=>{
 assert.equal(isDeferredDdlRefusal('8 deferred schema operation(s) are still running on workspace 12345678-1234-1234-1234-123456789abc'),true);
 for(const value of [{message:'Internal Server Error'},'Internal Server Error','already created','Default value cannot be null',null])assert.equal(isDeferredDdlRefusal(value),false);
});
test('Twenty required fields carry type-compatible non-null defaults',()=>{
 for(const [name,type,value] of [['firstName','TEXT',"''"],['consent','BOOLEAN',false],['consentAt','DATE_TIME','now']]){
  const f=leadFieldDefinition('object',name,type);
  assert.equal(f.isNullable,false);assert.equal(f.defaultValue,value);
  assert.equal(f.isUnique,name==='dedupKey');
 }
 const unique=leadFieldDefinition('object','dedupKey','TEXT');
 assert.equal(unique.isNullable,false);
 assert.equal(unique.isUnique,true);
 assert.equal(Object.hasOwn(unique,'defaultValue'),false,'unique scalar defaults are rejected by pinned Twenty');
 const optional=leadFieldDefinition('object','companyName','TEXT');
 assert.equal(optional.isNullable,true);assert.equal(optional.defaultValue,null);
});
