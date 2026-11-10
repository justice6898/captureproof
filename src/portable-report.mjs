import {scenarioFinding} from '../public/verification-state.mjs';
import {readReplayVerification} from './replay-verification.mjs';
import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {VerificationJobs} from './verification-jobs.mjs';
import {DiagnosisStore} from './diagnosis-store.mjs';
import {CheckoutError} from './checkout-contract.mjs';
import {buildRepairReview} from './repair-review.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export const PRIMARY={directory:'data/core-product-checks/2026-10-27/application-state/local-verifications',jobId:'4c38812e-32a3-4acd-8c1b-2db7add11f88',runId:'1de4885d-2c89-45bd-aebc-f2d4904aa67b'};
const sha=x=>createHash('sha256').update(x).digest('hex'),json=x=>JSON.stringify(x,null,2)+'\n';
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reportError=code=>{throw new CheckoutError(code,409);};
const safeRelative=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&p.split('/').every(x=>x&&x!=='.'&&x!=='..');
// Only persisted references beneath this job are readable. Never resolve HTTP paths as files.
function verifyReferences(jobs,record){
 const base=realpathSync(join(jobs.directory,record.id));
 const read=entry=>{
  if(!safeRelative(entry.artifact))reportError('REPORT_INVALID_ARTIFACT_PATH');
  const path=realpathSync(join(base,entry.artifact));
  if(!path.startsWith(base+'/'))reportError('REPORT_INVALID_ARTIFACT_PATH');
  const bytes=readFileSync(path);if(sha(bytes)!==entry.sha256)reportError('REPORT_SOURCE_OR_ARTIFACT_MISMATCH');
  return bytes.toString('utf8');
 };
 for(const s of record.sources){if(!safeRelative(s.path)||! /^(src|scripts|external|supplied)\//.test(s.path))reportError('REPORT_INVALID_SOURCE_PATH');read(s);}
 for(const e of record.executions)read(e);
 if(record.candidateDigest){const path=realpathSync(join(base,'candidate.json'));if(!path.startsWith(base+'/'))reportError('REPORT_INVALID_ARTIFACT_PATH');const candidate=jobs.jobCandidate(record);for(const f of candidate.files){const s=record.sources.find(s=>s.path==='supplied/'+f.path);if(!s||sha(f.content)!==s.sha256)reportError('REPORT_CANDIDATE_SOURCE_MISMATCH');}}
 return read;
}
// Use the established read model without migrations, reconciliation or execution authority.
export function readSelectedReport(store,jobId,runId){
 if(!uuid.test(jobId)||!uuid.test(runId))reportError('REPORT_INVALID_SELECTION');
 const jobs=Object.assign(Object.create(VerificationJobs.prototype),{directory:store.directory,db:store.db,diagnosisRecords:store.diagnosisRecords??{list:()=>[]},reconcile(){}});
 try{
  const record=jobs.raw(jobId);if(record.id!==jobId)reportError('REPORT_JOB_IDENTITY_MISMATCH');if(record.state!=='COMPLETED')reportError('REPORT_REQUIRES_COMPLETED_JOB');
  const entry=record.executions.find(e=>e.runId===runId);if(!entry)reportError('REPORT_EXECUTION_NOT_FOUND');
  const read=verifyReferences(jobs,record);
  const view=jobs.view(record.id),selected=view.executions.find(e=>e.runId===entry.runId),pair=entry.role==='baseline'?view.executions.find(e=>e.role==='candidate'&&e.caseId===entry.caseId):null;
  if(!selected.finishedAt||!selected.checkpoints?.length)reportError('REPORT_INCOMPLETE_EXECUTION');
  let analysis;
  try{analysis=jobs.executionDiagnosis(record.id,entry.runId);}catch(e){
   if(e.code!=='INPUT_TOO_LARGE')throw e;
   analysis={status:'UNAVAILABLE',reason:'The saved execution exceeds the diagnosis input limit. No diagnosis association was established; evidence and source remain available.',records:[],provenance:{jobId,executionId:runId,artifactSha256:entry.sha256}};
  }
  const publicAnalysis={...pick(analysis,['status','reason','diagnosisStatus','contractVersion','jobId','executionId','input','provenance','fingerprint','repairComparison']),records:analysis.records.map(r=>({...pick(r,['id','fingerprint','status','mode','schemaVersion','promptVersion','validatorVersion','createdAt','finishedAt','responseStatus','requestedModel','returnedModel','config','result','renderedResult','currentValidation','validationChecks','validationVersion','contractCurrent','regressionGuidance','offlineRevalidations','semanticReviewStatus','semanticReview','reusable','matchesCurrentInputs','usage','usageStatus','error','providerOutcome','dispatchPhase','transportAttempts','clientRequestId','providerRequestId','responseId','returnedServiceTier','requestIdentity','requestHash','preflightCost','cost','costUnresolved','unresolvedMaximumEstimateUsd','billingConfirmed']),retainedResponse:r.retainedResponse?pick(r.retainedResponse,['preservationComparison','omittedMessages','omittedFields','redactedFields']):null}))};
  const repair=pair?buildRepairReview(record,[selected,pair],read,{caseId:entry.caseId}):{availability:'UNAVAILABLE',reason:'No matching repair comparison for this selected execution.'};
  const paths=new Set([...(analysis.input?.sources??[]).map(s=>s.path),...Object.keys(selected.sourceHashes).filter(p=>/\.(cjs|mjs)$/.test(p))]);
  for(const c of repair.components??[])for(const e of [c.before,c.after].filter(Boolean))paths.add(e.path);
  if(pair)for(const s of record.sources.filter(s=>s.path.startsWith('supplied/')))paths.add(s.path);
  const sources=[...paths].map(path=>{const s=record.sources.find(s=>s.path===path);if(!s)reportError('REPORT_SOURCE_MISSING');return {path,sha256:s.sha256,text:read(s)};});
  for(const s of analysis.input?.sources??[]){const full=sources.find(f=>f.path===s.path);if(full.sha256!==s.sha256)reportError('REPORT_AI_SOURCE_IDENTITY');for(const l of s.lines){const original=full.text.split('\n')[l.line-1];if(l.text!==original&&!(l.text===''&&original?.trim().startsWith('//')))reportError('REPORT_AI_LINE_IDENTITY');}}
  let reproducer=null;try{reproducer=jobs.reproduce(record.id,entry.runId);}catch(e){if(e.code!=='NO_OBSERVED_FAILURE')throw e;}
  const missingObservations=selected.checkpoints.filter(c=>Object.values(c.counters).some(v=>v==null)).map(c=>`Checkpoint ${c.index}: one or more controller counters were not recorded. Unknown is not zero.`);
  return {executionScope:record.plan.kind==='campaign'?'Selected execution from a campaign':record.plan.kind==='replay'?'Single replay execution':'Selected execution',findingSummary:scenarioFinding(entry.role==='candidate'?null:selected,entry.role==='candidate'?selected:pair,{expectedCheckpoints:(entry.spec??record.plan.spec)?.phases.flat().filter(a=>['capture','observe'].includes(a)).length}),missingObservations,jobId:record.id,caseId:entry.caseId??record.plan.scenario,candidateName:record.plan.candidateName??null,candidateDigest:entry.implementation==='supplied'?record.candidateDigest:null,execution:selected,repairExecution:pair,analysis:publicAnalysis,repair,sources,reproducer,limits:view.limits,replayVerification:reproducer?jobs.replayEvidence(record.id,entry.runId):null};
 }catch(e){if(e.code==='ENOENT')reportError('REPORT_REQUIRED_EVIDENCE_MISSING');if(['INCOMPLETE_DATABASE_EVIDENCE','INVALID_VERIFICATION_RESULT','VERDICT_HISTORY_MISMATCH','INVALID_DATABASE_MONEY'].includes(e.message))reportError('REPORT_'+e.message);throw e;}
}
export function readReportCase(selection=PRIMARY){
 const directory=resolve(root,selection.directory);
 if(!existsSync(join(directory,'jobs.sqlite')))reportError('REPORT_RECORDS_NOT_PRESENT');
 const db=new DatabaseSync(join(directory,'jobs.sqlite'),{readOnly:true});
 const history=join(root,'data/checkout.sqlite'),diagnosesDb=existsSync(history)?new DatabaseSync(history,{readOnly:true}):null;
 try{return readSelectedReport({directory,db,diagnosisRecords:diagnosesDb?new DiagnosisStore(diagnosesDb,{sensitiveValues:[]}):null},selection.jobId,selection.runId);}
 finally{db.close();diagnosesDb?.close();}
}
function reducedExample(){
 const directory=join(root,PRIMARY.directory),db=new DatabaseSync(join(directory,'jobs.sqlite'),{readOnly:true});try{
  const jobs=Object.assign(Object.create(VerificationJobs.prototype),{directory,db,reconcile(){}}),id='1f1d218a-e15d-4173-a99d-6401243758c6',run='1aec6910-cb8d-4c87-8c3d-f4af0de8657e',replayId='76ec0846-8f21-48d6-89a7-ecca7dab1b77';
  const exported=jobs.reproduce(id,run),saved=JSON.parse(readFileSync(join(root,'data/core-product-checks/2026-10-27/reduced-failure.json'),'utf8'));if(JSON.stringify(exported)!==JSON.stringify(saved))throw Error('REDUCED_EXPORT_MISMATCH');
  const reduction=jobs.view(id),replay=jobs.view(replayId);if(replay.reproduction?.status!=='REPRODUCED'||replay.plan.origin.runId!==run||JSON.stringify(replay.plan.spec)!==JSON.stringify(saved.spec)||replay.candidateDigest!==saved.candidate.id)throw Error('REDUCED_REPLAY_NOT_MATCHED');
  return {label:'Separate injected regression · reduced and replayed',explanation:'Intentional completed-response rejection; not the upstream PENDING defect. No matching AI explanation is included.',execution:reduction.executions.find(e=>e.runId===run),replay:replay.executions[0],reproduction:replay.reproduction,artifact:saved};
 }finally{db.close();}
}
export function buildPortableData(selection=PRIMARY,{includeReduced=selection===PRIMARY,store}={}){
 const primary=store?readSelectedReport(store,selection.jobId,selection.runId):readReportCase(selection);
 const verification=primary.replayVerification??(primary.reproducer?readReplayVerification(Buffer.from(json(primary.reproducer)),primary.analysis.repairComparison?.candidateDigest):null);
 const artifactName=selection===PRIMARY?'upstream-failure.json':'reproducer.json';
 return {format:'captureproof-portable-report-1',mode:'READ_ONLY_SAVED_EVIDENCE',primary,secondary:includeReduced?reducedExample():null,
  attribution:'Engineering comparison and previously authored repair. Not an AI-generated or automatically applied patch.',
  scope:'Actual Medusa/PostgreSQL and installed SDK; simulated PayPal. Opening this report executes nothing.',
  replayVerification:verification,
  reproduction:{requirements:'Replay needs the CaptureProof executable workspace on macOS Apple Silicon, Node 24+, sandbox-exec and pinned dependencies. No API credentials. This HTML does not contain the runtime.',setup:['npm run external:setup','npm run verify -- check'],artifactName,primaryCommand:primary.reproducer?'npm run verify -- replay '+artifactName:'No failure reproducer: no observed failing rule in this execution.',primaryStatus:!primary.reproducer?'NOT_APPLICABLE — Evidence-only report; no failing rule was observed.':verification?`${verification.upstream.status} — exact exported bytes ${verification.upstream.artifactSha256}, execution ${verification.upstream.execution.runId}. This status applies only to this artifact and checked source/scenario.`:'UNEXECUTED — Artifact derived from this observed run. This exact exported artifact has not been replayed; do not confuse it with the separately tested example.',reducedCommand:'npm run verify -- replay reduced-failure.json',reducedStatus:'The included reduced injected-regression artifact was previously replayed successfully. Any new replay consumes a new local execution.'}};
}
export const embedJSON=value=>JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
export function reportHTML(data){
 const style=readFileSync(join(root,'public/portable-report.css'),'utf8');
 const scripts=[readFileSync(join(root,'public/verification-state.mjs'),'utf8').replaceAll('export function ','function '),...['external-diagnosis.js','portable-report.js'].map(p=>readFileSync(join(root,'public',p),'utf8'))];
 const digestScript=s=>createHash('sha256').update(s).digest('base64');
 const csp=`default-src 'none'; script-src ${scripts.map(s=>"'sha256-"+digestScript(s)+"'").join(' ')}; style-src 'sha256-${digestScript(style)}'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>CaptureProof — portable verification report</title><style>${style}</style></head><body><a class="skip" href="#main">Skip to finding</a><main id="main" tabindex="-1"></main><noscript>Enable JavaScript to inspect this embedded read-only report. No network connection is needed.</noscript><script type="application/json" id="report-data">${embedJSON(data)}</script>${scripts.map(s=>`<script>${s}</script>`).join('')}</body></html>`;
}
export function portableReportFiles(selection=PRIMARY,options={}){
 const data=buildPortableData(selection,options),files=new Map();
 const add=(path,content)=>files.set(path,Buffer.from(content));
 if(data.replayVerification){add('replay-verification.json',json(data.replayVerification));if(data.replayVerification.repair)add('upstream-repair-comparison.json',json(data.replayVerification.repair.artifact));}
 add('evidence.json',json(data));if(data.primary.reproducer)add(data.reproduction.artifactName,json(data.primary.reproducer));if(data.secondary)add('reduced-failure.json',json(data.secondary.artifact));
 for(const [i,s]of data.primary.sources.entries())add(`sources/${i}.txt`,s.text);
 for(const [path,source]of [['licenses/RSC-MIT.txt','external/rsc-paypal/LICENSE'],['licenses/Medusa-MIT.txt','external/medusa-persistence/LICENSE.medusa'],['licenses/CaptureProof.txt','LICENSES.md']])add(path,readFileSync(join(root,source)));
 const entries=[...files].map(([path,b])=>({path,bytes:b.length,sha256:sha(b),...(path.startsWith('sources/')?{sourcePath:data.primary.sources[Number(path.split('/')[1].split('.')[0])].path,representation:'Exact immutable frozen source bytes'}:{representation:'Selected export / display; not the original raw execution artifact'})}));
 data.exportFiles=[...files].map(([path,b])=>({path,content:b.toString('utf8')}));data.manifest={format:'captureproof-report-manifest-1',files:entries,sourceArtifact:data.primary.analysis.provenance,notes:['Raw artifact hashes identify retained originals; evidence.json is a separately hashed projection.','Model input excerpts retain original line numbers; blanked comment lines are derived input, not full original source.','Checksums detect changes, not publisher authenticity. report.html is hashed in the adjacent manifest to avoid self-reference.']};
 add('report.html',reportHTML(data));add('manifest.json',json({...data.manifest,files:[...entries,{path:'report.html',bytes:files.get('report.html').length,sha256:sha(files.get('report.html'))}]}));
 return {data,files};
}
export function exportPortableReport(destination,selection=PRIMARY){
 const {data,files}=portableReportFiles(selection);
 const dir=resolve(destination);mkdirSync(dirname(dir),{recursive:true});mkdirSync(dir,{mode:0o700});for(const [path,b]of files){mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),b,{flag:'wx',mode:0o600});}
 return {directory:dir,report:join(dir,'report.html'),files:files.size,reportSha256:sha(files.get('report.html')),jobId:data.primary.jobId,runId:data.primary.execution.runId};
}
