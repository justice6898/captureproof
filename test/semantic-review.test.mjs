import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {semanticReviewCases} from '../test-support/semantic-review-cases.mjs';
import {externalSemanticReview,withRetainedResponse,inspectClaimReview,semanticReuseAllowed,reviewableClaims} from '../src/external-diagnosis-review.mjs';
import {externalDiagnosisPresentation,validateExternalDiagnosis,EXTERNAL_VERSION} from '../src/external-diagnosis-contract.mjs';
import {reportHTML} from '../src/portable-report.mjs';import {hash} from '../src/diagnosis-contract.mjs';
const cases=semanticReviewCases(),reviews=JSON.parse(readFileSync(new URL('../test-support/semantic-review-assessments.json',import.meta.url)));
// The answer key is used only after recorded manual judgments; no production checker imports it.
const expected=JSON.parse(readFileSync(new URL('../test-support/semantic-review-expectations.json',import.meta.url))).cases;
for(const c of cases)test(`authored case ${c.id}: recorded claim judgment, scope and evidence binding survive presentation`,()=>{
 const before=hash(c.record);validateExternalDiagnosis(c.record.result,c.record.input);
 const initial=externalDiagnosisPresentation(c.record,c.record.input,{reviews:{}});assert.equal(initial.currentValidation,'ACCEPTED');assert.equal(initial.regressionGuidance.status,'COMPLETE_STRUCTURE');assert.equal(initial.semanticReviewStatus,'NOT_REVIEWED');assert.equal(initial.reusable,false);
 const shown=externalDiagnosisPresentation(c.record,c.record.input,{reviews}),review=shown.semanticReview;
 assert.equal(review.metadataValidation,'PASS');assert.equal(review.claims[0].disposition,expected[c.id].disposition);
 assert.equal(shown.currentValidation,'ACCEPTED');assert.equal(shown.reusable,false,'authored cases are not model caches');
 assert.equal(shown.semanticReviewStatus,['03','04','05','06','07','08','09'].includes(c.id)?'FAIL':c.id==='13'?'PASS':'PARTIAL');
 assert.equal(review.claims[0].excerpt,reviewableClaims(c.record.result)[c.focus]);assert.ok(review.claims[0].reason.length>30);
 assert.equal(review.unreviewedFields.length===0,c.id==='13');assert.equal(hash(c.record),before);
 const data={primary:{analysis:{input:c.record.input,records:[shown]}}};
 const restored=JSON.parse(reportHTML(data).match(/id="report-data">(.*?)<\/script>/s)[1]);assert.deepEqual(restored.primary.analysis.records[0].semanticReview,review);
});
test('scoped support, unresolved proposition, identified defect and no review remain distinguishable',()=>{
 const show=id=>externalDiagnosisPresentation(cases.find(c=>c.id===id).record,undefined,{reviews});
 assert.equal(show('01').semanticReview.scopeOutcome,'PASS');assert.equal(show('01').semanticReviewStatus,'PARTIAL');
 assert.equal(show('10').semanticReview.scopeOutcome,'INCONCLUSIVE');assert.equal(show('10').semanticReview.claims[0].disposition,'UNRESOLVED');
 assert.equal(show('03').semanticReview.scopeOutcome,'FAIL');assert.equal(show('03').semanticReview.claims[0].disposition,'CONTRADICTED');
 assert.equal(externalDiagnosisPresentation(cases[0].record,undefined,{reviews:{}}).semanticReviewStatus,'NOT_REVIEWED');
 const invalid=structuredClone(cases[0].record);invalid.result.regressionControls[0].assertions=[];
 assert.equal(externalDiagnosisPresentation(invalid,undefined,{reviews}).currentValidation,'REJECTED');
});
test('correct cancelPayment hash and range are valid references but do not support the pending claim',()=>{
 const c=cases.find(c=>c.id==='05'),ref=c.record.result.regressionControls[1].codeRefs[0];
 const source=c.record.input.sources.find(s=>s.id===ref.sourceRef);assert.equal(ref.sourceSha256,source.sha256);assert.equal(ref.startLine,65);assert.match(source.lines.find(l=>l.line===65).text,/async cancelPayment/);
 validateExternalDiagnosis(c.record.result,c.record.input);const review=externalSemanticReview(c.record,reviews);
 assert.equal(review.claims[0].disposition,'UNSUPPORTED');assert.match(review.claims[0].reason,/contains no PENDING guard/);
});
test('unsafe action is reviewed with its still-correct assertions and preconditions',()=>{
 const c=cases.find(c=>c.id==='04'),control=c.record.result.regressionControls[2];
 assert.deepEqual(control.assertions.map(a=>a.rule),['unknown_stays_unresolved','absence_does_not_authorize_retry']);
 const claim=externalSemanticReview(c.record,reviews).claims[0];assert.equal(claim.disposition,'CONTRADICTED');assert.ok(claim.contextFields.includes('/regressionControls/2/preconditions'));assert.ok(claim.contextFields.includes('/regressionControls/2/assertions/1/observation'));
});
test('stale input, response, source set, fingerprint and contract cannot attach a review',()=>{
 const {record}=cases[0];for(const mutate of [r=>r.input.contract.boundary='changed',r=>r.result.uncertainties[0]+=' changed',r=>r.input.sources[0].lines[0].text='changed',r=>r.fingerprint='changed',r=>r.schemaVersion='external-diagnosis-other']){
  const r=structuredClone(record);mutate(r);assert.equal(externalSemanticReview(r,reviews),null);
 }
 for(const key of ['inputSha256','resultSha256','sourceSetSha256','fingerprint','contractVersion']){const r=structuredClone(reviews[record.id]);delete r[key];assert.equal(inspectClaimReview(record,r),null);}
});
const invalidMetadata=[
 ['partial review with reuse permission',r=>r.reuseAllowed=true],
 ['declared PASS over selected scope',r=>r.outcome='PASS'],
 ['unreviewed fields hidden by whole-response label',r=>r.scope.kind='whole_response'],
 ['excerpt differs from response',r=>r.claims[0].excerpt='different'],
 ['foreign evidence',r=>r.claims[0].evidenceRefs=['foreign']],
 ['null source reference',r=>r.claims[0].codeRefs=[null]],
 ['foreign source hash',r=>r.claims[0].codeRefs[0].sourceSha256='f'.repeat(64)],
 ['invalid source range',r=>r.claims[0].codeRefs[0].endLine=99999],
 ['duplicate reviewed field',r=>r.claims.push(structuredClone(r.claims[0]))],
 ['no reviewer method',r=>delete r.method],
 ['no missing-premise or supporting evidence',r=>{r.claims[0].evidenceRefs=[];r.claims[0].evidenceGap=null;}],
 ['scope differs from claim list',r=>r.scope.fields=[]]
];
for(const[name,mutate]of invalidMetadata)test('metadata fails closed: '+name,()=>{
 const {record}=cases[0],r=structuredClone(reviews[record.id]);mutate(r);const view=externalDiagnosisPresentation({...record,mode:'openai-live'},undefined,{reviews:{[record.id]:r}});
 assert.equal(view.semanticReviewStatus,'INVALID_REVIEW');assert.equal(view.reusable,false);assert.deepEqual(view.semanticReview.claims,[]);
});
test('whole-response PASS can permit exact live reuse; contradiction or missing review cannot',()=>{
 const record={...cases.find(c=>c.id==='13').record,mode:'openai-live'},review=structuredClone(reviews[record.id]);review.reuseAllowed=true;
 const valid=externalDiagnosisPresentation(record,undefined,{reviews:{[record.id]:review}});assert.equal(valid.semanticReviewStatus,'PASS');assert.equal(valid.reusable,false);assert.equal(valid.contractCurrent,false);assert.equal(semanticReuseAllowed(record,valid.semanticReview),true); // Historical review remains valid; current-version reuse is separately blocked.
 for(const edit of [r=>r.outcome='FAIL',r=>r.claims[0].disposition='CONTRADICTED',r=>r.claims[0].disposition='UNRESOLVED']){
  const invalid=structuredClone(review);edit(invalid);assert.equal(externalDiagnosisPresentation(record,undefined,{reviews:{[record.id]:invalid}}).reusable,false);
 }
 const bare={resultSha256:hash(record.result),fingerprint:record.fingerprint,outcome:'FAIL',reuseAllowed:true};
 assert.equal(externalDiagnosisPresentation(record,undefined,{reviews:{[record.id]:bare}}).reusable,false);
 assert.equal(semanticReuseAllowed(record,{outcome:'PASS',reuseAllowed:true}),false);
 assert.equal(externalDiagnosisPresentation({...record,mode:'authored-offline'},undefined,{reviews:{[record.id]:review}}).reusable,false);
});
test('review text is inert in portable serialization, without changing the v5 request contract',()=>{
 const record=cases[0].record,review=structuredClone(reviews[record.id]);review.summary='</script><img src=x onerror=alert(1)>';
 const shown=externalDiagnosisPresentation(record,undefined,{reviews:{[record.id]:review}});assert.equal(shown.semanticReviewStatus,'PARTIAL');
 const html=reportHTML({primary:{analysis:{records:[shown]}}});assert.ok(!html.includes(review.summary));assert.ok(html.includes('\\u003c/script'));
 assert.equal(EXTERNAL_VERSION,'external-diagnosis-6');assert.equal(record.schemaVersion,'external-diagnosis-5');
});

 test('rejected-fragment review detaches from changed or missing retained output, input or excerpt',()=>{
 const record={...cases[0].record,result:null},text='{"assessment":"issue_observed",',retained={messages:[{fields:{text}}]};
 const a={type:'retained-output-review-1',approvedReuse:false,retainedArtifactSha256:hash(retained),retainedTextSha256:hash(text),...claimBinding(record),claims:[{startOffset:0,endOffset:13,excerpt:text.slice(0,13)}]};
 const r={...record,offlineRevalidations:[a]};assert.equal(withRetainedResponse(r,retained).offlineRevalidations.length,1);
 assert.equal(withRetainedResponse(r,null).offlineRevalidations.length,0);
 assert.equal(withRetainedResponse(r,{messages:[{fields:{text:text+'changed'}}]}).offlineRevalidations.length,0);
 assert.equal(withRetainedResponse({...r,input:{...r.input,changed:true}},retained).offlineRevalidations.length,0);
 assert.equal(withRetainedResponse({...r,offlineRevalidations:[{...a,claims:[{...a.claims[0],excerpt:'foreign'}]}]},retained).offlineRevalidations.length,0);
 assert.equal(r.result,null);assert.equal(r.offlineRevalidations.length,1);
 function claimBinding(r){return {inputSha256:hash(r.input),sourceSetSha256:hash(r.input.sources),fingerprint:r.fingerprint,resultSha256:hash(r.result)};}
});
