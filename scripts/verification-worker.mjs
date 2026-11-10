import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VerificationJobs, digest } from '../src/verification-jobs.mjs';
import { runExternalPersistence } from '../src/external-persistence.mjs';
import { deletionCandidates, failingRules } from '../src/regression-campaign.mjs';
const jobs=new VerificationJobs({directory:process.argv[3]}),id=process.argv[2];let job;
async function execute(implementation,spec,extra={}){
 jobs.verifySources(job);
 const attempt={implementation,caseId:spec.id??null,startedAt:new Date().toISOString(),status:'STARTED'};job.attempts??=[];job.attempts.push(attempt);jobs.save(job);
 const trace=await runExternalPersistence(spec.mode,{...spec,implementation,candidateBundle:implementation==='supplied'?jobs.jobCandidate(job):undefined});jobs.verifySources(job);
 for(const [path,sha]of Object.entries(trace.hashes))if(job.sources.find(s=>s.path===path)?.sha256!==sha)throw Error('EXECUTION_SOURCE_CHANGED');
 const contents=JSON.stringify(trace,null,2)+'\n',artifact=`${trace.runId}.json`;
 writeFileSync(join(jobs.directory,id,artifact),contents,{flag:'wx',mode:0o600,flush:true});
 attempt.status='COMPLETED';attempt.runId=trace.runId;attempt.finishedAt=new Date().toISOString();
 job.executions.push({runId:trace.runId,implementation,artifact,sha256:digest(contents),spec,...extra});jobs.save(job);return trace;
}
try{
 job=jobs.claim(id);jobs.verifySources(job);
 if(job.plan.kind==='campaign'){
  for(const spec of job.plan.cases)for(const [role,implementation]of [['baseline','original'],['candidate','supplied']])if(!job.executions.some(e=>e.caseId===spec.id&&e.role===role))await execute(implementation,spec,{caseId:spec.id,role});
 }else if(job.plan.kind==='replay'){
  const trace=await execute(job.plan.implementation,job.plan.spec,{role:'replay'});job.reproduction={status:failingRules(trace).includes(job.plan.failureRule)?'REPRODUCED':'NOT_REPRODUCED',rule:job.plan.failureRule};
 }else if(job.plan.kind==='reduce'){
  let best=job.plan.spec,attempts=0;const checks=[];
  // Confirm the original failure in this job before accepting any shorter sequence.
  const initial=await execute(job.plan.implementation,best,{role:'confirmation'});attempts++;
  if(!failingRules(initial).includes(job.plan.failureRule))throw Error('ORIGINAL_FAILURE_NOT_REPRODUCED');
  let bestRun=initial.runId,changed=true;
  while(changed&&attempts<job.plan.maxExecutions){changed=false;for(const trial of deletionCandidates(best)){
    if(attempts>=job.plan.maxExecutions)break;attempts++;
    try{const trace=await execute(job.plan.implementation,trial.spec,{role:'reduction'}),retained=failingRules(trace).includes(job.plan.failureRule);checks.push({...trial.removed,status:retained?'RETAINED':'NOT_RETAINED',runId:trace.runId});if(retained){best=trial.spec;bestRun=trace.runId;changed=true;break;}}
    catch(e){checks.push({...trial.removed,status:'INVALID_OR_INFRASTRUCTURE_ERROR',error:/^[A-Z_]+/.exec(e.message)?.[0]??'EXECUTION_FAILED'});jobs.save(job);}
  }}
  job.reduction={status:bestRun===initial.runId?'FULL_REPRODUCER_RETAINED':'REDUCED',attempts,maxExecutions:job.plan.maxExecutions,rule:job.plan.failureRule,bestRunId:bestRun,spec:best,checks,scope:checks.some(c=>c.status==='INVALID_OR_INFRASTRUCTURE_ERROR')?'Some reductions were invalid or blocked; no minimality claim.':best.openCheckpoints?.length?'Open-window indices require the full sequence in this reducer.':attempts>=job.plan.maxExecutions?'Budget reached; no minimality claim.':'No further single-step deletion retained the failure among tested valid reductions; not globally shortest.'};
 }else{
  for(const implementation of job.plan.implementations)await execute(implementation,job.plan.spec);
 }
 job.state='COMPLETED';job.finishedAt=new Date().toISOString();jobs.save(job);
 if(!job.plan.kind&&job.plan.scenario==='pending-restart')try{jobs.freezeDiagnosisPreparation(id);}catch(e){const record=jobs.raw(id);record.diagnosisPreparation={status:'UNAVAILABLE',reason:e.code??'PREPARATION_FAILED'};jobs.save(record);}
}catch(e){if(job){const attempt=job.attempts?.at(-1);if(attempt?.status==='STARTED'){attempt.status='FAILED';attempt.error=/^[A-Z_]+/.exec(e.message)?.[0]??'EXECUTION_FAILED';attempt.finishedAt=new Date().toISOString();}job.state='FAILED';job.error=/^[A-Z_]+/.exec(e.message)?.[0]??'EXECUTION_FAILED';job.errorDetail=e.message.split('\n').slice(0,3).join(' ').replace(/(['"])[^'"]*\1/g,'[quoted detail omitted]').slice(0,600);job.finishedAt=new Date().toISOString();jobs.save(job);}}
finally{jobs.close();}
