import test from 'node:test';import assert from 'node:assert/strict';
import {resultHeadline,checkpointPresentation,compareRuleObservations,scenarioFinding,checkpointDescription,jobPresentation} from '../public/verification-state.mjs';
import {campaignSummary,CORE_CAMPAIGN}from'../src/regression-campaign.mjs';
import {decisionCases,cp,run}from'../test-support/developer-meaning-fixtures.mjs';
const A='EXACT_BINDING',B='PENDING_NOT_COMPLETED';
for(const[name,b,c,outcome,resolved,introduced,remaining]of decisionCases)test('meaning: '+name,()=>{const got=compareRuleObservations(b,c);assert.equal(got.outcome,outcome);assert.deepEqual(got.resolved,resolved);assert.deepEqual(got.introduced,introduced);assert.deepEqual(got.remaining,remaining);});
test('one-sided violations stay visible without attributing regression or repair',()=>{const f=scenarioFinding(null,run(cp([B])));assert.match(f.finding,/Candidate: Payment was committed/);assert.doesNotMatch(f.finding,/regression|No violation/);assert.match(f.comparison.summary,/Comparison unavailable/);assert.deepEqual(scenarioFinding(run(cp([A])),null).comparison.resolved,[]);});
test('zero, missing and uncollected counters and capture rows remain distinct',()=>{assert.match(checkpointDescription(cp()),/0 active capture rows/);assert.match(checkpointDescription({...cp(),afterShutdown:undefined}),/Unknown.*Unknown active capture rows/);const c=cp();c.counters={posts:0,accepted:null};assert.equal(c.counters.posts,0);assert.equal(c.counters.accepted,null);});
test('mixed campaign counts pairs, allows overlapping rule-change categories and excludes incomplete pairs',()=>{const s=CORE_CAMPAIGN.cases[0],b=run(cp([A]),cp([A])),c=run(cp([B]),cp([B]));const summary=campaignSummary([{caseId:s.id,role:'baseline',trace:b},{caseId:s.id,role:'candidate',trace:c},{caseId:CORE_CAMPAIGN.cases[1].id,role:'candidate',trace:run(cp([B]))}]);assert.equal(summary.resolved,1);assert.equal(summary.regressions,1);const v=jobPresentation({state:'FAILED',executions:[b,c,{}],summary});assert.equal(v.observedPairs,1);assert.equal(v.plannedPairs,4);assert.equal(v.comparison,'PARTIAL');assert.equal(v.counts.resolved,1);assert.equal(v.counts.regressions,1);});


test('similar completed summaries expose recorded stored-capture disagreement without recomputing verdicts',()=>{
 const make=stored=>({providerCapture:{id:'capture-1',status:'COMPLETED'},afterShutdown:{collection:{status:'completed'},captures:[{}],payment:{storedCaptures:[{id:'capture-1',status:stored}]}},verdict:{status:'FAIL',rules:[{id:'EXACT_BINDING',status:'FAIL',reason:'Recorded binding violation'}]}});
 const original=make('PENDING'),before=JSON.stringify(original),v=checkpointPresentation(original);
 assert.equal(v.status,'FAIL');assert.match(v.reasons[0],/provider capture is COMPLETED.*stored capture is PENDING/);assert.equal(v.facts[1][1],'completed');assert.equal(v.facts[2][1],'PENDING');assert.equal(v.facts[3][1],1);
 const repair=make('COMPLETED');repair.verdict={status:'PASS',rules:[]};assert.equal(checkpointPresentation(repair).facts[2][1],'COMPLETED');assert.equal(checkpointPresentation(repair).status,'PASS');assert.equal(JSON.stringify(original),before);
 // Equal high-level values do not override a recorded FAIL.
 const stillFail=make('COMPLETED');assert.equal(checkpointPresentation(stillFail).status,'FAIL');assert.match(checkpointPresentation(stillFail).reasons[0],/Recorded binding violation/);
});
test('missing, unrelated and ambiguous stored captures remain unknown rather than inferred',()=>{
 const c={providerCapture:{id:'a',status:'COMPLETED'},verdict:{status:'INCONCLUSIVE',uncertainty:{reason:'Window unfinished'}}};
 assert.equal(checkpointPresentation(c).facts[2][1],'Unknown');assert.equal(checkpointPresentation(c).status,'INCONCLUSIVE');assert.equal(checkpointPresentation(c).uncertainty,'Window unfinished');assert.equal(checkpointPresentation(null).status,'UNAVAILABLE');
 for(const stored of [[{id:'b',status:'PENDING'}],[{id:'a',status:'PENDING'},{id:'a',status:'COMPLETED'}]]){c.afterShutdown={payment:{storedCaptures:stored}};const v=checkpointPresentation(c);assert.equal(v.facts[2][1],'No unique matching capture');assert.ok(!v.reasons.join(' ').includes('is PENDING'));}
 c.afterShutdown.payment.storedCaptures=[];assert.equal(checkpointPresentation(c).facts[2][1],'Not stored');
});

test('display headline requires the recorded pending violation and never rewrites canonical findings',()=>{
 const c=cp(['PENDING_NOT_COMPLETED']),before=JSON.stringify(c);assert.equal(resultHeadline(c),'Payment marked paid before capture completed.');assert.equal(JSON.stringify(c),before);
 assert.equal(resultHeadline({...c,verdict:{status:'INCONCLUSIVE',rules:[]}},'Unknown'),'Unknown');assert.equal(resultHeadline(null,'Not observed'),'Not observed');assert.equal(resultHeadline({...c,providerCapture:{status:'COMPLETED'}},'Recorded failure'),'Recorded failure');
});


test('shared fragment decoding handles malformed encodings without interrupting initialization', async () => {
 const {runInNewContext}=await import('node:vm');const {readFileSync}=await import('node:fs');
 const context={window:{addEventListener(){}},location:{hash:''}};
 runInNewContext(readFileSync(new URL('../public/result-view.js',import.meta.url),'utf8'),context);
 const revealed=[];context.window.revealCaptureTarget=id=>revealed.push(id);
 for(const value of ['#%','#%E0%A4%A','#%GG','']){context.location.hash=value;assert.equal(context.window.captureFragment(),'');assert.doesNotThrow(()=>context.window.revealCaptureFragment());}
 assert.deepEqual(revealed,[]);
 for(const [hash,id] of [['#source-0-46','source-0-46'],['#%73ource-0-46','source-0-46'],['#unknown','unknown']]){context.location.hash=hash;assert.equal(context.window.captureFragment(),id);context.window.revealCaptureFragment();assert.equal(revealed.at(-1),id);}
});
