import { externalObservations } from './external-diagnosis-input.mjs';
import { withMonetaryFacts } from './diagnosis-money.mjs';
import { hash, LIMITS, DiagnosisError } from './diagnosis-contract.mjs';
import { OBSERVATION_VERSION, OBSERVATION_RULE } from './external-observation-contract.mjs';
import { EXTERNAL_CONTRACT, EXTERNAL_VERSION } from './external-diagnosis-contract.mjs';
import { disabledExternalProvider } from './external-diagnosis-service.mjs';
import { DiagnosisService } from './diagnosis-service.mjs';
const base='external/medusa-persistence/';
export const UPSTREAM_DIAGNOSIS_SOURCES=Object.freeze([
 {path:base+'target-service.cjs',role:'upstream_provider',ranges:[[46,65],[214,243]]},
 {path:base+'node_modules/@medusajs/payment/dist/services/payment-module.js',role:'merchant_host',ranges:[[260,334]]},
 {path:base+'node_modules/@medusajs/payment/dist/services/payment-provider.js',role:'provider_dispatch',ranges:[[61,65]]}
]);
export function prepareUpstreamDiagnosis({jobId,run,artifactSha256,readSource}){
 const fail=code=>{throw new DiagnosisError(code);};
 if(run.implementation!=='original'||run.evidenceMode!=='SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES'||run.mode!=='pending'||
    JSON.stringify(run.scenario?.phases)!==JSON.stringify([['capture'],['settle','capture','capture']]))fail('UPSTREAM_DIAGNOSIS_SCOPE_MISMATCH');
 const sources=UPSTREAM_DIAGNOSIS_SOURCES.map(spec=>{
  const expected=run.hashes[spec.path]??run.provenance.files[spec.path.slice(base.length)];
  const text=readSource(spec.path,expected);if(!expected||hash(text)!==expected)fail('EXTERNAL_SOURCE_REVISION_MISMATCH');
  const all=text.split('\n'),lines=spec.ranges.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>a+i)).map(line=>{
   if(line>all.length)fail('EXTERNAL_SOURCE_RANGE_UNAVAILABLE');return {line,text:all[line-1].trim().startsWith('//')?'':all[line-1]};
  });
  return {id:`source-${expected.slice(0,16)}`,role:spec.role,path:spec.path,revision:expected,sha256:expected,provenance:'Frozen source matched to this execution hash or its verified installed-dependency provenance.',transformations:'Original line numbers; whole-line comments blanked.',lines};
 });
 const input=withMonetaryFacts({domain:'external_integration',mode:'initial',evidenceMode:run.evidenceMode,
  target:{package:run.provenance.plugin.name,packageVersion:run.provenance.plugin.version,upstreamRevision:run.provenance.plugin.revision,upstreamSourceSha256:sources[0].sha256,executedSourceSha256:sources[0].sha256,dependencies:run.provenance.versions},
  execution:{runId:run.runId,startedAt:run.startedAt,finishedAt:run.finishedAt,artifactSha256},
  contract:{amountMinor:run.contract.amountMinor,currency:run.contract.currency,boundary:'Assess returned capture calls. The provider simulator starts pending; a controller settle action precedes capture calls in a new merchant process.',
   observationSemanticsVersion:OBSERVATION_VERSION,observationSemantics:OBSERVATION_RULE,
   invariants:['Completed merchant payment requires bound completed provider evidence.','Separate request attempts, accepted operations, capture resources and database rows.'],
   provider:'Installed PayPal SDK with offline simulated responses; no live PayPal request. Controller observations are not automatically merchant knowledge.',
   applicationReplayWindowMs:null,simulatedRetentionMs:null,retentionScope:'No finite retry-window policy is asserted for this upstream execution.',
   observationLimits:['Sequential full USD capture only; no concurrency or fulfillment consumers.','Only this execution and its upstream/host source excerpts are supplied.','Source excerpts omit unrelated methods.']},
  evidence:externalObservations(run),sources});
 if(Buffer.byteLength(JSON.stringify(input))>LIMITS.inputBytes)fail('INPUT_TOO_LARGE');
 const bundle={input,provenance:{jobId,executionId:run.runId,artifactSha256,sources:sources.map(({path,sha256})=>({path,sha256}))},mappings:sources.map(s=>({sourceRef:s.id,path:s.path,sha256:s.sha256})),aliases:{}};
 // Same request builder, fingerprint and contract as existing external diagnoses. No analyze/reserve path.
 const provider=disabledExternalProvider(),service=new DiagnosisService({records:{list:()=>[]},provider,buildInput:()=>bundle,contract:EXTERNAL_CONTRACT});
 const prepared=service.prepare(`upstream:${run.runId}`),request=provider.requestBody(prepared.bundle.input);
 return {status:'UNSENT',diagnosisStatus:'NOT_GENERATED',message:'AI diagnosis not generated for this run',dispatchEnabled:false,contractVersion:EXTERNAL_VERSION,
  jobId,executionId:run.runId,config:provider.config,fingerprint:prepared.fingerprint,evidenceDigest:hash(input),requestHash:hash(JSON.stringify(request)),
  provenance:bundle.provenance,input,request,records:[],budgetReservation:null,limitations:['Offline preparation only; no model quality has been evaluated.','Historical responses are not reused by scenario or revision label.','A separately authorized, cost-bounded model call would be required.']};
}
