import { readFileSync } from 'node:fs';
import catalog from '../external/diagnosis-catalog.json' with { type: 'json' };
import { hash, LIMITS, DiagnosisError } from './diagnosis-contract.mjs';
import { usdMinor } from './checkout-contract.mjs';
import { withMonetaryFacts } from './diagnosis-money.mjs';
import { OBSERVATION_VERSION, OBSERVATION_RULE, validCount, validateStateObservation } from './external-observation-contract.mjs';
const root = new URL('../', import.meta.url);
export const EXTERNAL_DIAGNOSIS_SELECTIONS = catalog.selections.map(({key,reportId,campaignId,runId,implementation,mode})=>({key,reportId,campaignId,runId,implementation,mode}));
const scalar = v => typeof v === 'string' ? v.slice(0,1200) : typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) ? v : null;
const count = v => Number.isSafeInteger(v) && v>=0 ? v : null;
const array = v => Array.isArray(v) ? v : [];
function flat(value, prefix='', out={}) {
  if(value!==null && typeof value==='object')for(const [k,v] of Object.entries(value))flat(v,prefix?`${prefix}.${k}`:k,out);
  else out[prefix]=scalar(value);
  return out;
}
function money(value,currency) { return {amountMinor:usdMinor(String(value)),currency:scalar(currency)}; }
function resource(c) { return c ? {id:scalar(c.id),status:scalar(c.status),...money(c.amount?.value,c.amount?.currency_code??c.amount?.currencyCode),finalCapture:scalar(c.final_capture??c.finalCapture),orderId:scalar(c.supplementary_data?.related_ids?.order_id),authorizationId:scalar(c.supplementary_data?.related_ids?.authorization_id)} : null; }
function database(snapshot) {
  const rows=snapshot?.rows, payment=rows?.payment?.[0],collection=rows?.payment_collection?.[0];
  // An absent optional snapshot is unavailable. A supplied but incomplete snapshot is malformed.
  if(snapshot!=null && (!rows || !payment || !Array.isArray(rows.payment) || rows.payment.length!==1 || !Array.isArray(rows.capture) ||
    !Object.hasOwn(payment,'captured_at') || !(payment.captured_at===null || typeof payment.captured_at==='string' && Number.isFinite(Date.parse(payment.captured_at)))))throw new DiagnosisError('MALFORMED_DATABASE_OBSERVATION');
  return {available:!!rows,independentConnection:scalar(snapshot?.independentConnection),
    payment:{id:scalar(payment?.id),capturedAt:scalar(payment?.captured_at),...money(payment?.amount,payment?.currency_code),sessionId:scalar(payment?.payment_session_id)},
    collection:{id:scalar(collection?.id),status:scalar(collection?.status),...money(collection?.captured_amount,collection?.currency_code)},
    captureRowCount:Array.isArray(rows?.capture)?rows.capture.length:null,
    captureRows:array(rows?.capture).map(c=>({id:scalar(c.id),paymentId:scalar(c.payment_id),...money(c.amount,payment?.currency_code)})),
    operationCount:Array.isArray(rows?.captureproof_operation)?rows.captureproof_operation.length:null,
    operations:array(rows?.captureproof_operation).map(o=>({id:scalar(o.id),state:scalar(o.state),captureId:scalar(o.capture_id),createdAt:scalar(o.created_at),updatedAt:scalar(o.updated_at),binding:{sessionId:scalar(o.binding?.sessionId),orderId:scalar(o.binding?.orderId),authorizationId:scalar(o.binding?.authorizationId),amountMinor:/^\d+$/.test(String(o.binding?.amountMinor))?count(Number(o.binding.amountMinor)):null,currency:scalar(o.binding?.currency),merchantContext:scalar(o.binding?.merchantContext)}}))};
}
function provider(p) {
  return {available:!!p,orderId:scalar(p?.order?.id),orderStatus:scalar(p?.order?.status),capture:resource(p?.capture),
    capturePostAttempts:count(p?.capturePostAttempts),acceptedOperations:count(p?.acceptedOperations),
    distinctCaptureCount:p && Object.hasOwn(p,'capture') ? (p.capture?1:0) : null};
}
// Only raw observation fields cross this adapter. Verdicts, summaries and other runs do not.
export function externalObservations(run) {
  if(!Array.isArray(run.events)||!Array.isArray(run.checkpoints))throw new DiagnosisError('MALFORMED_EXECUTION_OBSERVATION');
  const counters=(value,keys)=>{
    if(value==null)return 'not_recorded';
    if(keys.some(k=>!Object.hasOwn(value,k)||!validCount(value[k])))throw new DiagnosisError('MALFORMED_COUNTER_OBSERVATION');
    return 'recorded';
  };
  const evidence=[];const add=(id,fields)=>{const normalized=flat(fields);if(Object.hasOwn(normalized,'counterObservation'))validateStateObservation(normalized);evidence.push({id,fields:normalized});};
  const crash=run.crash;
  if(crash)add('crash',{at:crash.events?.find(e=>e.kind==='crash_barrier')?.at??null,phase:'unfinished_interrupt',visibility:'controller_only',location:crash.location,signal:crash.signal,
    counterObservation:counters(crash.afterTermination?.provider,['capturePostAttempts','acceptedOperations']),
    database:database(crash.afterTermination?.database),provider:provider(crash.afterTermination?.provider)});
  const restart=run.events.find(e=>e.kind==='fresh_database_read' && e.label==='worker_restart_initial');
  if(restart)add('restart',{at:restart.at,phase:'before_recovery',visibility:'controller_collected_persisted_merchant_state',workerPid:restart.workerPid,
    counterObservation:'not_recorded',capturePostAttempts:null,acceptedOperations:null,distinctCaptureCount:null,database:database(restart)});
  for(const [i,c] of run.checkpoints.entries())add(`checkpoint-${i+1}`,{ordinal:i+1,phase:c.completionWindowOpen?'unfinished_call':'returned_call',visibility:'controller_only_counters_and_independent_database',
    returned:scalar(c.returned?.kind),error:scalar(c.returned?.message),auditorNonMutation:scalar(c.auditorNonMutation),
    counterObservation:counters(c.providerCounters,['capturePostAttempts','acceptedOperations','distinctCaptures']),
    capturePostAttempts:count(c.providerCounters?.capturePostAttempts),acceptedOperations:count(c.providerCounters?.acceptedOperations),distinctCaptureCount:count(c.providerCounters?.distinctCaptures),
    database:database(c.afterShutdown),provider:provider(c.providerFinal)});
  const relevant=run.events.filter(e=>['capture_boundary_start','capture_boundary_end','crash_barrier','worker_resumed'].includes(e.kind)||
    (e.kind==='provider_response'||e.kind==='provider_request'&&e.method==='POST')&&/\/v2\/(checkout\/orders\/|payments\/(captures|authorizations)\/)/.test(e.path??'')||
    ['target_call','target_return','target_error'].includes(e.kind)&&e.method==='capturePayment');
  for(const e of relevant){
    const fields={ordinal:e.ordinal,at:e.at,kind:e.kind,actor:e.actor,workerPid:e.workerPid,
      visibility:e.actor==='auditor'?'read_only_auditor_not_merchant':e.kind==='target_call'||e.kind==='target_return'||e.kind==='target_error'?'application_boundary':'controller_instrumentation',
      method:scalar(e.method),path:scalar(e.path),requestId:scalar(e.requestId),httpStatus:count(e.status),error:scalar(e.message)};
    if(e.kind==='provider_response')fields.visibility=e.actor==='auditor'?'read_only_auditor_not_merchant':'transport_response_not_proof_of_application_consumption';
    if(e.kind==='provider_request'&&e.method==='POST')fields.payload={...money(e.body?.amount?.value,e.body?.amount?.currency_code),finalCapture:scalar(e.body?.final_capture)};
    if(e.kind==='provider_response')fields.response=e.path?.includes('/checkout/')?{orderId:scalar(e.body?.id),orderStatus:scalar(e.body?.status),captureCount:Array.isArray(e.body?.purchase_units)?array(e.body.purchase_units[0]?.payments?.captures).length:null,captures:array(e.body?.purchase_units?.[0]?.payments?.captures).map(resource)}:resource(e.body);
    for(const key of ['method','path','requestId','httpStatus','error'])if(fields[key]===null)delete fields[key];
    add(`event-${e.ordinal}`,fields);
  }
  return evidence;
}
export function buildExternalDiagnosisInput(_store, selection, { read = path => readFileSync(new URL(path,root),'utf8') } = {}) {
  const key=selection.replace(/^external:/,'');const entry=catalog.selections.find(e=>e.key===key);
  if(!entry)throw new DiagnosisError('EXTERNAL_SELECTION_UNAVAILABLE');
  const checked=(path,digest)=>{const raw=read(path);if(hash(raw)!==digest)throw new DiagnosisError('EXTERNAL_SOURCE_OR_EVIDENCE_MISMATCH');return raw;};
  const summary=JSON.parse(checked(entry.summary,entry.summarySha256));
  const run=JSON.parse(checked(entry.artifact,entry.artifactSha256));
  if(run.runId!==entry.runId||run.implementation!==entry.implementation||!summary.executions.some(e=>e.runId===run.runId&&e.sha256===entry.artifactSha256))throw new DiagnosisError('EXTERNAL_EXECUTION_MISMATCH');
  const sources=entry.sources.filter(s=>s.role!=='plugin').map(s=>{
    const recorded=run.hashes[s.path]??run.provenance.files[s.path.replace(/^external\/medusa-persistence\//,'')];
    if(recorded!==s.sha256)throw new DiagnosisError('EXTERNAL_SOURCE_REVISION_MISMATCH');
    const lines=checked(s.snapshot,s.sha256).split('\n');
    const included=s.ranges.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>a+i));
    if(included.some(n=>n<1||n>lines.length))throw new DiagnosisError('EXTERNAL_SOURCE_RANGE_UNAVAILABLE');
    return {id:`source-${s.sha256.slice(0,16)}`,role:s.role,path:s.path,revision:s.sha256,sha256:s.sha256,
      provenance:s.provenance,transformations:'Selected original line numbers. Whole-line comments blanked; no renamed code or synthesized logic.',
      lines:included.map(n=>({line:n,text:lines[n-1].trim().startsWith('//')?'':lines[n-1]}))};
  });
  const evidence=externalObservations(run);
  const primary=sources.find(s=>s.role==='candidate');
  const input=withMonetaryFacts({domain:'external_integration',mode:entry.mode,evidenceMode:'SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES',
    target:{package:run.provenance.plugin.name,packageVersion:run.provenance.plugin.version,upstreamRevision:run.provenance.plugin.revision,upstreamSourceSha256:run.hashes['external/medusa-persistence/target-service.cjs'],executedSourceSha256:primary.sha256,dependencies:run.provenance.versions},
    execution:{runId:run.runId,startedAt:run.startedAt,finishedAt:run.finishedAt,artifactSha256:entry.artifactSha256},
    contract:{amountMinor:run.contract.amountMinor,currency:run.contract.currency,boundary:run.crash?'The interruption is unfinished. Explicit post-restart capture calls have returned; assess progress only over that observed sequence.':'Assess explicit returned-call boundaries only. Pending or unavailable evidence does not establish completed payment.',
      observationSemanticsVersion:OBSERVATION_VERSION,observationSemantics:OBSERVATION_RULE,
      invariants:['Completed merchant payment requires matching completed provider evidence.','A durable operation identifies one logical capture across explicit retries.','Separate request attempts, provider resources and database bookkeeping rows.'],
      provider:'Offline transport simulator; no live PayPal request. Controller provider state is not automatically visible to the application.',
      applicationReplayWindowMs:entry.implementation==='candidate'?null:3600000,
      simulatedRetentionMs:3600000,retentionScope:'Simulator assumption only; no retention-duration measurement.',
      observationLimits:['Sequential full capture only; no concurrency or fulfillment consumers.','Independent controller reads can observe facts not supplied to merchant code.','Source excerpts omit unrelated methods; no counterpart execution or implementation supplied.']},
    evidence,sources});
  if(Buffer.byteLength(JSON.stringify(input))>LIMITS.inputBytes)throw new DiagnosisError('INPUT_TOO_LARGE');
  return {input,provenance:{selection:key,reportId:entry.reportId,campaignId:entry.campaignId,executionId:run.runId,artifactSha256:entry.artifactSha256,sources:entry.sources.map(({path,sha256,provenance})=>({path,sha256,provenance}))},mappings:sources.map(s=>({sourceRef:s.id,path:s.path,sha256:s.sha256})),aliases:{}};
}
