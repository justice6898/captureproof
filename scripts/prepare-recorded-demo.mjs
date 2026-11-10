import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DiagnosisStore } from '../src/diagnosis-store.mjs';
import { ExternalDiagnosisService } from '../src/external-diagnosis-service.mjs';
import { VerificationJobs, VERIFICATION_CHOICES } from '../src/verification-jobs.mjs';
import { loadExternalReport, CRASH_REPORT_ID } from '../src/external-report.mjs';
import { RECORDED_EXAMPLES, matchingExample } from '../public/recorded-evidence.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const pick=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]]));
// Read only selected persisted records. Never copy the working DB, private responses or ledger.
export function prepareRecordedDemo(){
 const db=new DatabaseSync(join(root,'data/checkout.sqlite'),{readOnly:true});
 const jobsDb=new DatabaseSync(join(root,'data/local-verifications/jobs.sqlite'),{readOnly:true});
 try{
  const service=new ExternalDiagnosisService({records:new DiagnosisStore(db)}),routes={};
  for(const key of ['prior','v3-reservation']){
   const view=service.view(key),records=RECORDED_EXAMPLES.filter(e=>e.selection===key).map(example=>{
    const record=view.records.find(r=>matchingExample(r,example.key));
    if(!record||record.currentValidation!=='ACCEPTED'||!record.renderedResult)throw Error('RECORDED_EXAMPLE_UNAVAILABLE');
    return pick(record,['id','fingerprint','input','schemaVersion','status','mode','result','renderedResult','currentValidation','semanticReviewStatus','semanticReview','reusable','matchesCurrentInputs','createdAt','finishedAt']);
   });
   routes[`/api/external-diagnoses/${key}`]={...pick(view,['selection','availability','dispatchEnabled','contractVersion','fingerprint','config','provenance','input']),preflight:{status:'RECORDED_REVIEW_ONLY',reason:'No new generation available in this demo'},records};
  }
  const report=loadExternalReport(CRASH_REPORT_ID);
  if(report?.availability!=='AVAILABLE')throw Error('RECORDED_REPORT_UNAVAILABLE');
  report.executions=report.executions.filter(r=>r.name==='prior');report.recordedSubset=true;
  // The three AI inputs already contain their exact bounded source excerpts.
  report.source=[];
  routes['/api/external-reports']=[{id:CRASH_REPORT_ID,label:'Recorded · Earlier candidate recovery defect'}];
  routes[`/api/external-reports/${CRASH_REPORT_ID}`]=report;
  const id='eec184ca-9b48-4bfa-bafc-cbe43d3901c7';
  // Existing projection and hash checks, with no constructor migrations or worker reconciliation.
  const jobs=Object.assign(Object.create(VerificationJobs.prototype),{directory:join(root,'data/local-verifications'),db:jobsDb,reconcile(){}});
  const job=jobs.view(id);if(job.state!=='COMPLETED'||!job.comparisonComplete)throw Error('RECORDED_COMPARISON_UNAVAILABLE');
  routes['/api/verifications']={choices:VERIFICATION_CHOICES,jobs:[pick(job,['id','state','plan','createdAt'])],recordedOnly:true};
  routes[`/api/verifications/${id}`]=job;routes[`/api/verifications/${id}/export`]=job;
  routes[`/api/verifications/${id}/repair-review`]=jobs.repair(id);
  routes[`/api/verifications/${id}/diagnosis-preparation`]=jobs.prepareDiagnosis(id);
  const content=JSON.stringify({version:'recorded-demo-1',mode:'READ_ONLY_SELECTED_RECORDS',routes});
  const directory=mkdtempSync(join(tmpdir(),'captureproof-recorded-'));
  const path=join(directory,'recorded.json');writeFileSync(path,content,{flag:'wx',mode:0o600});
  return {path,sha256:createHash('sha256').update(content).digest('hex'),bytes:Buffer.byteLength(content),routeCount:Object.keys(routes).length};
 }finally{db.close();jobsDb.close();}
}
