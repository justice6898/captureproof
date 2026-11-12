// Summaries of existing rule observations, never a financial verdict engine.
const points=r=>r?.checkpoints??[];
const failures=r=>[...new Set(points(r).flatMap(c=>(c.verdict?.rules??[]).filter(v=>v.status==='FAIL').map(v=>v.id)))];
export function compareRuleObservations(baseline,candidate,{expectedCheckpoints}={}){
 const b=points(baseline),c=points(candidate),old=failures(baseline),now=failures(candidate);
 const expected=expectedCheckpoints??Math.max(b.length,c.length);
 const complete=!!baseline?.finishedAt&&!!candidate?.finishedAt&&expected>0&&b.length===expected&&c.length===expected;
 const status=(cp,id)=>cp?.verdict?.rules?.find(r=>r.id===id)?.status;
 // A missing rule is not a PASS. Attribute only across matching returned-call boundaries.
 const contrasted=(from,to,id)=>from.some((cp,i)=>status(cp,id)==='FAIL'&&status(to[i],id)==='PASS');
 const resolved=complete&&c.at(-1)?.verdict?.status!=='INCONCLUSIVE'?old.filter(id=>!now.includes(id)&&contrasted(b,c,id)):[];
 const introduced=complete&&b.at(-1)?.verdict?.status!=='INCONCLUSIVE'?now.filter(id=>!old.includes(id)&&contrasted(c,b,id)):[];
 const remaining=old.filter(id=>now.includes(id));
 const unresolved=[...new Set([...old.filter(id=>!remaining.includes(id)&&!resolved.includes(id)),...now.filter(id=>!remaining.includes(id)&&!introduced.includes(id))])];
 const inconclusive=b.concat(c).some(cp=>!['PASS','FAIL'].includes(cp.verdict?.status)||cp.verdict?.uncertainty||!cp.verdict?.rules?.length);
 const final={baseline:b.at(-1)?.verdict?.status??'NOT OBSERVED',candidate:c.at(-1)?.verdict?.status??'NOT OBSERVED'};
 const outcome=!complete?'NOT_COMPLETED':introduced.length&&resolved.length?'MIXED':introduced.length?'REGRESSION':remaining.length?'REMAINS':resolved.length?'RESOLVED':inconclusive||unresolved.length?'INCONCLUSIVE':'NO_OBSERVED_FAILURE';
 return {scope:'scenario pair',comparison:complete?'COMPLETE':'UNAVAILABLE',outcome,baselineFailures:old,candidateFailures:now,resolved,introduced,remaining,unresolved,final,earlierUncertainty:b.concat(c).some(cp=>cp.verdict?.status==='INCONCLUSIVE'||cp.verdict?.uncertainty),summary:!complete?'Comparison unavailable — incomplete execution or observations.':`Rule changes at matching observed boundaries: ${resolved.length} resolved, ${introduced.length} introduced, ${remaining.length} retained, ${unresolved.length} unattributed.`,limits:'Rule changes describe this scenario pair; final checkpoints do not erase history. Missing or uncollected observations are not zero.'};
}
export function jobPresentation(job){
 const count=job.executions.length,stopped=['FAILED','INTERRUPTED'].includes(job.state),pairs=job.summary?.cases.filter(c=>c.outcome!=='NOT_COMPLETED')??[];
 return {title:stopped&&!count?'Verification could not start':stopped?'Verification stopped with partial evidence':job.state==='COMPLETED'?'Verification complete':'Verification in progress',comparison:!pairs.length?'UNAVAILABLE':pairs.length===(job.summary?.cases.length??0)?'COMPLETE':'PARTIAL',observedPairs:pairs.length,plannedPairs:job.summary?.cases.length??0,counts:pairs.length?{resolved:pairs.filter(c=>c.resolved?.length||c.outcome==='RESOLVED').length,regressions:pairs.filter(c=>c.introduced?.length||c.outcome==='REGRESSION').length,remaining:pairs.filter(c=>c.remaining?.length||c.outcome==='REMAINS').length,inconclusive:pairs.filter(c=>c.outcome==='INCONCLUSIVE'||c.unresolved?.length).length}:null,hasEvidence:count>0};
}
export function executionRecovery(error){
 if(/ISOLATION|sandbox_apply/.test(error??''))return 'Child isolation could not start. In a normal Terminal outside a parent sandbox, run: npm run start:verification -- 3200. Open http://127.0.0.1:3200/external and recheck capability. No unsandboxed candidate fallback is available.';
 return 'Inspect the retained error and run npm run verify -- check in the same environment as this server. Correct the prerequisite, then explicitly start a new run. Refresh never retries.';
}


