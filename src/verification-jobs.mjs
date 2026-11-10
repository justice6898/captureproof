import {reviewedSelection} from './verified-example.mjs';
import {scenarioFinding} from '../public/verification-state.mjs';
import {reproducerText,readStoreReplayVerification} from './replay-verification.mjs';
import {isDeepStrictEqual} from 'node:util';
import {createVerificationCapability} from './verification-setup.mjs';
import { prepareExecutionDiagnosis, executionDiagnosisView } from './execution-diagnosis.mjs';
import { builtinCandidate, readLocalCandidate, validateCandidate } from './local-candidate.mjs';
import { CORE_CAMPAIGN, validReplaySpec, failingRules, campaignSummary } from './regression-campaign.mjs';
import { prepareUpstreamDiagnosis, UPSTREAM_DIAGNOSIS_SOURCES } from './upstream-diagnosis.mjs';
import { buildRepairReview, repairReviewBundle } from './repair-review.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CheckoutError } from './checkout-contract.mjs';
import { projectVerificationExecution } from './external-report.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=(code,status=400)=>{throw new CheckoutError(code,status);};
const scenarioDefinitions=JSON.parse(readFileSync(new URL('../external/medusa-persistence/repair-scenarios.json',import.meta.url))).scenarios;
export const VERIFICATION_CHOICES=Object.freeze({targets:[{id:'candidate-v3',label:'CaptureProof revision 3'},{id:'candidate-v2',label:'CaptureProof revision 2'}],scenarios:[
 {id:'pending-restart',label:'Pending capture → settle after restart',baseline:'original',baselineLabel:'Pinned upstream 0.0.2'},
 {id:'reservation-crash',label:'Reservation persisted → process killed → recover',baseline:'candidate',baselineLabel:'Earlier CaptureProof candidate (not upstream)'},
 {id:'accepted-crash',label:'Capture accepted → process killed → recover',baseline:'candidate',baselineLabel:'Earlier CaptureProof candidate (not upstream)'}]});
