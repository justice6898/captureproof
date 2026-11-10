import {externalObservations} from './external-diagnosis-input.mjs';
import {withMonetaryFacts} from './diagnosis-money.mjs';
import {hash,LIMITS,DiagnosisError} from './diagnosis-contract.mjs';
import {EXTERNAL_CONTRACT,EXTERNAL_VERSION} from './external-diagnosis-contract.mjs';
import {disabledExternalProvider} from './external-diagnosis-service.mjs';
import {DiagnosisService} from './diagnosis-service.mjs';
import {UPSTREAM_DIAGNOSIS_SOURCES} from './upstream-diagnosis.mjs';
import {OBSERVATION_VERSION,OBSERVATION_RULE} from './external-observation-contract.mjs';
export function prepareExecutionDiagnosis({jobId,run,artifactSha256,candidate,readSource}){
 const specs=[...UPSTREAM_DIAGNOSIS_SOURCES,...(candidate?['capture-recovery.cjs','operations.cjs','capture-contract.cjs'].map(name=>({path:'external/medusa-persistence/'+name,role:'fixed_integration',ranges:null})):[]),...(candidate?candidate.files.map(f=>({path:'supplied/'+f.path,role:'executed_candidate',ranges:null})):[])];
 const sources=specs.map(s=>{const expected=run.hashes[s.path]??run.provenance.files[s.path.replace('external/medusa-persistence/','')],text=readSource(s.path,expected);if(hash(text)!==expected)throw new DiagnosisError('SOURCE_REVISION_MISMATCH');const all=text.split('\n'),numbers=s.ranges?s.ranges.flatMap(([a,b])=>Array.from({length:b-a+1},(_,i)=>a+i)):all.map((_,i)=>i+1);return {id:'source-'+expected.slice(0,16)+'-'+hash(s.path).slice(0,6),path:s.path,role:s.role,sha256:expected,revision:expected,provenance:'Frozen source bound to this exact execution.',lines:numbers.map(line=>({line,text:all[line-1].trim().startsWith('//')?'':all[line-1]}))};});
 const input=withMonetaryFacts({domain:'external_integration',mode:'initial',evidenceMode:run.evidenceMode,
  target:{package:run.provenance.plugin.name,packageVersion:run.provenance.plugin.version,upstreamRevision:run.provenance.plugin.revision,upstreamSourceSha256:run.hashes['external/medusa-persistence/target-service.cjs'],executedSourceSha256:run.hashes[candidate?'supplied/provider.cjs':'external/medusa-persistence/target-service.cjs'],dependencies:run.provenance.versions},
  execution:{runId:run.runId,startedAt:run.startedAt,finishedAt:run.finishedAt,artifactSha256},
  contract:{amountMinor:run.contract.amountMinor,currency:run.contract.currency,boundary:'Assess recorded returned-call boundaries; unfinished observation windows cannot establish completion.',observationSemanticsVersion:OBSERVATION_VERSION,observationSemantics:OBSERVATION_RULE,provider:'Simulated PayPal transport through installed SDK; real Medusa/PostgreSQL.',invariants:['Completed merchant capture requires bound completed provider evidence.','Count requests, accepted operations, provider resources and database rows separately.'],observationLimits:['One execution only. No counterpart, future outcome or fulfillment evidence.','Candidate code is trusted local developer code; controller counters are not automatically merchant knowledge.']},sources,evidence:externalObservations(run)});
 if(Buffer.byteLength(JSON.stringify(input))>LIMITS.inputBytes)throw new DiagnosisError('INPUT_TOO_LARGE');
 const bundle={input,provenance:{jobId,executionId:run.runId,artifactSha256,sources:sources.map(s=>({path:s.path,sha256:s.sha256}))},mappings:sources.map(s=>({sourceRef:s.id,path:s.path,sha256:s.sha256})),aliases:{}};
 const provider=disabledExternalProvider(),service=new DiagnosisService({provider,records:{list:()=>[]},buildInput:()=>bundle,contract:EXTERNAL_CONTRACT}),prepared=service.prepare('execution:'+run.runId),request=provider.requestBody(prepared.bundle.input);
 return {status:'UNSENT',diagnosisStatus:'NOT_GENERATED',dispatchEnabled:false,contractVersion:EXTERNAL_VERSION,jobId,executionId:run.runId,input,provenance:bundle.provenance,fingerprint:prepared.fingerprint,requestHash:hash(JSON.stringify(request)),request,records:[],budgetReservation:null};
}

// Reopen the exact prepared input through the existing service, never by scenario label.
export function executionDiagnosisBundle(prepared){
 return {input:prepared.input,provenance:prepared.provenance,mappings:prepared.input.sources.map(s=>({sourceRef:s.id,path:s.path,sha256:s.sha256})),aliases:{}};
}
export function executionDiagnosisView(jobs,records,jobId,runId){
 const prepared=jobs.prepareExecution(jobId,runId),provider=disabledExternalProvider();
 const service=new DiagnosisService({records,provider,contract:EXTERNAL_CONTRACT,buildInput:()=>executionDiagnosisBundle(prepared)});
 const view=service.view('execution:'+runId);
 if(view.fingerprint!==prepared.fingerprint)throw new DiagnosisError('EXECUTION_DIAGNOSIS_IDENTITY_MISMATCH');
 const record=jobs.raw(jobId),entry=record.executions.find(e=>e.runId===runId);
 const pair=entry.role==='baseline'?record.executions.find(e=>e.role==='candidate'&&e.caseId===entry.caseId):null;
 const comparison=pair?jobs.trace(record,pair):null;
 const matching=view.records.filter(r=>r.mode==='openai-live'&&r.matchesCurrentInputs&&r.input?.execution?.runId===runId).map(r=>({...r,retainedResponse:records.retainedResponse?.(r.id)??null}));
 return {...prepared,status:matching.length?'STORED_RESPONSE':'UNSENT',diagnosisStatus:matching.length?'STORED_RESPONSE_AVAILABLE':'NOT_GENERATED',records:matching,
  repairComparison:comparison?{jobId,runId:pair.runId,caseId:pair.caseId,candidateDigest:record.candidateDigest,artifactSha256:pair.sha256,verdict:comparison.comparisonStatus,finalVerdict:comparison.verdict.status,attribution:'Previously implemented and separately tested candidate. Not generated by this diagnosis; the model proposal was not executed.'}:null};
}
