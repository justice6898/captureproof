import { mountExecutionAssistance } from './execution-assistance.js';
import {resultHeadline,checkpointPresentation,assessmentDescription,jobPresentation,executionRecovery,scenarioFinding,checkpointDescription,resultRoute,savedJobLabel,checkpointPhase,storedAnalysisSummary} from './verification-state.mjs';
(() => {
 const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const add=(n,...children)=>{n.append(...children);return n;};
 const details=(label,value)=>add(node('details'),node('summary',label),node('pre',typeof value==='string'?value:JSON.stringify(value,null,2)));
 let recordedOnly=false,setupReady=false,submitting=false,executionActive=false;
 const syncControls=()=>{for(const id of ['campaign-launch','verification-launch'])$(id).disabled=recordedOnly||!setupReady||submitting||executionActive||(id==='campaign-launch'&&(!reviewedPlan||reviewedPlan.candidateId!==$('campaign-candidate').value));};
 let historicalExample=null,reviewedPlan=null;
 let choices,activeId=null,selectedCase=null,currentView='explore',timer=null,launchKey=sessionStorage.getItem('verificationLaunchKey');
 const link=(label,id)=>{const a=node('a',label);a.href='#'+id;a.onclick=event=>{if(!event||(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0))window.revealCaptureTarget(id);};return a;};
 // Restore only saved-analysis fragments. This GET path cannot generate an explanation.
 window.addEventListener('hashchange', () => {
  const target=window.captureFragment();
  const run=target.match(/(?:^|-)analysis-([0-9a-f-]{36})-/)?.[1];
  if(run&&!document.getElementById(target))document.getElementById('read-analysis-'+run)?.click();
 });
 function setView(view){
  currentView=view;document.body.dataset.view=view;$('developer-workflow').hidden=view!=='develop';document.querySelector('.hero').hidden=view==='result'||view==='history'||view==='unavailable';$('result-preview').hidden=view!=='explore';$('verified-example').hidden=view!=='explore';$('verification-workspace').hidden=view==='history';document.querySelector('.history-archive').hidden=view!=='history';
  document.querySelector('.history-archive').open=view==='history';$('saved-results').open=view==='explore';$('result-context').open=view==='explore'||view==='develop';
  for(const a of document.querySelectorAll('.journey-nav a'))a.setAttribute('aria-current',String((view==='develop')===a.href.includes('view=develop')));
 }
 function unavailable(message){setView('unavailable');$('saved-result-title').textContent='Saved result unavailable';$('verification-status').textContent=message;$('verification-result').replaceChildren(node('p','No other investigation was substituted. Choose a saved result or return to exploration.'));$('saved-result-title').focus();}
 function preview(example){const panel=$('preview-content');panel.replaceChildren();if(!example?.available){panel.append(node('p',example?.reason??'No reviewed comparison is registered in this workspace.'));return;}
  panel.append(node('p',example.finding.finding,'finding-lead'));
  if(example.origin==='BUNDLED_RECORDED_EVIDENCE')panel.append(node('p',example.scope,'notice'));
  if(example.analysisStatus==='MATCHED_REVIEWED_DIAGNOSIS')panel.append(node('p','AI explains this exact execution with code citations and five proposed checks. One real stored response: structurally accepted; same-development-session semantic PASS. The repair was authored and tested separately.','notice'));
  if(example.download){const a=node('a','Download this bundled report');a.href=example.download;panel.append(a);}
  const cards=node('div',undefined,'comparison');for(const[label,c]of [['Original · first returned checkpoint',example.baseline],['Repair · same checkpoint',example.candidate]])cards.append(add(node('article',undefined,'observation-card'),node('h3',label),node('p',checkpointDescription(c))));panel.append(cards);
  panel.append(node('p','Repair final observation: '+checkpointDescription(example.final)));const a=node('a','Inspect this finding →','primary-action');a.href=example.url;panel.append(a);
 }
 const errors={ISOLATION_UNAVAILABLE:executionRecovery('ISOLATION_UNAVAILABLE'),ISOLATION_PROBE_TIMEOUT:'Isolation check timed out. Recheck capability; no verification was dispatched.',VERIFICATION_SETUP_REQUIRED:'Dependencies are not ready. Run npm run verify -- check, then follow its setup instruction.',VERIFICATION_ALREADY_ACTIVE:'Another verification is active. Open it from saved jobs; do not launch a second job.',JOB_NOT_FOUND:'This job is not in the current state directory. Reopen the server with the original --state directory or choose a saved job below.',REPAIR_REVIEW_UNAVAILABLE:'No source-verified repair review exists for this comparison. Inspect the paired observations and frozen source.',RESULT_SOURCE_MISMATCH:'Saved evidence does not match the frozen source. Preserve these files; do not use this result as verification.',LAUNCH_KEY_CONFLICT:'An uncertain previous launch has a different selection. Reload and inspect saved jobs before starting another operation.'};
 const request=async(path,body)=>{const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const v=await r.json();if(!r.ok)throw Error(errors[v.error]??v.error??'Verification unavailable. Inspect setup and saved jobs before retrying.');return v;};
 function portableDownload(card,job,execution){
  if(job.state!=='COMPLETED'||recordedOnly)return;
  const b=node('button','Download portable HTML');b.onclick=async()=>{b.disabled=true;try{const r=await fetch(`/api/verifications/${job.id}/portable/${execution.runId}`);if(!r.ok){const e=await r.json();throw Error(`${e.error}: export requires a completed execution with intact saved artifacts and frozen sources. Preserve the originating state directory; inspect the saved job before retrying.`);}const url=URL.createObjectURL(await r.blob()),a=node('a');a.href=url;a.download=`captureproof-report-${execution.runId}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('verification-status').textContent=e.message;}finally{b.disabled=false;}};card.append(b);
 }
 function context(){const s=choices.scenarios.find(s=>s.id===$('verification-scenario').value);$('verification-context').textContent=`Baseline: ${s.baselineLabel}. Two independent executions; real database, simulated provider. No PayPal or model calls.`;}
 function render(job){
  if(job.plan.kind){renderCampaign(job);return;}
  const panel=$('verification-result');panel.replaceChildren();const running=['QUEUED','RUNNING'].includes(job.state);executionActive=running;syncControls();
  if(!job.executions.length&&['FAILED','INTERRUPTED'].includes(job.state)){renderStartFailure(panel,job);return;}
  $('verification-status').textContent=`Execution ${job.state} · ${job.executions.length} of 2 artifacts saved${job.error?` · ${job.error}`:''}.`;
  add(panel,node('h3',`${job.plan.scenario} · ${job.plan.target}`),details('Execution identity and timing',{jobId:job.id,startedAt:job.startedAt,finishedAt:job.finishedAt,evidenceMode:job.evidenceMode}),node('p',job.diagnosis.reason,'warning'));
  window.mountRepairReview(panel,job,request);
  const examples=node('a','View separately recorded AI examples');examples.href='/external?report=da3bbb86-3647-49d3-973d-efc3eacbb4be&case=prior#external-diagnosis';panel.append(examples);
  if(job.state==='INTERRUPTED')panel.append(node('p','Worker was lost. Retained artifacts remain available. Refresh will not execute this job again.','warning'));
  const comparison=node('div',undefined,'comparison');
  for(const r of job.executions){
   const card=node('article',undefined,'execution');card.id=`execution-${r.runId}`;portableDownload(card,job,r);const last=r.checkpoints.at(-1);
   const label=r.implementation===job.plan.baseline?job.plan.baselineLabel:`CaptureProof ${r.implementation} · authored candidate`;
   add(card,node('h3',label),node('p',`Financial verdict: ${r.verdict} · Recovery progress: ${r.progress.status}`),node('p',r.progress.reason),node('p',`${r.money.display} · Provider capture: ${last.providerCapture?.status??'not observed'} · Merchant: ${last.afterShutdown.collection.status}`));
   add(card,node('p',`Capture POSTs ${last.counters.posts??'unknown'} · accepted operations ${last.counters.accepted??'unknown'} · unique captures ${last.counters.providerCaptures??'unknown'} · active DB rows ${last.afterShutdown.captures.length}`));
   const failures=[...new Set(r.checkpoints.flatMap(c=>c.verdict.rules.filter(x=>x.status==='FAIL').map(x=>x.reason)))];for(const reason of failures)card.append(node('p',reason,'warning'));
   if(!failures.length)card.append(node('p','No financial invariant violation in the observed returned checkpoints. This does not establish universal safety.'));
   add(card,node('p',`Execution ${r.runId}`,'small'),node('p','A changed row after compensation or refreshed completion timestamp alone is not a duplicate payment.','small'));
   for(const c of r.checkpoints){const d=node('details');d.id=`evidence-${r.runId}-${c.index}`;add(d,node('summary',`Checkpoint ${c.index} · ${c.returned.kind} · ${c.verdict.status}`),node('p',`POSTs ${c.counters.posts??'unknown'} / accepted ${c.counters.accepted??'unknown'} / provider captures ${c.counters.providerCaptures??'unknown'} / DB rows ${c.afterShutdown.captures.length}`),node('p',`Independent SQL PID ${c.afterShutdown.backendPid}, transaction ${c.afterShutdown.transactionId}. Auditor non-mutation: ${c.auditorNonMutation}.`),node('pre',JSON.stringify(c,null,2)));card.append(d);}
   const references=node('details');references.append(node('summary','Executed source references'));
   for(const [path,sha] of Object.entries(r.sourceHashes)){const index=job.sources.findIndex(s=>s.path===path&&s.sha256===sha);if(index<0)continue;const a=node('a',path);a.href=`#verification-source-${index}`;a.onclick=()=>{const t=$('verification-source-'+index);t.closest('details').open=true;};references.append(add(node('p'),a));}card.append(references);
   add(card,details('Ordered observations and source bindings',{crash:r.crash,events:r.events,sourceHashes:r.sourceHashes}));comparison.append(card);
  }panel.append(comparison);
  const limits=details('Scope and execution identity',{limits:job.limits,jobId:job.id,createdAt:job.createdAt});panel.append(limits);
  if(currentView==='result'){const a=node('a','Open execution controls in developer view');a.href='/external?view=develop&job='+job.id+(selectedCase?'&case='+encodeURIComponent(selectedCase):'');panel.append(a);}
  if(selectedCase){const target=job.executions.find(e=>e.caseId===selectedCase&&e.role==='baseline')??job.executions.find(e=>e.caseId===selectedCase),nav=node('nav',undefined,'finding-actions');if(target){const inspect=link('Inspect evidence →',`execution-${target.runId}`);inspect.className='primary-action';nav.append(inspect);portableDownload(nav,job,target);}nav.append(link('Frozen source','frozen-sources'));if(job.repairReview?.availability==='AVAILABLE')nav.append(link('Developer-authored repair','repair-review'));panel.querySelector('.scenario-result .finding-lead')?.after(nav);}
  if(/^#execution-[0-9a-f-]{36}$/.test(location.hash))document.getElementById(location.hash.slice(1))?.scrollIntoView();
  const selected=new URL(location.href).searchParams.get('analysis');if(job.executions.some(e=>e.runId===selected))document.getElementById('read-analysis-'+selected)?.click();
  const sources=node('details');sources.append(node('summary','Frozen executed source · upstream and authored candidates'));
  for(const [index,s] of job.sources.entries()){const heading=node('h4',s.path);heading.id=`verification-source-${index}`;add(sources,heading,node('p',s.sha256,'mono'),node('pre',s.text.split('\n').map((line,i)=>`${i+1}: ${line}`).join('\n')));}panel.append(sources);
  const download=node('button','Download sanitized comparison JSON');download.id='verification-export';download.onclick=async()=>{try{const data=await request(`/api/verifications/${job.id}/export`);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download=`captureproof-verification-${job.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('verification-status').textContent=e.message;}};panel.append(download);
 }
 function download(label,value,filename){const b=node('button',label);b.type='button';b.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=node('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};return b;}
 function renderCampaign(job){
  const panel=$('verification-result');panel.replaceChildren();const running=['QUEUED','RUNNING'].includes(job.state);executionActive=running;syncControls();
  if(!job.executions.length&&['FAILED','INTERRUPTED'].includes(job.state)){renderStartFailure(panel,job);return;}
  const presentation=jobPresentation(job);
  
  if(selectedCase&&!job.summary?.cases.some(c=>c.id===selectedCase)){unavailable('The selected scenario is not present in this saved job.');return;}
  $('saved-result-title').textContent=selectedCase?selectedCase.replaceAll('-',' '):savedJobLabel(job).title;
  $('verification-status').textContent=`${job.plan.kind==='campaign'?'Campaign execution':'Execution'} ${job.state} · ${job.executions.length}/${job.plan.maxExecutions} execution artifacts · ${job.error??'No infrastructure error recorded'}`;
  if(!selectedCase)add(panel,node('h2',selectedCase?'Observed failure and repair':job.plan.kind==='campaign'?'Findings & repair comparison':'Failure reproduction'),node('p',`Candidate: ${job.plan.candidateName??job.plan.target} · actual Medusa/PostgreSQL · simulated PayPal.`));
  if (selectedCase && job.summary) {
   const scenarios = node('nav', undefined, 'scenario-navigation');
   scenarios.setAttribute('aria-label', 'Scenarios in this campaign');
   for (const entry of job.summary.cases) {
    const anchor = node('a', entry.id.replaceAll('-', ' '));
    anchor.href = `/external?job=${job.id}&case=${entry.id}`;
    if (entry.id === selectedCase) anchor.setAttribute('aria-current', 'page');
    scenarios.append(anchor);
   }
   panel.append(scenarios, node('p', 'Recorded comparison · real Medusa/PostgreSQL and installed SDK · simulated PayPal. Developer-authored repair; no new execution.', 'scope-line'));
  }
  if(job.summary){
   if(!selectedCase)add(panel,node('p',`${presentation.observedPairs} completed comparison pairs of ${presentation.plannedPairs} planned. ${presentation.comparison==='COMPLETE'?'Coverage complete.':'Remaining scenarios have no comparison yet.'}`));
   if(!selectedCase&&presentation.counts)add(panel,node('p',`${presentation.counts.resolved} scenario pairs with resolved rules · ${presentation.counts.regressions} with introduced rules · ${presentation.counts.remaining} with retained rules · ${presentation.counts.inconclusive} with uncertainty. Categories may overlap; completed pairs only.`,'result-summary'));
   for(const c of job.summary.cases.filter(c=>!selectedCase||c.id===selectedCase)){
    const group=node('section',undefined,'scenario-result');if(selectedCase)group.id='result-overview';if(!selectedCase)group.append(node('h3',c.id.replaceAll('-',' ')));add(group,node('span',c.outcome==='NOT_COMPLETED'?'Comparison unavailable':`${c.outcome} · observed pair`,'badge'));
    const finding=scenarioFinding(job.executions.find(e=>e.caseId===c.id&&e.role==='baseline'),job.executions.find(e=>e.caseId===c.id&&e.role==='candidate'));add(group,node('p',resultHeadline(job.executions.find(e=>e.caseId===c.id&&e.role==='baseline')?.checkpoints[0],finding.finding),'finding-lead'),node('p',finding.candidate,'small'));
    const rules=details('Comparison certainty and observed rule changes',c);
    const pair=node('div',undefined,'comparison');
    const sides = ['baseline', 'candidate'].map(role => job.executions.find(e => e.caseId === c.id && e.role === role));
    for (const [index, execution] of sides.entries()) {
     const card = window.renderCaptureCheckpoint(index ? 'Repair / candidate' : 'Original integration', checkpointPresentation(execution?.checkpoints[0]));
     if (execution) card.append(link('Inspect observations', `execution-${execution.runId}`));
     pair.append(card);
    }
    group.append(window.renderCaptureComparison(...sides.map(execution => checkpointPresentation(execution?.checkpoints[0]))), pair, node('p', 'Same first returned-call boundary. Authorized is a local merchant state, not proof of PayPal authorization or money movement. Rows are database records, not deliveries.', 'small'));
    const count = Math.max(...sides.map(execution => execution?.checkpoints.length ?? 0));
    if (count > 0) {
     const timeline = node('section', undefined, 'checkpoint-timeline');
     if (selectedCase) timeline.id = 'result-evidence';
     timeline.append(node('h3', 'Evidence progression'), node('p', 'Later completion preserves earlier failures. POST attempts are not duplicate charges.', 'small'));
     for (let index = 0; index < count; index++) {
      const entries = sides.map((execution, side) => {
       const checkpoint = execution?.checkpoints[index];
       const label = side ? 'Repair / candidate' : 'Original';
       const card = window.renderCaptureCheckpoint(label, checkpointPresentation(checkpoint));
       card.append(details('Recorded rules, assessments and snapshots', checkpoint ?? { observation: 'Unavailable' }));
       return { label, view: checkpointPresentation(checkpoint), card };
      });
      timeline.append(window.renderCapturePhase(`Checkpoint ${index + 1}`, entries));
     }
     group.append(timeline);
    }
    group.append(rules);panel.append(group);
   }
  }
  if(job.repairReview?.availability==='AVAILABLE'){const review=node('details');review.id='result-repair';review.append(node('summary','Developer-authored repair code review'));window.mountRepairReview(review,job,request,{exactAnalysis:true});panel.append(review);}
  if(job.state==='FAILED'||job.state==='INTERRUPTED')add(panel,node('p',`Execution stopped: ${job.error??job.state}. ${job.errorDetail??''} Partial observations remain below; this is not a new payment-rule finding. Refresh will not retry. Run npm run verify -- check and inspect the saved error before an explicit retry.`,'warning'));
  else if(job.state==='COMPLETED')add(panel,node('p','Inspect the independent checkpoints and frozen source, then export this execution. Saved replay links read existing evidence; a new replay requires an explicit action in the developer view. INCONCLUSIVE means evidence or the observation window is incomplete.'));
  if(job.reduction)add(panel,node('h3',job.reduction.status),node('p',job.reduction.scope),details('Tested reductions and retained sequence',job.reduction));
  if(job.reproduction)add(panel,node('h3',job.reproduction.status),details('Replay outcome',job.reproduction));
  const resultFiles=node('section');resultFiles.id='result-files';resultFiles.append(node('h2','Files and saved execution details'));panel.append(resultFiles);
  resultFiles.append(details('Job, candidate and scenario identity',{id:job.id,plan:job.plan,candidateDigest:job.candidateDigest}));
  for(const e of job.executions){
   const card=node('details',undefined,'execution');card.id=`execution-${e.runId}`;card.append(node('summary',`${e.caseId??e.role} · ${e.role} · ${e.verdict} — evidence, AI & exports`));portableDownload(card,job,e);add(card,node('h3',`${e.caseId??e.role} · ${e.role} · ${e.verdict}`),node('p',`Execution ${e.runId}`,'small'));
   for(const c of e.checkpoints){for(const rule of c.verdict.rules??[])if(rule.status==='FAIL'){const finding=node('p',`${rule.id}: ${rule.reason} `,'warning');finding.append(link(`Inspect checkpoint ${c.index}`,`evidence-${e.runId}-${c.index}`));card.append(finding);}if(c.verdict.uncertainty)card.append(node('p',`Checkpoint ${c.index}: ${c.verdict.uncertainty.reason}`,'warning'));if(c.assessment?.changed)add(card,node('p',assessmentDescription(c.assessment),'notice'),details(`Separate current assessment · ${c.assessment.version} · ${c.assessment.current.status}`,c.assessment));if(c.verdict.status==='INCONCLUSIVE')card.append(node('p',`Checkpoint ${c.index}: INCONCLUSIVE — ${c.verdict.reason??'Evidence or observation window is incomplete.'}`));}
   for(const p of e.checkpoints)add(card,node('p',`Checkpoint ${p.index}: ${p.providerCapture?.status??'unavailable'} provider / ${p.afterShutdown.collection.status} merchant; POSTs ${p.counters.posts??'unknown'}, accepted ${p.counters.accepted??'unknown'}, provider captures ${p.counters.providerCaptures??'unknown'}, active DB rows ${p.afterShutdown.captures.length}. ${p.verdict.status}.`));
   for(const c of e.checkpoints){const d=details(`Checkpoint ${c.index} · ${c.returned?.kind??'Unknown'} · ${c.verdict.status}`,c);d.id=`evidence-${e.runId}-${c.index}`;card.append(d);}
   const refs=node('details');refs.append(node('summary','Inspect executed source'));for(const [path,sha]of Object.entries(e.sourceHashes)){const index=job.sources.findIndex(s=>s.path===path&&s.sha256===sha);if(index>=0)refs.append(add(node('p'),link(path,`verification-source-${index}`)));}card.append(refs);
   card.append(details('Ordered observations and execution identity',e));
   if(e.failureRules?.length){
    const load=()=>request(`/api/verifications/${job.id}/reproducer/${e.runId}`),loadRepair=()=>request(`/api/verifications/${job.id}/repair-reproducer/${e.runId}`);
    const replayStatus=node('p','Checking exact replay evidence…','small');card.append(replayStatus);
    request(`/api/verifications/${job.id}/replay-evidence/${e.runId}`).then(v=>{replayStatus.textContent=v?`Exact failure replay: ${v.upstream.status}. Repair comparison: ${v.repair?.status??'NOT RUN'}.`:'Exact exported artifact: UNEXECUTED. Downloading is not replaying.';if(v){const a=node('a','Open saved replay');a.href='/external?job='+v.upstream.jobId;card.append(a);if(v.repair){const b=node('a','Open saved repair replay');b.href='/external?job='+v.repair.jobId;card.append(add(node('p'),b));}}}).catch(err=>{replayStatus.textContent='Replay evidence unavailable: '+err.message;});
    if(e.role==='baseline'&&job.executions.some(p=>p.role==='candidate'&&p.caseId===e.caseId)){const repairExport=node('button','Export matching repair comparison');repairExport.onclick=async()=>{try{download('Save repair reproducer',await loadRepair(),`captureproof-repair-${e.runId}.json`).click();}catch(err){$('verification-status').textContent=err.message;}};card.append(repairExport);}
    const exportButton=node('button','Export replayable failure');exportButton.onclick=async()=>{try{const p=await load();download('Save reproducer JSON',p,`captureproof-reproducer-${e.runId}.json`).click();}catch(err){$('verification-status').textContent=err.message;}};card.append(exportButton);
    card.append(node('p',`Save the export into the supported workspace, then run: npm run verify -- replay captureproof-reproducer-${e.runId}.json. This is one new execution; viewing and downloading do not replay.`,'small'));
    for(const [action,label]of (currentView==='develop'?[['replay','Replay failure · 1 execution'],...(e.role==='baseline'&&job.executions.some(p=>p.role==='candidate'&&p.caseId===e.caseId)?[['repair','Replay matching repair · 1 execution']]:[]),['reduce','Reduce failure · at most 4 executions']]:[])){const b=node('button',label);b.disabled=recordedOnly||running||!setupReady;b.onclick=async()=>{if(submitting||executionActive||recordedOnly||!setupReady)return;submitting=true;syncControls();b.disabled=true;try{const reproducer=await (action==='repair'?loadRepair():load()),key=`reproductionLaunchKey:${job.id}:${e.runId}:${action}`,launchKey=sessionStorage.getItem(key)??crypto.randomUUID();sessionStorage.setItem(key,launchKey);const j=await request('/api/reproductions',{action:action==='repair'?'replay':action,reproducer,artifactText:JSON.stringify(reproducer,null,2)+'\n',launchKey});sessionStorage.removeItem(key);await refreshList();await select(j.id);}catch(err){$('verification-status').textContent=err.message;}finally{submitting=false;syncControls();b.disabled=recordedOnly||executionActive||!setupReady;}};card.append(b);}
   }
   const analysis=node('button','Read stored AI analysis · no generation');analysis.id='read-analysis-'+e.runId;analysis.onclick=async()=>{analysis.disabled=true;try{const data=await request(`/api/verifications/${job.id}/analysis/${e.runId}`);card.querySelector('#exact-diagnosis-'+e.runId)?.remove();const attempt=window.captureFragment().match(/^request-([0-9a-f-]{36})-analysis-/)?.[1];const saved=attempt&&data.records.find(r=>r.id===attempt);if(attempt&&!saved)card.append(node('p','The linked stored attempt is unavailable. No other response was substituted.'));else window.mountExactExecutionDiagnosis(card,saved?{...data,records:[saved]}:data,saved?{instance:'request-'+attempt}:{});}catch(err){card.append(node('p',`Stored analysis unavailable: ${err.message}`));}finally{analysis.disabled=false;}};card.append(analysis);
   if(!recordedOnly)mountExecutionAssistance(card,{jobId:job.id,executionId:e.runId,request});
   const prepare=node('button','Inspect exact-run AI input · no generation');prepare.onclick=async()=>{prepare.disabled=true;try{const p=await request(`/api/verifications/${job.id}/diagnosis/${e.runId}`);add(card,node('p','Request inspection only. Use Read stored AI analysis for this execution’s generation and review status.'),download('Download UNSENT request',p,`captureproof-unsent-${e.runId}.json`),details('Bound input and source',p));}catch(err){card.append(node('p',`Preparation unavailable: ${err.message}`));}finally{prepare.disabled=false;}};const advanced=node('details');advanced.append(node('summary','Advanced request inspection'));advanced.append(prepare);card.append(advanced);resultFiles.append(card);
  }
  const sourceGroup=node('details');sourceGroup.id='frozen-sources';sourceGroup.append(node('summary','Frozen source snapshots'));resultFiles.append(sourceGroup);
  for(const [index,source]of job.sources.entries()){const d=details(`Frozen execution source ${source.path} · ${source.sha256}`,source.text.split('\n').map((line,i)=>`${i+1}: ${line}`).join('\n'));d.id=`verification-source-${index}`;sourceGroup.append(d);}
  resultFiles.append(download('Download campaign / replay evidence JSON',job,`captureproof-${job.id}.json`));
  const limits=details('Scope and execution identity',{limits:job.limits,jobId:job.id,createdAt:job.createdAt});resultFiles.append(limits);
  if(currentView==='result'){const a=node('a','Open execution controls in developer view');a.href='/external?view=develop&job='+job.id+(selectedCase?'&case='+encodeURIComponent(selectedCase):'');panel.append(a);}
  if(selectedCase){const target=job.executions.find(e=>e.caseId===selectedCase&&e.role==='baseline')??job.executions.find(e=>e.caseId===selectedCase),nav=node('nav',undefined,'finding-actions');if(target){const inspect=link('Inspect evidence →',`execution-${target.runId}`);inspect.className='primary-action';nav.append(inspect);portableDownload(nav,job,target);}nav.append(link('Frozen source','frozen-sources'));if(job.repairReview?.availability==='AVAILABLE')nav.append(link('Developer-authored repair','repair-review'));panel.querySelector('.scenario-result .finding-lead')?.after(nav);if(target)mountAnalysisOverview(nav,job,target);}
  if(/^#execution-[0-9a-f-]{36}$/.test(location.hash))document.getElementById(location.hash.slice(1))?.scrollIntoView();
  if (selectedCase) {
   if (!document.getElementById('result-repair')) { const absent=node('section');absent.id='result-repair';absent.append(node('h2','Repair'),node('p','No matching developer repair is available.'));resultFiles.before(absent); }
   const nav=node('nav',undefined,'result-nav');nav.setAttribute('aria-label','Result sections');
   for(const [id,label] of [['result-overview','Overview'],['result-evidence','Evidence'],['selected-ai-review','AI review'],['result-repair','Repair'],['result-files','Files']]) nav.append(link(label,id));
   panel.prepend(nav);window.trackCaptureSections(nav);
  }
  const linked = job.executions.find(e => window.captureFragment().includes('analysis-'+e.runId+'-'));
  if (linked) document.getElementById('read-analysis-'+linked.runId)?.click();
  const selected=new URL(location.href).searchParams.get('analysis');if(selected!==linked?.runId&&job.executions.some(e=>e.runId===selected))document.getElementById('read-analysis-'+selected)?.click();
 }
 function mountAnalysisOverview(nav,job,target){
  const section=node('section',undefined,'analysis-overview');section.id='selected-ai-review';
  const status=node('p','Reading stored analysis for this execution…');status.setAttribute('aria-live','polite');
  const history=node('details');history.append(node('summary','Stored attempt outcomes'),status);
  add(section,node('h3','AI review'),history,node('p','Payment-rule findings are deterministic. Repairs shown here are developer-authored; AI does not apply them.','small'));
  const inspect=link('Inspect this execution’s AI evidence and review',`execution-${target.runId}`),open=inspect.onclick;
  inspect.onclick=()=>{open();$('read-analysis-'+target.runId)?.click();};section.append(inspect);
  if(historicalExample?.available){const earlier=node('a','Separate earlier example: stored AI explanation, citations & PARTIAL review');earlier.href=historicalExample.url+'#ai';history.append(add(node('p'),earlier));}
  nav.closest('.scenario-result')?.after(section);
  request(`/api/verifications/${job.id}/analysis/${target.runId}`).then(data=>{if(section.isConnected)status.textContent=storedAnalysisSummary(data,target.runId);}).catch(()=>{if(section.isConnected)status.textContent='Stored analysis unavailable. This does not establish that no response exists; no generation was attempted.';});
 }
 function renderStartFailure(panel,job){
  $('verification-status').textContent=jobPresentation(job).title;
  add(panel,node('h2','Verification could not start'),node('p','Comparison unavailable. No payment experiment produced usable evidence.','warning'),node('p',executionRecovery(`${job.error} ${job.errorDetail??''}`)),details('Retained initialization error',{jobId:job.id,error:job.error,detail:job.errorDetail,attempts:job.attempts??'Not recorded by this historical worker'}),download('Download job record',job,`captureproof-${job.id}.json`));
 }
 async function select(id,{caseId=null,view='result'}={}){activeId=id;selectedCase=caseId;clearTimeout(timer);const url=new URL(location.href);url.searchParams.set('job',id);url.searchParams.delete('report');url.searchParams.delete('example');if(view==='develop')url.searchParams.set('view','develop');else url.searchParams.delete('view');if(caseId)url.searchParams.set('case',caseId);else url.searchParams.delete('case');history.replaceState(null,'',url);setView(view);await poll();if(currentView==='result'||currentView==='develop'){if(location.hash)window.revealCaptureTarget(window.captureFragment());else{$('saved-result-title').focus({preventScroll:true});$('saved-result-title').scrollIntoView({block:'start'});}}}
 async function poll(){try{const id=activeId,job=await request(`/api/verifications/${id}`);if(id!==activeId)return;render(job);if(['QUEUED','RUNNING'].includes(job.state))timer=setTimeout(poll,1500);else await refreshList();}catch(e){unavailable(e.message);}}
 async function refreshList() {
  const data = await request('/api/verifications');
  $('verification-empty').hidden = data.jobs.length > 0;
  historicalExample = data.example;
  recordedOnly = data.recordedOnly === true;
  choices = data.choices;
  setupReady = data.setup?.ready === true;
  executionActive = data.setup?.availability?.ready === false || data.jobs.some(job => ['QUEUED', 'RUNNING'].includes(job.state));

  $('example-status').textContent = data.example?.available
   ? 'Separate earlier recorded example with stored AI review. Actual Medusa/PostgreSQL; simulated PayPal. Viewing starts no execution or AI call.'
   : data.example?.reason ?? 'The earlier recorded example is unavailable.';
  const links = $('example-links'); links.replaceChildren();
  if (data.example?.available) {
   for (const [label, path] of [['Historical AI example · PARTIAL review', data.example.url], ['Download historical AI example', data.example.download], ['Historical comparison before v6', '/examples/reviewed-comparison']]) {
    const anchor = node('a', label); anchor.href = path; links.append(add(node('p'), anchor));
   }
  }
  if (recordedOnly) {
   $('verify-entry').textContent = 'Review saved results';
   $('verify-entry').href = '#verification-workspace';
  }
  $('capability-banner').textContent = recordedOnly ? 'Recorded viewing available'
   : !setupReady ? `Fresh execution unavailable · ${data.setup?.code ?? 'Capability unknown'}`
   : executionActive ? 'Verification running · saved evidence remains available'
   : 'Fresh execution available · dependencies and child isolation checked';
  $('verification-setup').textContent = data.setup ? `${data.setup.code}: ${data.setup.message ?? ''} ${data.setup.command ?? ''}` : '';
  if (data.candidates) {
   const selected = $('campaign-candidate').value;
   $('campaign-candidate').replaceChildren();
   for (const candidate of data.candidates) {
    const option = node('option', candidate.name); option.value = candidate.id; $('campaign-candidate').append(option);
   }
   if (data.candidates.some(candidate => candidate.id === selected)) $('campaign-candidate').value = selected;
  }
  const list = $('verification-history'); list.replaceChildren();
  for (const job of data.jobs) {
   const label = savedJobLabel(job), row = node('article', undefined, 'saved-result'), anchor = node('a', label.title);
   anchor.href = '/external?job=' + job.id;
   add(row, anchor, node('p', label.outcome), node('p', label.execution, 'small'),
    details('Identity and recorded time', { id: job.id, candidate: job.plan.candidateName ?? job.plan.target, createdAt: job.createdAt }));
   list.append(row);
  }
  if (data.resultExample !== undefined) {
   // Bundled evidence is labeled and never resolved through private job IDs.
   const selected = data.resultExample?.available ? data.resultExample : data.bundledExample;
   preview(selected);
   const anchor = $('explore-example'); anchor.hidden = false;
   if (selected?.available) {
    anchor.href = selected.url;
    anchor.textContent = selected.origin === 'BUNDLED_RECORDED_EVIDENCE' ? 'Inspect bundled recorded comparison' : 'Inspect workspace comparison';
   } else {
    anchor.href = '#result-preview'; anchor.textContent = 'Reviewed comparison unavailable';
   }
  }
  syncControls();
  return data;
 }
 $('candidate-import').onclick=async()=>{try{const c=await request('/api/candidates',{directory:$('candidate-directory').value});await refreshList();$('campaign-candidate').value=c.id;reviewedPlan=null;syncControls();$('candidate-status').textContent=`Imported ${c.name}. Review the plan next. Validation is not evidence of payment correctness.`;$('campaign-review').focus();}catch(e){$('candidate-status').textContent=e.message;}};
 async function submit(event,selection){
  event.preventDefault();if(recordedOnly||!setupReady||executionActive||submitting)return;
  const chosen=selection();if(chosen.campaign&&(!reviewedPlan||reviewedPlan.candidateId!==chosen.candidateId))return;
  submitting=true;syncControls();launchKey??=crypto.randomUUID();sessionStorage.setItem('verificationLaunchKey',launchKey);
  try{const job=await request('/api/verifications',{...chosen,launchKey,...(chosen.campaign?{planFingerprint:reviewedPlan.fingerprint}:{})});launchKey=null;sessionStorage.removeItem('verificationLaunchKey');await refreshList();await select(job.id);}
  catch(e){$('verification-status').textContent=e.message;await refreshList();}
  finally{submitting=false;syncControls();}
 }
 $('campaign-candidate').onchange=()=>{reviewedPlan=null;$('plan-preview').replaceChildren();syncControls();};
 $('campaign-review').onclick=async()=>{
  const button=$('campaign-review'),candidateId=$('campaign-candidate').value;button.disabled=true;
  try{
   const plan=await request('/api/verification-plan',{campaign:'core-1',candidateId});
   if(candidateId!==$('campaign-candidate').value)return;
   reviewedPlan={candidateId,fingerprint:plan.fingerprint};
   const panel=$('plan-preview');panel.replaceChildren(node('p',`${plan.plan.maxExecutions} isolated executions · ${plan.plan.candidate} · simulated PayPal. No AI request. Review all scenarios and source identity before running.`),details('Scenarios, source identity and capability',plan));panel.focus();
  }catch(error){reviewedPlan=null;$('plan-preview').textContent=error.message;}
  finally{button.disabled=false;syncControls();}
 };
 $('campaign-form').onsubmit=e=>submit(e,()=>({campaign:'core-1',candidateId:$('campaign-candidate').value}));
 $('verification-form').onsubmit=e=>submit(e,()=>({target:$('verification-target').value,scenario:$('verification-scenario').value}));
 if($('capability-recheck'))$('capability-recheck').onclick=async()=>{const b=$('capability-recheck');b.disabled=true;try{await request('/api/verification-capability',{});await refreshList();}catch(e){$('verification-status').textContent=e.message;}finally{b.disabled=false;}};
 (async()=>{try{const v=await refreshList();for(const [id,entries]of[['verification-target',choices.targets],['verification-scenario',choices.scenarios]])for(const entry of entries){const o=node('option',entry.label);o.value=entry.id;$(id).append(o);}context();$('candidate-campaign').hidden=recordedOnly;syncControls();$('verification-scenario').onchange=context;$('verification-launch').disabled=recordedOnly||!setupReady;if(recordedOnly){$('verification-workspace').before($('recorded-demo'));$('verification-launch').textContent='Fresh verification unavailable in recorded demo';$('verification-context').textContent='Read-only selected artifacts; no payment database or worker access. Fresh local verification remains an explicit action in npm run start:verification.';}const route=resultRoute(location.search,v.jobs,location.hash);setView(recordedOnly&&route.view==='explore'?'history':route.view);if(route.id)await select(route.id,{caseId:route.caseId,view:route.view});else if(route.view==='unavailable')unavailable(route.reason);else if(currentView==='history'){document.querySelector('.history-archive').open=true;window.dispatchEvent(new Event('captureproof:history'));document.querySelector('.history-archive').scrollIntoView();}else $('verification-status').textContent=currentView==='develop'?'Execution requires an explicit action. Saved results remain available below.':'Saved results only — browsing creates no execution.';}catch(e){$('verification-status').textContent=e.message;}})();
})();