export function executionPlan(target,scenario){
 if(!VERIFICATION_CHOICES.targets.some(x=>x.id===target)||!VERIFICATION_CHOICES.scenarios.some(x=>x.id===scenario))fail('UNSUPPORTED_VERIFICATION');
 const definition=VERIFICATION_CHOICES.scenarios.find(x=>x.id===scenario);
 const spec=scenario==='pending-restart'?scenarioDefinitions.find(x=>x.name===scenario):{mode:'completed',crashExperiment:true,crashBarrier:scenario==='reservation-crash'?'after-reservation':'after-acceptance',phases:[['capture'],scenario==='reservation-crash'?['capture','capture']:['hide-capture','capture','reveal-capture','capture','capture']]};
 return {target,scenario,baseline:definition.baseline,baselineLabel:definition.baselineLabel,spec,implementations:[definition.baseline,target]};
}
const sourcePaths=['src/local-candidate.mjs','src/regression-campaign.mjs',...UPSTREAM_DIAGNOSIS_SOURCES.filter(s=>s.role!=='upstream_provider').map(s=>s.path),'external/medusa-persistence/target-service.cjs','external/medusa-persistence/candidate.cjs','external/medusa-persistence/candidate-v2.cjs','external/medusa-persistence/candidate-v3.cjs','external/medusa-persistence/capture-recovery.cjs','external/medusa-persistence/capture-recovery-v3.cjs','external/medusa-persistence/capture-contract.cjs','external/medusa-persistence/operations.cjs','external/medusa-persistence/package-lock.json','external/medusa-persistence/provenance.json','external/medusa-persistence/rules.json','external/medusa-persistence/repair-scenarios.json','scripts/external-provider-model.cjs','scripts/external-persistence-worker.cjs','src/external-persistence.mjs','src/crash-evidence.mjs'];
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}};
export class VerificationJobs {
 constructor({directory=join(root,'data/local-verifications'),launch=null,isAlive=alive,diagnosisRecords=null,readiness=null}={}){
  this.capability=readiness??createVerificationCapability();
  this.diagnosisRecords=diagnosisRecords??{list:()=>[]};directory=resolve(directory);this.directory=directory;this.isAlive=isAlive;mkdirSync(directory,{recursive:true,mode:0o700});
  this.db=new DatabaseSync(join(directory,'jobs.sqlite'));this.db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, launch_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS one_active_verification ON jobs((1)) WHERE state IN ('QUEUED','RUNNING');`);
  this.launch=launch??(id=>{const child=spawn(process.execPath,['--import',join(root,'test-support/offline-network.mjs'),join(root,'scripts/verification-worker.mjs'),id,directory],{cwd:root,env:{PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC'},stdio:'ignore'});child.once('error',()=>this.interrupt(id,'WORKER_START_FAILED'));child.once('exit',()=>{try{const r=this.raw(id);if(['QUEUED','RUNNING'].includes(r.state))this.interrupt(id);}catch{ /* The next server reconciles a closed store. */ }});return child;});
 }
 close(){this.db.close();}
 raw(id){if(!uuid.test(id))fail('INVALID_JOB_ID');const r=this.db.prepare('SELECT record FROM jobs WHERE id=?').get(id);if(!r)fail('JOB_NOT_FOUND',404);return JSON.parse(r.record);}
 save(r){this.db.prepare('UPDATE jobs SET state=?,record=? WHERE id=?').run(r.state,JSON.stringify(r),r.id);return r;}
 interrupt(id,reason='WORKER_INTERRUPTED'){const r=this.raw(id);if(['QUEUED','RUNNING'].includes(r.state)){r.state='INTERRUPTED';r.error=reason;r.finishedAt=new Date().toISOString();this.save(r);}return r;}
 reconcile(){for(const row of this.db.prepare("SELECT record FROM jobs WHERE state IN ('QUEUED','RUNNING')").all()){const r=JSON.parse(row.record);if(!this.isAlive(r.workerPid??r.ownerPid))this.interrupt(r.id);}}
 list(){this.reconcile();return this.db.prepare('SELECT record FROM jobs ORDER BY rowid DESC LIMIT 50').all().map(r=>JSON.parse(r.record));}
 readiness(options={}){
  const capability=this.capability(options),active=this.db.prepare("SELECT id FROM jobs WHERE state IN ('QUEUED','RUNNING')").get();
  return {...capability,availability:{ready:!active,code:active?'VERIFICATION_ALREADY_ACTIVE':'IDLE',jobId:active?.id??null}};
 }
 requireReady(){const status=this.readiness({force:true});if(!status.ready)fail(status.dependencies?.ready?status.code:'VERIFICATION_SETUP_REQUIRED',503);}

 summaries(){return this.list().map(r=>{try{const records=r.executions.map(e=>({...e,trace:this.trace(r,e)}));return {...r,summary:r.plan.kind==='campaign'?campaignSummary(records):null,observedRules:[...new Set(records.flatMap(e=>failingRules(e.trace)))],evidenceStatus:'AVAILABLE'};}catch{return {...r,summary:null,evidenceStatus:'UNAVAILABLE'};}});}
 example(){
  try{
   const selection=reviewedSelection(),r=this.raw(selection.jobId),entry=r.executions.find(e=>e.runId===selection.runId);
   if(r.state!=='COMPLETED'||entry?.caseId!==selection.caseId||entry?.sha256!==selection.artifactSha256||entry.role!=='baseline')throw Error('EXAMPLE_IDENTITY');
   this.verifySources(r,{current:false});const paired=r.executions.find(e=>e.caseId===entry.caseId&&e.role==='candidate');if(!paired)throw Error('EXAMPLE_COMPARISON_MISSING');
   const baseline=projectVerificationExecution(this.trace(r,entry)),candidate=projectVerificationExecution(this.trace(r,paired)),replay=this.replayEvidence(r.id,entry.runId);
   if(!replay?.upstream||!replay.repair)throw Error('EXAMPLE_REPLAY_UNAVAILABLE');
   return {available:true,...selection,url:'/external?job='+r.id+'&case='+encodeURIComponent(entry.caseId),finding:scenarioFinding(baseline,candidate),baseline:baseline.checkpoints[0],candidate:candidate.checkpoints[0],final:candidate.checkpoints.at(-1)};
  }catch{return {available:false,reason:'The reviewed saved comparison is unavailable or failed its evidence check. No other investigation was substituted. Open saved results or restore the original state directory.'};}
 }
 candidates(){
  const path=join(this.directory,'candidates');
  return [{id:'builtin-v3',name:'Existing revision 3 · same supplied-source contract',digest:builtinCandidate().id},...(existsSync(path)?readdirSync(path).filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>{const c=this.candidate(f.slice(0,-5));return {id:c.id,name:c.name,digest:c.id};}):[])];
 }
 candidate(id){if(id==='builtin-v3')return builtinCandidate();if(!/^[a-f0-9]{64}$/.test(id))fail('INVALID_CANDIDATE_ID');const c=validateCandidate(JSON.parse(readFileSync(join(this.directory,'candidates',id+'.json'),'utf8')));if(c.id!==id)fail('CANDIDATE_IDENTITY_MISMATCH');return c;}
 importCandidate(slug){const c=readLocalCandidate(slug),dir=join(this.directory,'candidates');mkdirSync(dir,{recursive:true,mode:0o700});const path=join(dir,c.id+'.json');if(!existsSync(path))writeFileSync(path,JSON.stringify(c,null,2),{flag:'wx',mode:0o600});return {id:c.id,name:c.name};}
 // Read-only plan review. Admission still rechecks capability and freezes source itself.
 previewPlan(input) {
  let plan, candidate = null;
  if (input?.campaign) {
   if (Object.keys(input).sort().join(',') !== 'campaign,candidateId' || input.campaign !== CORE_CAMPAIGN.id) fail('UNSUPPORTED_CAMPAIGN');
   candidate = this.candidate(input.candidateId);
   plan = { kind: 'campaign', candidate: candidate.name, candidateDigest: candidate.id,
    cases: CORE_CAMPAIGN.cases, maxExecutions: 8 };
  } else {
   if (!input || Object.keys(input).sort().join(',') !== 'scenario,target') fail('INVALID_VERIFICATION_INPUT');
   plan = { ...executionPlan(input.target, input.scenario), maxExecutions: 2 };
  }
  const sources = sourcePaths.map(path => {
   try { return { path, availability: 'PRESENT', sha256: digest(readFileSync(join(root, path))) }; }
   catch { return { path, availability: 'UNAVAILABLE', sha256: null }; }
  });
  return { plan, fingerprint: digest(JSON.stringify({ plan, sources })), sources,
   capability: this.readiness(), evidenceMode: 'SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES',
   limits: 'Plan review does not launch. Running creates new isolated executions; it does not call PayPal or AI. Capability is rechecked at admission.' };
 }
 admit(input){
  if(input?.campaign){if(Object.keys(input).sort().join(',')!=='campaign,candidateId,launchKey'||input.campaign!==CORE_CAMPAIGN.id)fail('UNSUPPORTED_CAMPAIGN');
   const c=this.candidate(input.candidateId);return this.admitPlan(input.launchKey,{kind:'campaign',target:c.id,scenario:CORE_CAMPAIGN.id,candidateName:c.name,maxExecutions:8,cases:CORE_CAMPAIGN.cases},c);
  }
  if(!input||Object.keys(input).sort().join(',')!=='launchKey,scenario,target')fail('INVALID_VERIFICATION_INPUT');
  return this.admitPlan(input.launchKey,executionPlan(input.target,input.scenario));
 }
 admitPlan(launchKey,plan,candidate=null,artifactText=null){
  if(!uuid.test(launchKey))fail('INVALID_LAUNCH_KEY');this.reconcile();let r;this.db.exec('BEGIN IMMEDIATE');
  try{
   const previous=this.db.prepare('SELECT record FROM jobs WHERE launch_key=?').get(launchKey);
   if(previous){r=JSON.parse(previous.record);if(JSON.stringify(r.plan)!==JSON.stringify(plan))fail('LAUNCH_KEY_CONFLICT',409);this.db.exec('COMMIT');return r;}
   if(this.db.prepare("SELECT 1 FROM jobs WHERE state IN ('QUEUED','RUNNING')").get())fail('VERIFICATION_ALREADY_ACTIVE',409);
   this.requireReady();
   const id=randomUUID(),dir=join(this.directory,id);mkdirSync(join(dir,'sources'),{recursive:true,mode:0o700});
   const sources=sourcePaths.map((path,index)=>{const contents=readFileSync(join(root,path)),artifact=`sources/${index}.txt`;writeFileSync(join(dir,artifact),contents,{flag:'wx',mode:0o600});return {path,artifact,sha256:digest(contents)};});
   if(candidate){writeFileSync(join(dir,'candidate.json'),JSON.stringify(candidate),{flag:'wx',mode:0o600});for(const [i,f]of candidate.files.entries()){const artifact=`sources/candidate-${i}.txt`;writeFileSync(join(dir,artifact),f.content,{flag:'wx',mode:0o600});sources.push({path:'supplied/'+f.path,artifact,sha256:digest(f.content)});}}
   if(artifactText!==null)writeFileSync(join(dir,'reproducer.json'),artifactText,{flag:'wx',mode:0o600,flush:true});
   r={id,launchKey,state:'QUEUED',ownerPid:process.pid,workerPid:null,createdAt:new Date().toISOString(),startedAt:null,finishedAt:null,plan,candidateDigest:candidate?.id??null,sources,executions:[],attempts:[],error:null,diagnosis:{status:'NOT_ANALYZED',reason:'This fresh execution has no provenance-matching AI diagnosis.'},evidenceMode:'SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES'};
   this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?)').run(id,launchKey,r.state,JSON.stringify(r));this.db.exec('COMMIT');
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
  try{this.launch(r.id);}catch{this.interrupt(r.id,'WORKER_START_FAILED');}return this.raw(r.id);
 }
 jobCandidate(r){if(!r.candidateDigest)return null;const b=validateCandidate(JSON.parse(readFileSync(join(this.directory,r.id,'candidate.json'),'utf8')));if(b.id!==r.candidateDigest)fail('CANDIDATE_IDENTITY_MISMATCH');return b;}
 trace(r,entry){const bytes=readFileSync(join(this.directory,r.id,entry.artifact));if(digest(bytes)!==entry.sha256)fail('RESULT_HASH_MISMATCH',409);const trace=JSON.parse(bytes);if(trace.runId!==entry.runId||trace.implementation!==entry.implementation)fail('RESULT_IDENTITY_MISMATCH',409);for(const [path,sha]of Object.entries(trace.hashes))if(r.sources.find(s=>s.path===path)?.sha256!==sha)fail('RESULT_SOURCE_MISMATCH',409);if(trace.implementation==='supplied'&&trace.candidateIdentity?.id!==r.candidateDigest)fail('CANDIDATE_IDENTITY_MISMATCH');if(entry.spec&&(trace.mode!==entry.spec.mode||JSON.stringify(trace.scenario.phases)!==JSON.stringify(entry.spec.phases)||trace.scenario.lostResponse!==(entry.spec.lostResponse===true)||JSON.stringify(trace.scenario.openCheckpoints??[])!==JSON.stringify(entry.spec.openCheckpoints??[])))fail('RESULT_SCENARIO_MISMATCH');return trace;}
 reproduce(id,runId){
  const r=this.raw(id),entry=r.executions.find(e=>e.runId===runId);if(!entry)fail('EXECUTION_NOT_FOUND',404);const trace=this.trace(r,entry),rules=failingRules(trace);if(!rules.length)fail('NO_OBSERVED_FAILURE',409);
  const spec=entry.spec??r.plan.spec;
  return {format:'captureproof-reproducer-1',target:'@rsc-labs/medusa-paypal-payment@0.0.2',origin:{jobId:id,runId,artifactSha256:entry.sha256},spec,implementation:trace.implementation,candidate:trace.implementation==='supplied'?this.jobCandidate(r):null,failureRule:rules[0],harnessHashes:Object.fromEntries(Object.entries(trace.hashes).filter(([p])=>!p.startsWith('supplied/'))),limits:['Replay executes the same scoped scenario with new isolated identities.','Not a global shortest failure; simulated provider, trusted local candidate.']};
 }
 repairReproducer(id,runId){
  const r=this.raw(id),entry=r.executions.find(e=>e.runId===runId);
  if(r.state!=='COMPLETED'||r.plan.kind!=='campaign'||entry?.role!=='baseline')fail('REPAIR_REPLAY_UNAVAILABLE',409);
  const paired=r.executions.find(e=>e.caseId===entry.caseId&&e.role==='candidate');if(!paired||!isDeepStrictEqual(paired.spec,entry.spec))fail('REPAIR_REPLAY_UNAVAILABLE',409);
  this.trace(r,paired);const artifact=this.reproduce(id,runId),candidate=this.jobCandidate(r);if(!candidate)fail('REPAIR_REPLAY_UNAVAILABLE',409);
  return {...artifact,implementation:'supplied',candidate};
 }
 replayEvidence(id,runId){
  const r=this.raw(id),artifact=this.reproduce(id,runId),entry=r.executions.find(e=>e.runId===runId);
  const paired=entry.role==='baseline'&&r.executions.find(e=>e.role==='candidate'&&e.caseId===entry.caseId&&isDeepStrictEqual(e.spec,entry.spec));
  return readStoreReplayVerification(Buffer.from(reproducerText(artifact)),paired?r.candidateDigest:null,this);
 }
 admitReproduction(input){
  if(!input||!['replay','reduce'].includes(input.action)||!['action,launchKey,reproducer','action,artifactText,launchKey,reproducer'].includes(Object.keys(input).sort().join(',')))fail('INVALID_REPLAY_INPUT');
  const p=input.reproducer;if(p?.format!=='captureproof-reproducer-1'||p.target!=='@rsc-labs/medusa-paypal-payment@0.0.2'||!validReplaySpec(p.spec)||!['original','supplied'].includes(p.implementation)||typeof p.failureRule!=='string')fail('INVALID_REPRODUCER');
  if(!p.harnessHashes||['external/medusa-persistence/target-service.cjs','external/medusa-persistence/package-lock.json','external/medusa-persistence/rules.json','src/external-persistence.mjs','scripts/external-provider-model.cjs','scripts/external-persistence-worker.cjs'].some(path=>!p.harnessHashes[path]))fail('REPLAY_HARNESS_MISSING');for(const [path,sha]of Object.entries(p.harnessHashes)){if(!sourcePaths.includes(path)||digest(readFileSync(join(root,path)))!==sha)fail('REPLAY_HARNESS_MISMATCH');}
  if(!p.origin||!uuid.test(p.origin.jobId)||!uuid.test(p.origin.runId)||! /^[a-f0-9]{64}$/.test(p.origin.artifactSha256))fail('INVALID_REPRODUCER_ORIGIN');
  const artifactText=input.artifactText??reproducerText(p);if(typeof artifactText!=='string'||Buffer.byteLength(artifactText)>400000)fail('INVALID_REPRODUCER_BYTES');
  try{if(!isDeepStrictEqual(JSON.parse(artifactText),p))fail('REPRODUCER_BYTES_MISMATCH');}catch(e){if(e.code)throw e;fail('INVALID_REPRODUCER_BYTES');}
  const c=p.implementation==='supplied'?validateCandidate(p.candidate):null;
  return this.admitPlan(input.launchKey,{kind:input.action,target:c?.id??'original',scenario:'failure-reproduction',spec:p.spec,implementation:p.implementation,failureRule:p.failureRule,origin:p.origin,artifactSha256:digest(artifactText),maxExecutions:input.action==='reduce'?4:1},c,artifactText);
 }
 retryFailed(id){
  this.reconcile();this.db.exec('BEGIN IMMEDIATE');
  try{
   const r=this.raw(id);if(r.state!=='FAILED'||!r.plan.kind||(r.failedAttempts?.length??0)>=2)fail('RETRY_NOT_AVAILABLE',409);
   this.verifySources(r);
   if(this.db.prepare("SELECT 1 FROM jobs WHERE state IN ('QUEUED','RUNNING')").get())fail('VERIFICATION_ALREADY_ACTIVE',409);
   this.requireReady();
   r.failedAttempts=[...(r.failedAttempts??[]),{at:r.finishedAt,error:r.error,errorDetail:r.errorDetail??'Original worker did not retain detailed stderr.',completed:r.executions.length}];
   r.state='QUEUED';r.ownerPid=process.pid;r.workerPid=null;r.error=null;r.errorDetail=null;r.finishedAt=null;this.save(r);this.db.exec('COMMIT');
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
  try{this.launch(id);}catch{this.interrupt(id,'WORKER_START_FAILED');}return this.raw(id);
 }

 claim(id){this.db.exec('BEGIN IMMEDIATE');try{const r=this.raw(id);if(r.state!=='QUEUED')fail('JOB_ALREADY_CLAIMED',409);r.state='RUNNING';r.workerPid=process.pid;r.startedAt=new Date().toISOString();this.save(r);this.db.exec('COMMIT');return r;}catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}}
 verifySources(r,{current=true}={}){for(const s of r.sources){if((current&&!s.path.startsWith('supplied/')&&digest(readFileSync(join(root,s.path)))!==s.sha256)||digest(readFileSync(join(this.directory,r.id,s.artifact)))!==s.sha256)fail('EXECUTION_SOURCE_CHANGED',409);}}
 view(id){this.reconcile();const r=this.raw(id),dir=join(this.directory,id);
  if(r.plan.kind)return this.campaignView(r);
  const executions=r.executions.map(entry=>{const bytes=readFileSync(join(dir,entry.artifact));if(digest(bytes)!==entry.sha256)fail('RESULT_HASH_MISMATCH',409);const trace=JSON.parse(bytes);if(trace.runId!==entry.runId||trace.implementation!==entry.implementation)fail('RESULT_IDENTITY_MISMATCH',409);if(JSON.stringify(trace.scenario.phases)!==JSON.stringify(r.plan.spec.phases))fail('RESULT_SCENARIO_MISMATCH',409);for(const [path,sha] of Object.entries(trace.hashes))if(r.sources.find(s=>s.path===path)?.sha256!==sha)fail('RESULT_SOURCE_MISMATCH',409);return projectVerificationExecution(trace);});
  const sources=r.sources.filter(s=>/\.(cjs|mjs)$/.test(s.path)).map(s=>{const bytes=readFileSync(join(dir,s.artifact));if(digest(bytes)!==s.sha256)fail('SOURCE_HASH_MISMATCH',409);return {path:s.path,sha256:s.sha256,text:bytes.toString('utf8')};});
  const repairReview=buildRepairReview(r,executions,entry=>readFileSync(join(dir,entry.artifact),'utf8'));
  return {...r,executions,sources,repairReview,comparisonComplete:r.state==='COMPLETED'&&executions.length===2,limits:['Real Medusa/PostgreSQL; simulated PayPal only.','Sequential isolated executions. No live retention, concurrency or fulfillment verification.','Execution completion is separate from financial verdict and recovery progress.','Candidates are developer-authored, not automatically applied AI repairs.']};
 }
 campaignView(r){
  const records=r.executions.map(e=>({...e,trace:this.trace(r,e)}));
  const executions=records.map(({trace,...entry})=>({...projectVerificationExecution(trace),caseId:entry.caseId,role:entry.role,failureRules:failingRules(trace),spec:entry.spec}));
  const pair=executions.filter(e=>e.caseId==='pending-restart');
  const repairReview=buildRepairReview(r,pair,entry=>readFileSync(join(this.directory,r.id,entry.artifact),'utf8'),{caseId:'pending-restart'});
  const reviewPaths=new Set((repairReview.components??[]).flatMap(c=>[c.before?.path,c.after?.path]).filter(Boolean));
  const sources=r.sources.filter(s=>reviewPaths.has(s.path)||s.path.startsWith('supplied/')||['external/medusa-persistence/target-service.cjs','external/medusa-persistence/capture-recovery.cjs','external/medusa-persistence/operations.cjs'].includes(s.path)).map(s=>{const text=readFileSync(join(this.directory,r.id,s.artifact),'utf8');if(digest(text)!==s.sha256)fail('SOURCE_HASH_MISMATCH');return {path:s.path,sha256:s.sha256,text};});
  return {...r,executions,sources,repairReview,summary:r.plan.kind==='campaign'?campaignSummary(records):null,limits:CORE_CAMPAIGN.limits,comparisonComplete:r.state==='COMPLETED'};
 }
 executionDiagnosis(id,runId){return executionDiagnosisView(this,this.diagnosisRecords,id,runId);}
 prepareExecution(id,runId){const r=this.raw(id),entry=r.executions.find(e=>e.runId===runId);if(!entry)fail('EXECUTION_NOT_FOUND',404);const trace=this.trace(r,entry);return prepareExecutionDiagnosis({jobId:id,run:trace,artifactSha256:entry.sha256,candidate:entry.implementation==='supplied'?this.jobCandidate(r):null,readSource:(path,sha)=>{const source=r.sources.find(s=>s.path===path);if(!source||source.sha256!==sha)fail('SOURCE_HASH_MISMATCH');return readFileSync(join(this.directory,id,source.artifact),'utf8');}});}
 prepareDiagnosis(id){
  const view=this.view(id),record=this.raw(id);
  if(!view.comparisonComplete||record.plan.scenario!=='pending-restart'||record.plan.baseline!=='original')fail('UPSTREAM_PREPARATION_UNAVAILABLE',409);
  const entry=record.executions.find(e=>e.implementation==='original');
  const bytes=readFileSync(join(this.directory,id,entry.artifact));
  if(digest(bytes)!==entry.sha256)fail('RESULT_HASH_MISMATCH',409);
  const prepared=prepareUpstreamDiagnosis({jobId:id,run:JSON.parse(bytes),artifactSha256:entry.sha256,readSource:(path,expected)=>{
   const source=record.sources.find(s=>s.path===path);
   // Older immutable jobs can use their existing content-addressed dependency snapshot.
   const text=source?readFileSync(join(this.directory,id,source.artifact),'utf8'):readFileSync(join(root,'external/diagnosis-sources',expected+'.txt'),'utf8');
   if(digest(text)!==expected||source&&source.sha256!==expected)fail('SOURCE_HASH_MISMATCH',409);return text;
  }});
  if(record.diagnosisPreparation?.status==='UNSENT'){
   const saved=readFileSync(join(this.directory,id,'diagnosis-preparation.json'),'utf8');
   if(digest(saved)!==record.diagnosisPreparation.sha256||JSON.stringify(JSON.parse(saved))!==JSON.stringify(prepared))fail('PREPARATION_IDENTITY_MISMATCH',409);
   return JSON.parse(saved);
  }
  return prepared;
 }
 freezeDiagnosisPreparation(id){
  const record=this.raw(id);
  if(record.diagnosisPreparation)return record.diagnosisPreparation;
  const prepared=this.prepareDiagnosis(id),bytes=JSON.stringify(prepared,null,2)+'\n';
  writeFileSync(join(this.directory,id,'diagnosis-preparation.json'),bytes,{flag:'wx',mode:0o600,flush:true});
  record.diagnosisPreparation={status:'UNSENT',sha256:digest(bytes),executionId:prepared.executionId,requestHash:prepared.requestHash};this.save(record);return record.diagnosisPreparation;
 }
 repair(id){
  const view=this.view(id),record=this.raw(id);
  if(view.repairReview?.availability!=='AVAILABLE')fail('REPAIR_REVIEW_UNAVAILABLE',409);
  return repairReviewBundle(view.repairReview,path=>{
   const entry=record.sources.find(s=>s.path===path);
   if(!entry)fail('REPAIR_SOURCE_UNAVAILABLE',409);
   return readFileSync(join(this.directory,id,entry.artifact),'utf8');
  });
 }
}
