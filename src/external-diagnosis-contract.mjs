import { regressionControlsSchema, validateRegressionControls, historicalGuidanceAssessment } from './regression-guidance.mjs';
import { DIAGNOSIS_SCHEMA as legacySchema, INSTRUCTIONS as legacyInstructions, validateDiagnosis, DiagnosisError } from './diagnosis-contract.mjs';
import { renderMonetaryClaims, validateMonetaryClaims } from './diagnosis-money.mjs';
import { externalSemanticReview, externalOfflineRevalidations } from './external-diagnosis-review.mjs';
import { validateStateClaims } from './external-observation-contract.mjs';
export const EXTERNAL_VERSION='external-diagnosis-5';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const nullableCount={anyOf:[{type:'integer',minimum:0},{type:'null'}]};
const string={type:'string',minLength:1,maxLength:1800,pattern:'\\S'};
export const EXTERNAL_SCHEMA=structuredClone(legacySchema);
const refs=[...EXTERNAL_SCHEMA.properties.findings.items.anyOf.map(s=>s.properties.codeRefs.items),EXTERNAL_SCHEMA.properties.fixDirection.anyOf[0].properties.codeRefs.items,EXTERNAL_SCHEMA.properties.regressionTest.anyOf[0].properties.codeRefs.items];
for(const ref of refs){ref.properties.sourceSha256={type:'string',pattern:'^[a-f0-9]{64}$'};if(!ref.required.includes('sourceSha256'))ref.required.push('sourceSha256');}
EXTERNAL_SCHEMA.properties.stateClaims={type:'array',minItems:0,maxItems:8,items:object({evidenceRef:string,capturePostAttempts:nullableCount,distinctProviderCaptures:nullableCount,databaseCaptureRows:nullableCount,merchantCapturedAt:{anyOf:[string,{type:'null'}]}})};
EXTERNAL_SCHEMA.properties.stateClaims.description='Copy the exact state at one evidenceRef. Counter null means explicitly not_recorded, never zero or not-applicable. DB count null requires database.available=false. capturedAt null is unset when the database is available, otherwise unobserved.';
EXTERNAL_SCHEMA.required.push('stateClaims');
EXTERNAL_SCHEMA.properties.moneyClaims.description='Optional grounded observed/expected facts, displayed with exact evidence fields even without prose references. Every supplied claim is validated. Hypothetical negative_test claims must be referenced in regressionTest.text; they are not payment evidence.';
EXTERNAL_SCHEMA.properties.findings.minItems=1;
EXTERNAL_SCHEMA.properties.findings.description='Explain the selected assessment, including healthy or insufficient results. Supported findings need exact observations and relevant supplied code. Citation integrity does not establish semantic support.';
EXTERNAL_SCHEMA.properties.fixDirection.description='Null for no_issue_observed. For issue_observed, provide this or regressionTest as bounded guidance. Never claim a proposed correction was executed.';
EXTERNAL_SCHEMA.properties.regressionTest.description='Required for insufficient_evidence: the smallest next evidence collection, with existing evidence references explaining the gap. Otherwise optional verification guidance; issue_observed requires this or fixDirection.';
for(const key of ['livePayPalVerified','concurrencyVerified','fulfillmentVerified']){EXTERNAL_SCHEMA.properties.claims.properties[key]={type:'boolean',enum:[false]};EXTERNAL_SCHEMA.properties.claims.required.push(key);}
export const EXTERNAL_V4_INSTRUCTIONS=legacyInstructions.replace(
  'Use moneyClaims: [] if no monetary assertion is needed. Do not add unused claims.',
  'Use moneyClaims: [] if no monetary assertion is needed. Grounded observed/expected claims may be supplied without a prose token: the UI displays every validated claim with its exact evidence fields. This metadata is optional, not a request to copy all available amounts. Every supplied claim must pass the same evidence, currency and minor/major-unit checks whether referenced or not. A negative_test claim must still be used in regressionTest.text. Metadata does not establish payment completion or replace an evidence-grounded explanation.'
)+`
This input describes external integration code executed with real Medusa/PostgreSQL and a SIMULATED PayPal transport, not the owned Sandbox checkout or its entitlements. Analyze only this selected execution. Initial mode contains no known recovery implementation or counterpart results. Observation-review mode describes the selected revision only, not a before/after causal proof.
A provisional Capture row does not prove merchant payment completion. Keep capturePostAttempts, distinctProviderCaptures and databaseCaptureRows separate. Row replacement can reference the same provider capture; two POSTs are not evidence of two charges. Populate stateClaims from one supplied state observation, including restart observations. Copy zero only when observed; counter null requires counterObservation=not_recorded. DB count null requires database.available=false; a recorded null capturedAt means unset. Missing required normalized fields are malformed evidence, not zero or not-applicable. Do not borrow values from another checkpoint or from provider read-back into controller counters. Cite these observations alongside important factual findings. Every supported finding must have at least one exact observedFacts entry citing one of its evidenceRefs. Code citations must copy the executed source's full sourceSha256 as well as its ID and original line range.
Distinguish application-visible return values and persisted data from controller-only simulator counters, process barriers and independent reads. A transport response can be recorded before application consumption; it is not a returned method result. Do not recommend trusting controller-only knowledge in merchant recovery. Proposals must state their conditions, preserve payment binding and use read-back evidence before treating payment as completed. Do not infer an operation was unsent merely from an ambiguous reservation or empty lookup.
Findings must be concise, or explicitly insufficient. Explain supported causal paths through callers/guards/compensation as supplied. Describe unfinished and returned-call observation windows separately; an unfinished earlier window does not erase later returned observations. Fixes and regression tests remain proposals. Report concrete missing evidence and limits. No live-provider, concurrency, fulfillment, general repair-safety or actual network-outage claim is supported. Validation checks structured facts and citation integrity, not the truth of every natural-language sentence.
Every assessment requires at least one finding explaining the conclusion; scalar facts and money metadata alone are not an explanation. For issue_observed or no_issue_observed, include exact observedFacts and at least one supported finding with relevant code citations when nonblank source is supplied. If source is unavailable, separate the observed discrepancy/scope from a hypothetical cause and disclose the missing source. Never cite unrelated lines just to satisfy a requirement.
For issue_observed: explain the observed discrepancy at the declared boundary and the causal path supported by supplied code/observations. Mark inference as hypothesis. Give bounded fixDirection or regressionTest guidance, conditional on available evidence; do not assert an undisclosed replay guarantee or recommend another case's implementation.
For no_issue_observed: explain the observed recovery sequence and relevant safeguards actually exercised, citing observations and supporting code. Distinguish implemented checks from paths tested by this run. State the limits of this scoped result. Set fixDirection to null; a useful optional regressionTest is not a required patch.
For insufficient_evidence: explain the specific missing observations and why the supplied window cannot decide the issue. Conditional hypotheses may use kind=hypothesis with no code citation when none supports the claim. Use regressionTest for the smallest next evidence collection, citing supplied evidence that reveals the gap; this is a proposal, not an executed test. Do not guess missing values or demand a successful/failed conclusion. Do not require policies or source that were not supplied.`;
export const EXTERNAL_V4_SCHEMA=structuredClone(EXTERNAL_SCHEMA);
EXTERNAL_SCHEMA.properties.regressionControls=regressionControlsSchema(refs[0]);
EXTERNAL_SCHEMA.required.push('regressionControls');
EXTERNAL_SCHEMA.properties.fixDirection.description='Optional bounded correction for issue_observed; null for healthy observations. Never executed by this diagnosis.';
EXTERNAL_SCHEMA.properties.regressionTest.description='Required summary of proposed regression/evidence collection for issue_observed and insufficient_evidence; optional for healthy observations.';
export const EXTERNAL_INSTRUCTIONS=EXTERNAL_V4_INSTRUCTIONS.replace('Give bounded fixDirection or regressionTest guidance','Give bounded regressionTest guidance, with optional fixDirection').replace('For issue_observed, provide this or regressionTest','For issue_observed, provide regressionTest')+`
Regression guidance contract v1: include regressionControls as structured proposed plans, separate from observedFacts. Each plan has a purpose, preconditions, ordered actions, observable assertions at declared boundaries, current executionId, applicability references and a reason. Cite supplied evidence/code establishing relevance; evidenceGap describes an absent proposed scenario, not invented observations. Never claim these controls or repairs were executed. Use not_applicable only for optional controls, with a reason and empty actions/assertions. Free-form semantic support requires independent review.
For an issue under external-observations-2, require normal_completion, unavailable_readback and conflicting_evidence. Also require pending if a supplied provider.capture.status is PENDING, and repetition_restart when before_recovery or multiple returned_call observations exist. Normal completion must permit a legitimately bound completed payment, not reject everything. At completed returned boundaries require one provider capture and active DB row, counted separately. PENDING cannot establish completion. Missing/ambiguous read-back proves neither payment success nor terminal failure and alone grants no retry. Confirmed binding/state violations remain visible even in unfinished windows; never mask them as mere uncertainty. Preserve operation identity across repeat/restart, and do not treat POST count as charge count. Copy each applicable kind's contractual assertion rule set from the schema enums and descriptions; supply specific observable checks in observation, not just scenario names. Do not prescribe universal merchant status strings.
For insufficient_evidence require next_evidence (collect_missing_observations and unknown_stays_unresolved); do not force the failure-specific matrix. Healthy results can use an empty controls array or scoped_recheck and need no invented fix. Controls are proposals, not live-PayPal, production-safety or repair-verification evidence. Keep monetary amounts in the existing typed moneyClaims/regressionTest summary; controls refer to matching expected amount/currency without numeric money claims.
`;
// Descriptions expose the exact assertion set to the model without expected answers.
EXTERNAL_SCHEMA.properties.regressionControls.description='Required kinds depend on assessment and selected evidence. Rule sets: normal_completion=[bound_completed_can_complete,one_capture_and_row]; pending=[pending_must_not_complete]; unavailable_readback=[unknown_stays_unresolved,absence_does_not_authorize_retry]; conflicting_evidence=[confirmed_violation_remains_visible,conflict_must_not_complete]; repetition_restart=[preserve_operation_identity,one_capture_and_row,posts_are_not_charges]; next_evidence=[collect_missing_observations,unknown_stays_unresolved]; scoped_recheck=[recheck_selected_boundary]. Completed assertions cannot use unfinished_window; confirmed_violation_remains_visible must test unfinished_window.';
const fail=code=>{throw new DiagnosisError(code);};
// Preserve the original external-diagnosis-2 behavior for explicit offline audits.
export function validateExternalDiagnosisV2(result,input) {
  return validateExternal(result,input,'referenced');
}
export function validateExternalDiagnosisV3(result,input) {
  return validateExternal(result,input,'display-grounded-facts');
}
export function validateExternalDiagnosisV4(result,input) {
  validateExternalDiagnosisV3(result,input);
  if(!result.findings.length)fail('EXPLANATION_REQUIRED');
  if(result.assessment!=='insufficient_evidence'){
    if(!result.observedFacts.length)fail('OBSERVED_SUPPORT_REQUIRED');
    const codeAvailable=input.sources.some(s=>s.lines.some(l=>l.text.trim()));
    if(codeAvailable&&!result.findings.some(f=>f.kind==='supported'))fail('SUPPORTED_EXPLANATION_REQUIRED');
  }
  if(result.assessment==='issue_observed'&&!result.fixDirection&&!result.regressionTest)fail('BOUNDED_GUIDANCE_REQUIRED');
  if(result.assessment==='no_issue_observed'&&result.fixDirection)fail('HEALTHY_FIX_NOT_JUSTIFIED');
  if(result.assessment==='insufficient_evidence'&&!result.regressionTest)fail('NEXT_EVIDENCE_REQUIRED');
  return result;
}
export function validateExternalDiagnosis(result,input) {
  const copy=structuredClone(result);delete copy.regressionControls;
  validateExternalDiagnosisV4(copy,input);
  if(result.assessment==='issue_observed'&&!result.regressionTest)fail('REGRESSION_GUIDANCE_REQUIRED');
  validateRegressionControls(result,input,EXTERNAL_SCHEMA.properties.regressionControls);
  validateMonetaryClaims(result,input,fail,'display-grounded-facts');
  return result;
}
function validateExternal(result,input,moneyPolicy) {
  if(input?.domain!=='external_integration')fail('EXTERNAL_INPUT_REQUIRED');
  const copy=structuredClone(result);
  if(!copy || !Array.isArray(copy.stateClaims)||copy.stateClaims.length>8)fail('INVALID_STATE_CLAIMS');
  const sourceMap=new Map(input.sources.map(s=>[s.id,s]));
  for(const item of [...(copy.findings??[]),copy.fixDirection,copy.regressionTest].filter(Boolean))for(const ref of item.codeRefs??[]){
    const source=sourceMap.get(ref.sourceRef);
    if(!source || ref.sourceSha256!==source.sha256 || source.revision!==source.sha256)fail('SOURCE_REVISION_MISMATCH');
  }
  for(const item of [...(copy.findings??[]),copy.fixDirection,copy.regressionTest].filter(Boolean))for(const ref of item.codeRefs??[]){
    delete ref.sourceSha256;
  }
  for(const key of ['livePayPalVerified','concurrencyVerified','fulfillmentVerified']){
    if(copy.claims?.[key]!==false)fail('UNSUPPORTED_EXTERNAL_CLAIM');delete copy.claims[key];
  }
  validateStateClaims(copy.stateClaims,input);
  delete copy.stateClaims;
  validateDiagnosis(copy,input,{moneyPolicy});
  for(const finding of result.findings)if(finding.kind==='supported'&&!result.observedFacts.some(f=>finding.evidenceRefs.includes(f.evidenceRef)))fail('STRUCTURED_SUPPORT_REQUIRED');
  if(result.assessment!=='insufficient_evidence'&&(!result.stateClaims.length||!input.evidence.some(e=>e.fields.phase==='returned_call'&&e.fields['database.available']===true)))fail('EXTERNAL_BOUNDARY_INCOMPLETE');
  return result;
}
export function externalDiagnosisPresentation(record,input=record.input){
  let currentValidation='NOT_VALIDATED',validationError=null;
  const version=record.schemaVersion,consistent=[record.promptVersion,record.validatorVersion].every(v=>v===version);
  const validator=consistent?({'external-diagnosis-2':validateExternalDiagnosisV2,'external-diagnosis-3':validateExternalDiagnosisV3,'external-diagnosis-4':validateExternalDiagnosisV4,[EXTERNAL_VERSION]:validateExternalDiagnosis})[version]:null;
  if(!validator)currentValidation='HISTORICAL_CONTRACT';
  else if(record.status==='succeeded')try{validator(record.result,input);currentValidation='ACCEPTED';}catch(e){currentValidation='REJECTED';validationError=e.code??'INVALID_SAVED_DIAGNOSIS';}
  const semanticReview=externalSemanticReview(record),offlineRevalidations=externalOfflineRevalidations(record);
  const contractCurrent=version===EXTERNAL_VERSION&&consistent;
  const reusable=contractCurrent&&currentValidation==='ACCEPTED' && (record.mode!=='openai-live'||semanticReview?.reuseAllowed===true);
  const regressionGuidance=currentValidation==='ACCEPTED'&&contractCurrent?validateRegressionControls(record.result,input,EXTERNAL_SCHEMA.properties.regressionControls):historicalGuidanceAssessment(record,offlineRevalidations);
  return {...record,currentValidation,validationChecks:{structure:currentValidation==='ACCEPTED'?'PASS':'NOT_ESTABLISHED',evidenceIntegrity:currentValidation==='ACCEPTED'?'PASS':'NOT_ESTABLISHED',regressionCoverage:regressionGuidance.status,semantic:semanticReview?.outcome??'NOT_REVIEWED'},validationVersion:version,contractCurrent,validationError,reusable,semanticReview,offlineRevalidations,regressionGuidance,semanticReviewStatus:semanticReview?.outcome??'NOT_REVIEWED',renderedResult:currentValidation==='ACCEPTED'?renderMonetaryClaims(record.result,{includeMetadata:true}):null};
}
export const EXTERNAL_V4_CONTRACT={PROMPT_VERSION:'external-diagnosis-4',SCHEMA_VERSION:'external-diagnosis-4',VALIDATOR_VERSION:'external-diagnosis-4',INSTRUCTIONS:EXTERNAL_V4_INSTRUCTIONS,DIAGNOSIS_SCHEMA:EXTERNAL_V4_SCHEMA,validate:validateExternalDiagnosisV4,present:externalDiagnosisPresentation};
export const EXTERNAL_CONTRACT={PROMPT_VERSION:EXTERNAL_VERSION,SCHEMA_VERSION:EXTERNAL_VERSION,VALIDATOR_VERSION:EXTERNAL_VERSION,INSTRUCTIONS:EXTERNAL_INSTRUCTIONS,DIAGNOSIS_SCHEMA:EXTERNAL_SCHEMA,validate:validateExternalDiagnosis,present:externalDiagnosisPresentation};
