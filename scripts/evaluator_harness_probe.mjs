import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const {Registry,run,score,suite,schemas} = await import(pathToFileURL(process.argv[2]).href);
const root = await fs.mkdtemp(path.join(os.tmpdir(),'waypoint-probe-'));
const registry = new Registry(root);
const checks=[];
const check=async(title,fn)=>{try{await fn();checks.push({title,passed:true});}catch(error){checks.push({title,passed:false,error:String(error.message)});}};
try {
 await check('Six function schemas expose strict argument validation',async()=>{
   assert.equal(schemas.length,6);assert.ok(schemas.every(s=>s.function.parameters.additionalProperties===false));
 });
 await check('Arithmetic respects parentheses, precedence and finite results',async()=>{
   for(const [expression,expected] of [['2+3*4','14'],['(2+3)*4','20'],['-5+2','-3'],['17*23+9','400']]) assert.equal(await registry.call('calculator',{expression}),expected);
   for(const expression of ['1/0','process.exit()','2**3','1/*a*/+1']) await assert.rejects(()=>registry.call('calculator',{expression}));
 });
 await check('Round-trip file content including Unicode',async()=>{
   await registry.call('file_write',{path:'sub/test.txt',content:'hello \u0645\u0631\u062d\u0628\u0627'});
   assert.equal(await registry.call('file_read',{path:'sub/test.txt'}),'hello \u0645\u0631\u062d\u0628\u0627');
 });
 await check('File traversal, absolute paths and invalid schemas are rejected',async()=>{
   for(const args of [{path:'../outside'},{path:path.resolve(root,'../outside')},{path:'x',extra:true}]) await assert.rejects(()=>registry.call('file_read',args));
   for(const args of [null,[],{expression:3},{expression:'1',extra:'x'}]) await assert.rejects(()=>registry.call('calculator',args));
 });
 await check('HTTP tool rejects localhost, non-HTTPS and embedded credentials without making a request',async()=>{
   for(const url of ['https://localhost/','http://example.com/','https://user:pass@example.com/','https://example.com:8000/']) await assert.rejects(()=>registry.call('http_fetch',{url}));
 });
 await check('Model loop sends real tool observations and accounts for model usage exactly once',async()=>{
   let turn=0; const client={complete:async(messages)=>{
     if(turn===1) assert.deepEqual(JSON.parse(messages.at(-1).content),{ok:true,output:'400'});
     const message=turn++===0?{role:'assistant',tool_calls:[{id:'1',function:{name:'calculator',arguments:'{"expression":"17*23+9"}'}}]}:{role:'assistant',content:'400'};
     return {choices:[{message}],usage:{total_tokens:10}};
   }};
   const result=await run(client,suite[0].task,registry);assert.equal(result.error,null);assert.equal(score(suite[0],result).tokens,20);assert.equal(score(suite[0],result).passed,true);
 });
 await check('API errors remain explicit failures',async()=>{
   const result=await run({complete:async()=>{throw Error('HTTP 503 simulated');}},'task',registry);
   assert.equal(result.error,'HTTP 503 simulated');assert.equal(score(suite[0],result).passed,false);
 });
 await check('Task scoring rejects an incorrect numeric answer that contains the expected digits',async()=>{
   const result={error:null,final:'4000',trace:[{kind:'tool',tool:'calculator',ok:true,output:'400'}]};
   assert.equal(score(suite[0],result).passed,false,'Expected 400; incorrect final answer 4000 was accepted');
 });
 await check('Task scoring rejects a negated expected answer',async()=>{
   const result={error:null,final:'The answer is not 400.',trace:[{kind:'tool',tool:'calculator',ok:true,output:'400'}]};
   assert.equal(score(suite[0],result).passed,false,'Negated answer was accepted as a success');
 });
} finally {await fs.rm(root,{recursive:true,force:true});}
console.log(JSON.stringify({checks,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,limitations:['No Docker invoked','No live paid model requests','HTTP allowlist checks do not exercise successful external requests']},null,2));
if(checks.some(c=>!c.passed)) process.exitCode=1;
