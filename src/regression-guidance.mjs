import { DiagnosisError, matchesDiagnosisSchema, hash } from './diagnosis-contract.mjs';
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const text = {type:'string',minLength:1,maxLength:1400,pattern:'\\S'};
const list = (items,minItems=0,maxItems=8) => ({type:'array',items,minItems,maxItems});
const choice = values => ({type:'string',enum:values});
export const GUIDANCE_VERSION = 'regression-guidance-1';
// These are contractual assertions, not predictions about a proposed repair.
export const CONTROL_RULES = Object.freeze({
 normal_completion:['bound_completed_can_complete','one_capture_and_row'],
 pending:['pending_must_not_complete'],
 unavailable_readback:['unknown_stays_unresolved','absence_does_not_authorize_retry'],
 conflicting_evidence:['confirmed_violation_remains_visible','conflict_must_not_complete'],
 repetition_restart:['preserve_operation_identity','one_capture_and_row','posts_are_not_charges'],
 next_evidence:['collect_missing_observations','unknown_stays_unresolved'],
 scoped_recheck:['recheck_selected_boundary']
});
export const RULE_TEXT = Object.freeze({
 bound_completed_can_complete:'A matching COMPLETED capture permits merchant completion at the returned-call boundary.',
 one_capture_and_row:'Count provider capture identities and committed active capture rows separately; require one of each for this logical operation.',
 pending_must_not_complete:'PENDING capture evidence must not establish merchant payment completion.',
 unknown_stays_unresolved:'Unavailable or ambiguous evidence establishes neither completed payment nor terminal payment failure.',
 absence_does_not_authorize_retry:'Absent evidence alone grants no new capture POST or safe-retry conclusion.',
 confirmed_violation_remains_visible:'A confirmed identity, amount, currency or state mismatch remains a violation even while recovery is unfinished.',
 conflict_must_not_complete:'Conflicting evidence must not authorize completion.',
 preserve_operation_identity:'Reopen and repeat using the same logical operation and persisted identity; reconcile before deciding whether a POST is eligible.',
 posts_are_not_charges:'POST counts are not charge counts; distinct bound provider captures establish the resource count.',
 collect_missing_observations:'Collect the specifically missing application-visible evidence and independent merchant snapshot before deciding.',
 recheck_selected_boundary:'Recheck only the selected observed contract boundary, without claiming general correctness.'
});
export function regressionControlsSchema(codeRef) {
 return list(object({kind:choice(Object.keys(CONTROL_RULES)),status:choice(['proposed','not_applicable']),executionId:text,
  purpose:text,preconditions:text,actions:list(text),assertions:list(object({rule:choice(Object.keys(RULE_TEXT)),observation:text,boundary:choice(['returned_call','recovery_completed','unfinished_window'])})),
  evidenceRefs:list(text,1),codeRefs:list(codeRef),evidenceGap:{anyOf:[text,{type:'null'}]},reason:text,
  testsExecuted:{type:'boolean',enum:[false]},productionSafetyVerified:{type:'boolean',enum:[false]}
 }));
}
export function requiredRegressionControls(result,input) {
 if(result.assessment==='insufficient_evidence')return ['next_evidence'];
 if(result.assessment==='no_issue_observed')return [];
 // The supported external capture contract binds completion to provider evidence.
 if(input.contract?.observationSemanticsVersion!=='external-observations-2')return ['scoped_recheck'];
 const kinds=['normal_completion','unavailable_readback','conflicting_evidence'];
 if(input.evidence.some(e=>e.fields['provider.capture.status']==='PENDING'))kinds.push('pending');
 if(input.evidence.some(e=>e.fields.phase==='before_recovery')||input.evidence.filter(e=>e.fields.phase==='returned_call').length>1)kinds.push('repetition_restart');
 return kinds;
}
export function validateRegressionControls(result,input,schema) {
 const fail=code=>{throw new DiagnosisError(code);};
 const controls=result.regressionControls;
 if(!matchesDiagnosisSchema(controls,schema))fail('INVALID_REGRESSION_STRUCTURE');
 const required=requiredRegressionControls(result,input),seen=new Set();
 const evidence=new Set(input.evidence.map(e=>e.id)),sources=new Map(input.sources.map(s=>[s.id,s]));
 for(const c of controls){
  if(seen.has(c.kind))fail('DUPLICATE_REGRESSION_CONTROL');seen.add(c.kind);
  if(c.executionId!==input.execution.runId)fail('REGRESSION_EXECUTION_MISMATCH');
  if(c.evidenceRefs.some(id=>!evidence.has(id)))fail('INVALID_EVIDENCE_REFERENCE');
  for(const ref of c.codeRefs){const s=sources.get(ref.sourceRef);if(!s||s.sha256!==ref.sourceSha256||s.revision!==s.sha256)fail('SOURCE_REVISION_MISMATCH');
   if(ref.endLine-ref.startLine+1>s.lines.length||ref.endLine<ref.startLine||!s.lines.some(l=>l.line>=ref.startLine&&l.line<=ref.endLine&&l.text.trim())||Array.from({length:ref.endLine-ref.startLine+1},(_,i)=>ref.startLine+i).some(n=>!s.lines.some(l=>l.line===n)))fail('INVALID_SOURCE_REFERENCE');}
  if(c.status==='not_applicable'){
   if(required.includes(c.kind))fail('APPLICABLE_CONTROL_SKIPPED');
   if(c.actions.length||c.assertions.length)fail('NOT_APPLICABLE_HAS_PLAN');
   continue;
  }
  if(!c.actions.length||!c.assertions.length)fail('OBSERVABLE_REGRESSION_REQUIRED');
  const expected=CONTROL_RULES[c.kind],actual=c.assertions.map(a=>a.rule);
  if(new Set(actual).size!==actual.length||expected.some(rule=>!actual.includes(rule))||actual.some(rule=>!expected.includes(rule)))fail('REGRESSION_ASSERTION_CONTRACT');
  for(const a of c.assertions){
   if(['bound_completed_can_complete','one_capture_and_row'].includes(a.rule)&&a.boundary==='unfinished_window')fail('REGRESSION_BOUNDARY_MISMATCH');
   if(a.rule==='confirmed_violation_remains_visible'&&a.boundary!=='unfinished_window')fail('REGRESSION_BOUNDARY_MISMATCH');
  }
 }
 if(required.some(kind=>!controls.some(c=>c.kind===kind&&c.status==='proposed')))fail('REGRESSION_COVERAGE_MISSING');
 return {version:GUIDANCE_VERSION,status:'COMPLETE_STRUCTURE',required,present:controls.filter(c=>c.status==='proposed').map(c=>c.kind),semanticReview:'REQUIRED',note:'Coverage and structured assertions checked. Free-form usefulness and citation support still require independent review. Proposed controls were not executed.'};
}
export function historicalGuidanceAssessment(record,annotations) {
 return annotations.find(a=>a.type===GUIDANCE_VERSION&&a.inputSha256===hash(record.input)&&a.resultSha256===hash(record.result))?.guidance ?? {version:GUIDANCE_VERSION,status:'NOT_COLLECTED_UNDER_ORIGINAL_CONTRACT',required:[],present:[],semanticReview:'REQUIRED',note:'This historical response predates structured regression controls. Its original validation and review are retained; no new-contract failure is assigned.'};
}