export function scenarioFinding(baseline,candidate,options={}){
 const comparison=compareRuleObservations(baseline,candidate,options),descriptions=[];
 for(const[label,r]of [['Original',baseline],['Candidate',candidate]]){
  const violated=points(r).find(c=>c.verdict?.status==='FAIL');if(!violated)continue;
  let text='An observed payment evidence rule failed.';
  if(violated.verdict.rules?.some(r=>r.id==='EXACT_BINDING'&&r.status==='FAIL'))text='Observed order identity, money or persisted relationships do not match the payment contract.';
  else if(violated.providerCapture?.status==='PENDING'&&violated.afterShutdown?.collection?.status==='completed')text='Payment was committed while provider capture was still PENDING.';
  else if(violated.providerCapture?.status==='COMPLETED'&&violated.afterShutdown?.collection?.status!=='completed')text='Provider completed capture, but the merchant did not record completed payment.';
  descriptions.push(`${label}${label==='Candidate'&&comparison.introduced.length?' regression':''}: ${text}`);
 }
 const last=points(candidate).at(-1),history=points(candidate).some(c=>c.verdict?.status==='INCONCLUSIVE'||c.verdict?.uncertainty);
 const finding=descriptions.join(' ')||(comparison.comparison!=='COMPLETE'?'No complete comparison — unobserved results are NOT RUN.':comparison.outcome==='INCONCLUSIVE'?'Evidence remains inconclusive. No absence-of-defect conclusion.':'No violation observed in the completed pair.');
 return {finding,comparison,candidate:!last?'Candidate NOT RUN':`Candidate final checkpoint: ${last.verdict?.status??'Unknown'}${history?' · earlier INCONCLUSIVE retained':''}`,consequence:descriptions.length?'Observed payment-rule violation; inspect the bound observations. External delivery and fulfillment were not tested.':null};
}
export function checkpointDescription(cp){
 if(!cp)return 'Required observation unavailable.';
 return `${cp.providerCapture?.status??'Unknown'} provider / ${cp.afterShutdown?.collection?.status??'Unknown'} merchant; ${cp.afterShutdown?.captures?.length??'Unknown'} active capture rows; rule outcome ${cp.verdict?.status??'Unknown'}.${cp.verdict?.uncertainty ? ' Unresolved: '+cp.verdict.uncertainty.reason : ''}`;
}

// Explicit selection only. A legacy case-only link must resolve to exactly one saved campaign.
export function resultRoute(search,jobs=[],hash=''){
 const p=new URLSearchParams(search),id=p.get('job'),caseId=p.get('case');
 if(p.has('report')||p.has('example'))return {view:'history'};
 if(!search&&['#candidate-campaign','#verification-workspace'].includes(hash))return {view:'develop'};
 if(p.get('view')==='develop'&&!p.has('job'))return {view:'develop'};
 if(p.has('view')&&!['explore','result','develop'].includes(p.get('view')))return {view:'unavailable',reason:'Unknown view.'};
 if(p.has('case')&&!/^[a-z][a-z0-9-]{0,79}$/.test(caseId))return {view:'unavailable',reason:'Invalid scenario selection.'};
 if(p.has('job'))return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)?{view:p.get('view')==='develop'?'develop':'result',id,caseId}:{view:'unavailable',reason:'Invalid saved-job identifier.'};
 if(p.has('case')){const matches=jobs.filter(j=>j.plan.kind==='campaign'&&j.plan.cases?.some(c=>c.id===caseId));return matches.length===1?{view:'result',id:matches[0].id,caseId}:{view:'unavailable',reason:matches.length?'This case belongs to multiple saved comparisons. Choose a specific saved job.':'This case has no saved comparison in this state directory.'};}
 return {view:'explore'};
}
export function savedJobLabel(job){
 const kind=job.plan.kind;let title=kind==='campaign'?'Four-scenario integration comparison':kind==='replay'?(job.plan.implementation==='original'?'Original failure reproduction':'Repair / candidate verification'):kind==='reduce'?'Reduced failure investigation':`${job.plan.scenario} comparison`;
 const outcome=job.evidenceStatus==='UNAVAILABLE'?'Evidence unavailable — no comparison conclusion':job.summary?`${job.summary.resolved} scenario pairs with resolved rules · ${job.summary.regressions} with introduced rules · ${job.summary.cases.filter(c=>c.outcome==='NOT_COMPLETED').length} incomplete`:job.reproduction?`${job.reproduction.status} · ${job.reproduction.rule.replaceAll('_',' ').toLowerCase()}`:(job.state==='COMPLETED'?'Saved observations available':job.executions.length?'Partial evidence — comparison may be unavailable':'No usable observations');
 return {title,outcome,execution:`Execution ${job.state}`};
}
export function checkpointPhase(checkpoints,index){
 const cp=checkpoints[index],before=checkpoints[index-1];
 if(!cp)return 'Observation unavailable';
 if(!index)return 'First returned call';
 if(cp.action==='capture'&&before?.action==='capture'&&cp.providerCapture?.status==='COMPLETED'&&before.providerCapture?.status==='COMPLETED'&&cp.providerCapture?.id&&cp.providerCapture.id===before.providerCapture.id)return 'Repeated call · same completed capture';
 if(cp.providerCapture?.status==='COMPLETED'&&before?.providerCapture?.status!=='COMPLETED')return 'After completed provider evidence';
 return index===checkpoints.length-1?'Final returned call':'Subsequent returned call';
}

