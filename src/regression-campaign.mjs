import {compareRuleObservations} from '../public/verification-state.mjs';
export const CORE_CAMPAIGN=Object.freeze({id:'core-1',maxExecutions:8,cases:[
 {id:'completed-repeat',mode:'completed',phases:[['capture','capture']]},
 {id:'pending-restart',mode:'pending',phases:[['capture'],['settle','capture','capture']]},
 {id:'response-loss',mode:'completed',lostResponse:true,openCheckpoints:[0],phases:[['capture'],['capture','capture']]},
 {id:'readback-outage',mode:'completed',phases:[['lookup-unavailable','capture'],['restore','capture','capture']]}
],limits:['Four controlled scenarios; not production failure rates.','Reservation-crash uses a different baseline/contract and remains in the separate existing workflow.','Real Medusa/PostgreSQL; simulated PayPal. No concurrency, live retention or fulfillment verification.']});
const actions=new Set(['capture','observe','settle','lookup-unavailable','restore','hide-capture','reveal-capture']);
export function validReplaySpec(s){return !!s&&Object.keys(s).every(k=>['id','mode','phases','lostResponse','openCheckpoints'].includes(k))&&(s.lostResponse===undefined||typeof s.lostResponse==='boolean')&&['pending','completed'].includes(s.mode)&&Array.isArray(s.phases)&&s.phases.length>=1&&s.phases.length<=2&&s.phases.every(p=>Array.isArray(p)&&p.length&&p.length<=8&&p.every(a=>actions.has(a))&&p.some(a=>['capture','observe'].includes(a)))&&(!s.openCheckpoints||Array.isArray(s.openCheckpoints)&&s.openCheckpoints.every(n=>Number.isInteger(n)&&n>=0&&n<s.phases.flat().filter(a=>['capture','observe'].includes(a)).length));}
export function failingRules(trace){return [...new Set(trace.checkpoints.flatMap(c=>c.verdict.rules.filter(r=>r.status==='FAIL').map(r=>r.id)))];}
export function campaignSummary(executions){
 const cases=CORE_CAMPAIGN.cases.map(s=>{
  const baseline=executions.find(e=>e.caseId===s.id&&e.role==='baseline'),candidate=executions.find(e=>e.caseId===s.id&&e.role==='candidate');
  const result=compareRuleObservations(baseline?.trace,candidate?.trace,{expectedCheckpoints:s.phases.flat().filter(a=>['capture','observe'].includes(a)).length});
  return {id:s.id,...result,completionBoundary:result.final.candidate,baseline:baseline?.trace.comparisonStatus??'NOT RUN',candidate:candidate?.trace.comparisonStatus??'NOT RUN'};
 });
 return {cases,denominator:CORE_CAMPAIGN.cases.length,regressions:cases.filter(c=>c.introduced.length).length,resolved:cases.filter(c=>c.resolved.length).length,remaining:cases.filter(c=>c.remaining.length).length,inconclusive:cases.filter(c=>c.outcome==='INCONCLUSIVE').length};
}
export function deletionCandidates(spec){
 const result=[];
 // Open observation-window indices would shift: retain their full reproducer in this version.
 if(spec.openCheckpoints?.length)return result;
 for(let p=spec.phases.length-1;p>=0;p--)for(let a=spec.phases[p].length-1;a>=0;a--){const next=structuredClone(spec);next.phases[p].splice(a,1);if(!next.phases[p].length)next.phases.splice(p,1);if(validReplaySpec(next))result.push({spec:next,removed:{phase:p+1,step:a+1,action:spec.phases[p][a]}});}
 return result;
}
