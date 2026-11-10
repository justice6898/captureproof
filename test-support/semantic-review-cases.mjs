// Authored offline responses over public frozen observations. No model output or dispatch.
import {readFileSync} from 'node:fs';
import {hash} from '../src/diagnosis-contract.mjs';
import {authoredRegressionControls} from './regression-controls.mjs';
const html=readFileSync(new URL('../data/portable-reports/upstream-pending-replayed-2026-10-29/report.html',import.meta.url),'utf8');
const analysis=JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]).primary.analysis;
const citation=(s,startLine,endLine=startLine)=>({sourceRef:s.id,sourceSha256:s.sha256,startLine,endLine});
export function semanticReviewCases(){
 const input=structuredClone(analysis.input),provider=input.sources.find(s=>s.role==='upstream_provider'),dispatcher=input.sources.find(s=>s.role==='provider_dispatch');
 const state=input.evidence.find(e=>e.id==='checkpoint-1').fields;
 const base={assessment:'issue_observed',moneyClaims:[],observedFacts:[{evidenceRef:'checkpoint-1',field:'provider.capture.status',value:'PENDING'}],
  findings:[{kind:'supported',explanation:'The returned checkpoint has a PENDING provider capture while merchant completion is recorded. The provider method retrieves the order without requiring completed capture evidence.',evidenceRefs:['checkpoint-1'],codeRefs:[citation(provider,46,57),citation(provider,214,228)]}],
  fixDirection:null,regressionTest:{text:'Propose bound completion and uncertainty controls at returned-call and restart boundaries; none has been executed by this response.',evidenceRefs:['checkpoint-1','restart'],codeRefs:[]},
  uncertainties:['One saved sequential execution used simulated PayPal. Proposed controls are not repair verification.'],
  claims:{realNetworkOutageObserved:false,duplicateChargeObserved:false,repairVerified:false,livePayPalVerified:false,concurrencyVerified:false,fulfillmentVerified:false},
  stateClaims:[{evidenceRef:'checkpoint-1',capturePostAttempts:state.capturePostAttempts,distinctProviderCaptures:state.distinctCaptureCount,databaseCaptureRows:state['database.captureRowCount'],merchantCapturedAt:state['database.payment.capturedAt']}],regressionControls:authoredRegressionControls(input)};
 const cases=[];
 const add=(number,field,edit=()=>{},selected=input)=>{
  const result=structuredClone(base);edit(result);
  const record={id:'authored-semantic-'+String(number).padStart(2,'0'),status:'succeeded',mode:'authored-offline',schemaVersion:'external-diagnosis-5',promptVersion:'external-diagnosis-5',validatorVersion:'external-diagnosis-5',input:structuredClone(selected),result,authorship:'Developer-authored offline review fixture; not model output',fingerprint:hash({input:selected,result})};
  cases.push({id:String(number).padStart(2,'0'),record,focus:field});
 };
 add(1,'/regressionControls/0/assertions/0/observation');
 add(2,'/regressionControls/1/assertions/0/observation',r=>{r.regressionControls[1].assertions[0].observation='When the application call returns with the capture still pending, its saved payment must withhold completion even if the order itself is marked complete.';});
 add(3,'/regressionControls/1/assertions/0/observation',r=>{r.regressionControls[1].assertions[0].observation='At the returned boundary, mark the merchant payment complete while the provider capture is still PENDING.';});
 add(4,'/regressionControls/2/actions/0',r=>{r.regressionControls[2].actions[0]='If read-back is unavailable, immediately send another capture POST without reconciliation.';});
 add(5,'/regressionControls/1/assertions/0/observation',r=>{r.regressionControls[1].assertions[0].observation='The cited cancelPayment declaration implements the guard that prevents merchant completion during PENDING capture.';r.regressionControls[1].codeRefs=[citation(dispatcher,65)];});
 add(6,'/regressionControls/4/assertions/0/observation',r=>{r.regressionControls[4].assertions[0].observation='The same implementation will prevent duplicate captures under simultaneous merchant processes after restart.';});
 add(7,'/regressionControls/0/assertions/0/observation',r=>{r.regressionControls[0].assertions[0].observation='This proposed normal-completion control was executed and passed against the repaired implementation.';});
 add(8,'/regressionControls/4/assertions/2/observation',r=>{r.regressionControls[4].assertions[2].observation='The unrecorded restart POST count is zero, so the earlier capture was not sent and the payment is safe to complete.';});
 add(9,'/regressionControls/3/assertions/0/observation',r=>{r.regressionControls[3].assertions[0].observation='Once a binding mismatch is confirmed, hide that violation until recovery finishes; show only inconclusive in the meantime.';});
 // A close counterpart leaves the concurrency proposition open instead of asserting it.
 add(10,'/regressionControls/4/assertions/0/observation',r=>{r.regressionControls[4].assertions[0].observation='Whether simultaneous merchant processes preserve this identity is unresolved; collect a separately authorized concurrency trace before deciding.';});
 add(11,'/regressionControls/3/assertions/0/observation');
 add(12,'/regressionControls/2/actions/0',r=>{r.regressionControls[2].actions[0]='Keep the outcome unresolved when lookup fails. Obtain merchant-visible bound evidence before deciding whether completion or a retry is eligible.';});
 const healthy=structuredClone(input);healthy.execution.runId='authored-healthy-boundary';healthy.evidence=[structuredClone(input.evidence.find(e=>e.id==='checkpoint-2'))];healthy.evidence[0].id='authored-return';
 healthy.evidenceMode='AUTHORED_NORMALIZED_FIXTURE';healthy.contract.observationLimits=['Authored one-checkpoint fixture, not a new execution. Frozen code is reference material only.'];
 for(const s of healthy.sources)s.provenance='Public frozen reference code; not proof this authored observation was executed.';
 add(13,'/findings/0/explanation',r=>{
  const e=healthy.evidence[0];r.assessment='no_issue_observed';r.regressionControls=[];r.regressionTest=null;r.stateClaims=[{evidenceRef:e.id,capturePostAttempts:e.fields.capturePostAttempts,distinctProviderCaptures:e.fields.distinctCaptureCount,databaseCaptureRows:e.fields['database.captureRowCount'],merchantCapturedAt:e.fields['database.payment.capturedAt']}];
  r.observedFacts=[{evidenceRef:e.id,field:'provider.capture.status',value:e.fields['provider.capture.status']}];
  r.findings=[{kind:'supported',explanation:'In this authored checkpoint the provider capture is COMPLETED and the merchant has a captured timestamp and one row. This narrow state observation does not establish the correctness of earlier or concurrent paths.',evidenceRefs:[e.id],codeRefs:[citation(provider,46,57)]}];
  r.uncertainties=['This is an authored normalized state fixture. The reference code shows capture followed by retrieval, not proof that a guard or repair passed a test.'];
 },healthy);
 const prefix=structuredClone(input);prefix.evidence=prefix.evidence.filter(e=>e.id==='restart');
 add(14,'/regressionControls/0/actions/0',r=>{
  r.assessment='insufficient_evidence';r.stateClaims=[];r.observedFacts=[];
  r.findings=[{kind:'hypothesis',explanation:'Only the restart observation is supplied; the returned recovery result is missing, so recovery success or failure cannot be decided.',evidenceRefs:['restart'],codeRefs:[]}];
  r.regressionTest={text:'Collect an explicitly returned recovery operation and its bound merchant-visible read-back and persisted snapshot; until then keep the outcome unresolved.',evidenceRefs:['restart'],codeRefs:[]};
  r.regressionControls=authoredRegressionControls(prefix,'insufficient_evidence');
 },prefix);
 return cases;
}