// Summarize only analysis bound to the selected execution; details retain each assessment.
export function storedAnalysisSummary(data,executionId){
 if(data?.executionId!==executionId||!Array.isArray(data.records))return 'Stored analysis unavailable for this execution. No other response was substituted.';
 if(data.status==='UNAVAILABLE')return 'Stored analysis unavailable for this execution. Inspect its evidence; no generation was attempted.';
 if(!data.records.length)return 'No matching stored AI response for this execution. The finding and repair comparison are independent of AI; no response was generated.';
 return data.records.map(r=>`Stored response: structural/factual validation ${r.currentValidation??'Unknown'}; semantic review ${r.semanticReviewStatus??'NOT_REVIEWED'}.`).join(' ')+' Inspect the exact input, explanation, citations and response-preservation receipt below. Acceptance is not complete semantic endorsement.';
}

// A current assessment is commentary on immutable observations, never their replacement.
export function assessmentDescription(assessment) {
 if (!assessment) return '';
 const current = assessment.current;
 const binding = current.rules?.some(rule => rule.id === 'EXACT_BINDING' && rule.status === 'FAIL');
 return `Current assessment: ${current.status}. ${binding ? 'Observed identity, money or persisted relationships violate the contract. ' : ''}${current.uncertainty ? 'Still unresolved: ' + current.uncertainty.reason + ' ' : ''}Recorded outcome remains ${assessment.recorded?.status ?? 'unavailable'}. No new execution.`;
}

// A read-only presentation of recorded fields/rules, not a new assessment.
export function checkpointPresentation(cp) {
 const provider = cp?.providerCapture;
 const stored = cp?.afterShutdown?.payment?.storedCaptures;
 const matching = provider?.id && Array.isArray(stored)
  ? stored.filter(capture => capture.id === provider.id) : [];
 const storedStatus = matching.length === 1 ? matching[0].status ?? 'Unknown'
  : !Array.isArray(stored) ? 'Unknown' : stored.length === 0 ? 'Not stored' : 'No unique matching capture';
 const failed = cp?.verdict?.rules?.filter(rule => rule.status === 'FAIL') ?? [];
 const reasons = failed.map(rule => {
  if (rule.id === 'EXACT_BINDING' && matching.length === 1 && provider.status && matching[0].status && provider.status !== matching[0].status) {
   return `EXACT_BINDING: provider capture is ${provider.status}, but the merchant’s stored capture is ${matching[0].status}. This recorded status disagreement remains even when the collection is completed.`;
  }
  return `${rule.id}: ${rule.reason ?? 'Inspect the recorded rule evidence.'}`;
 });
 return {
  status: cp?.verdict?.status ?? 'UNAVAILABLE',
  facts: [
   ['Provider capture', provider?.status ?? 'Unknown'],
   ['Merchant collection', cp?.afterShutdown?.collection?.status ?? 'Unknown'],
   ['Merchant’s stored capture', storedStatus],
   ['Active capture rows', cp?.afterShutdown?.captures?.length ?? 'Unknown']
  ],
  reasons: reasons.length ? reasons : [cp?.verdict?.status === 'PASS'
   ? 'Recorded rules passed at this checkpoint only.' : 'Required observations or a completed observation window are unavailable.'],
  uncertainty: cp?.verdict?.uncertainty?.reason ?? null,
  counters: `POST attempts ${cp?.counters?.posts ?? 'Unknown'} · accepted operations ${cp?.counters?.accepted ?? 'Unknown'} · provider captures ${cp?.counters?.providerCaptures ?? 'Unknown'}`
 };
}

export function resultHeadline(checkpoint, fallback = 'Inspect the recorded payment evidence') {
 const pendingFailure = checkpoint?.verdict?.rules?.some(rule => rule.id === 'PENDING_NOT_COMPLETED' && rule.status === 'FAIL');
 return pendingFailure && checkpoint?.providerCapture?.status === 'PENDING' && checkpoint?.afterShutdown?.collection?.status === 'completed'
  ? 'Payment marked paid before capture completed.' : fallback;
}
