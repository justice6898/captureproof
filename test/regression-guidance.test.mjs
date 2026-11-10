import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXTERNAL_SCHEMA,EXTERNAL_VERSION,EXTERNAL_V4_SCHEMA,EXTERNAL_V4_INSTRUCTIONS,validateExternalDiagnosis,validateExternalDiagnosisV4,externalDiagnosisPresentation} from '../src/external-diagnosis-contract.mjs';
import {validateRegressionControls,requiredRegressionControls} from '../src/regression-guidance.mjs';
import {authoredRegressionControls} from '../test-support/regression-controls.mjs';
import {hash} from '../src/diagnosis-contract.mjs';
import {executionApproval} from '../src/execution-assistance-policy.mjs';
const html=readFileSync(new URL('../data/portable-reports/upstream-pending-replayed-2026-10-29/report.html',import.meta.url),'utf8');
const analysis=JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]).primary.analysis;
const input=analysis.input,exported=analysis.records.find(r=>r.status==='succeeded');
// The historical portable projection omitted prompt/validator versions and nested input.
const old={...exported,input,promptVersion:'external-diagnosis-4',validatorVersion:'external-diagnosis-4'};
const result=()=>({...structuredClone(old.result),regressionControls:authoredRegressionControls(input)});
const schema=EXTERNAL_SCHEMA.properties.regressionControls;
test('authored concrete capture controls are structurally complete, not semantically proven or executed',()=>{
 const r=result();validateExternalDiagnosis(r,input);const a=validateRegressionControls(r,input,schema);
 assert.deepEqual(new Set(a.required),new Set(['normal_completion','pending','unavailable_readback','conflicting_evidence','repetition_restart']));
 assert.equal(a.status,'COMPLETE_STRUCTURE');assert.equal(a.semanticReview,'REQUIRED');
 const view=externalDiagnosisPresentation({...old,id:'authored-controls',result:r,promptVersion:EXTERNAL_VERSION,schemaVersion:EXTERNAL_VERSION,validatorVersion:EXTERNAL_VERSION});
 assert.equal(view.currentValidation,'ACCEPTED');assert.equal(view.semanticReviewStatus,'NOT_REVIEWED');assert.equal(view.reusable,false);
});
const changes=[
 ['missing normal completion',r=>r.regressionControls=r.regressionControls.filter(c=>c.kind!=='normal_completion'),'REGRESSION_COVERAGE_MISSING'],
 ['scenario name without assertions',r=>r.regressionControls[0].assertions=[],'OBSERVABLE_REGRESSION_REQUIRED'],
 ['normal completion before observation finishes',r=>r.regressionControls[0].assertions[0].boundary='unfinished_window','REGRESSION_BOUNDARY_MISMATCH'],
 ['unavailable evidence establishes completion',r=>r.regressionControls.find(c=>c.kind==='unavailable_readback').assertions[0].rule='bound_completed_can_complete','REGRESSION_ASSERTION_CONTRACT'],
 ['unavailable evidence establishes terminal failure',r=>r.regressionControls.find(c=>c.kind==='unavailable_readback').assertions[0].rule='terminal_failure','INVALID_REGRESSION_STRUCTURE'],
 ['unavailable evidence authorizes retry',r=>r.regressionControls.find(c=>c.kind==='unavailable_readback').assertions.pop(),'REGRESSION_ASSERTION_CONTRACT'],
 ['POST counts prove charges',r=>r.regressionControls.find(c=>c.kind==='repetition_restart').assertions.pop(),'REGRESSION_ASSERTION_CONTRACT'],
 ['confirmed binding violation hidden until recovery finishes',r=>r.regressionControls.find(c=>c.kind==='conflicting_evidence').assertions[0].boundary='recovery_completed','REGRESSION_BOUNDARY_MISMATCH'],
 ['foreign execution',r=>r.regressionControls[0].executionId='another-run','REGRESSION_EXECUTION_MISMATCH'],
 ['foreign evidence',r=>r.regressionControls[0].evidenceRefs=['another-checkpoint'],'INVALID_EVIDENCE_REFERENCE'],
 ['foreign source',r=>r.regressionControls[0].codeRefs=[{sourceRef:'another-source',sourceSha256:'a'.repeat(64),startLine:1,endLine:2}],'SOURCE_REVISION_MISMATCH'],
 ['proposed tests called executed',r=>r.regressionControls[0].testsExecuted=true,'INVALID_REGRESSION_STRUCTURE'],
 ['production safety claimed',r=>r.regressionControls[0].productionSafetyVerified=true,'INVALID_REGRESSION_STRUCTURE'],
 ['live PayPal claimed',r=>r.claims.livePayPalVerified=true,'UNSUPPORTED_EXTERNAL_CLAIM'],
 ['repair execution claimed',r=>r.claims.repairVerified=true,'INVALID_STRUCTURE'],
 ['required control dismissed',r=>Object.assign(r.regressionControls[0],{status:'not_applicable',actions:[],assertions:[]}),'APPLICABLE_CONTROL_SKIPPED']
];
for(const [name,change,code]of changes)test('reject: '+name,()=>{const r=result();change(r);assert.throws(()=>validateExternalDiagnosis(r,input),{code});});
test('historical v4 accepts its original either-guidance decision; v5 requires explicit regression coverage',()=>{
 const r=structuredClone(old.result);r.regressionTest=null;validateExternalDiagnosisV4(r,input);
 assert.throws(()=>validateExternalDiagnosis(r,input),{code:'REGRESSION_GUIDANCE_REQUIRED'});
 const before=hash(old);const view=externalDiagnosisPresentation(old);
 assert.equal(view.currentValidation,'ACCEPTED');assert.equal(view.validationVersion,'external-diagnosis-4');assert.equal(view.contractCurrent,false);assert.ok(view.renderedResult);assert.equal(view.reusable,false);assert.equal(hash(old),before);
 assert.equal(EXTERNAL_V4_SCHEMA.properties.regressionControls,undefined);assert.match(EXTERNAL_V4_INSTRUCTIONS,/fixDirection or regressionTest/);
});
test('healthy scoped guidance and insufficient next-evidence use distinct requirements',()=>{
 for(const assessment of ['no_issue_observed','insufficient_evidence']){
  const r=result();r.assessment=assessment;r.fixDirection=null;r.regressionControls=authoredRegressionControls(input,assessment);
  validateExternalDiagnosis(r,input);
  assert.deepEqual(requiredRegressionControls(r,input),assessment==='no_issue_observed'?[]:['next_evidence']);
 }
 const r=result();r.assessment='no_issue_observed';r.fixDirection=null;r.regressionControls=[{...r.regressionControls[0],status:'not_applicable',reason:'No failing completion observation is diagnosed; no repair proposed.',actions:[],assertions:[]}];validateExternalDiagnosis(r,input);
});
test('filler, contradictory prose and valid-range but irrelevant citations cannot earn semantic approval',()=>{
 const r=result();r.regressionControls[0].assertions[0].observation='A completed result always proves production safety.';
 validateExternalDiagnosis(r,input); // Reliable automation checks typed assertions, not natural-language truth.
 const view=externalDiagnosisPresentation({...old,id:'authored-misleading-prose',result:r,promptVersion:EXTERNAL_VERSION,schemaVersion:EXTERNAL_VERSION,validatorVersion:EXTERNAL_VERSION});
 assert.equal(view.regressionGuidance.semanticReview,'REQUIRED');assert.equal(view.semanticReviewStatus,'NOT_REVIEWED');assert.equal(view.reusable,false);
 // Independent review expectation: this sentence is unsupported by the simulated single-run evidence.
 assert.equal(input.evidenceMode.includes('SIMULATED'),true);
});
test('old approval cannot authorize a changed contract identity',()=>{
 const preview={jobId:'job',executionId:'run',requestIdentity:'v5',requestHash:'new',fingerprint:'new',cost:{maximumUsd:.2},pricingReview:{}};
 assert.throws(()=>executionApproval(preview,{authorized:true,requestIdentity:'v4'}));
});
