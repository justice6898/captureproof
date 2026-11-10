import test from 'node:test';import assert from 'node:assert/strict';
import {createVerificationCapability,isolationCapability} from '../src/verification-setup.mjs';
test('capability distinguishes missing dependencies, denied sandbox, timeout and ready; caches polling but rechecks admission',()=>{
 let time=0,checks=0,available=true;const get=createVerificationCapability({now:()=>time,dependencies:()=>({ready:true}),probe:()=>{checks++;return {ready:available,code:available?'ISOLATION_READY':'ISOLATION_UNAVAILABLE'};}});
 assert.equal(get().ready,true);for(let i=0;i<100;i++)get();assert.equal(checks,1);available=false;assert.equal(get().ready,true);assert.equal(get({force:true}).ready,false);time=30001;get();assert.equal(checks,3);
 let probed=false;assert.equal(createVerificationCapability({dependencies:()=>({ready:false,code:'MISSING'}),probe:()=>{probed=true;}})().code,'MISSING');assert.equal(probed,false);
 for(const [result,code]of [[{status:0},'ISOLATION_READY'],[{status:71,stderr:'sandbox_apply: Operation not permitted'},'ISOLATION_UNAVAILABLE'],[{error:{code:'ETIMEDOUT'}},'ISOLATION_PROBE_TIMEOUT'],[{error:{code:'ENOENT'}},'ISOLATION_UNAVAILABLE']])assert.equal(isolationCapability({run:(bin,args,opts)=>{assert.equal(bin,'/usr/bin/sandbox-exec');assert.equal(args.at(-1),'/usr/bin/true');assert.equal(opts.timeout,2000);return result;}}).code,code);
});
