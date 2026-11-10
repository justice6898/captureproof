// Independent expected table: explicit per-boundary PASS/FAIL/unknown facts, not oracle output.
const A='EXACT_BINDING',B='PENDING_NOT_COMPLETED',C='COMPLETED_CAPTURE_RECORDED';
export const cp=(fail=[],unknown=false,omit=[])=>({verdict:{status:unknown?'INCONCLUSIVE':fail.length?'FAIL':'PASS',rules:unknown?[]:[A,B,C].filter(id=>!omit.includes(id)).map(id=>({id,status:fail.includes(id)?'FAIL':'PASS'}))},providerCapture:{status:'PENDING'},afterShutdown:{collection:{status:fail.length?'completed':'authorized'},captures:fail.length?[{id:'capture'}]:[]}});
export const run=(...checkpoints)=>({finishedAt:'2026-11-06T00:00:00.000Z',checkpoints});
export const decisionCases=[
 ['both pass',run(cp()),run(cp()),'NO_OBSERVED_FAILURE',[],[],[]],
 ['original only',run(cp([A])),run(cp()),'RESOLVED',[A],[],[]],
 ['candidate only',run(cp()),run(cp([B])),'REGRESSION',[],[B],[]],
 ['same failures',run(cp([A])),run(cp([A])),'REMAINS',[],[],[A]],
 ['different failures',run(cp([A])),run(cp([B])),'MIXED',[A],[B],[]],
 ['overlapping failures',run(cp([A,B])),run(cp([B,C])),'MIXED',[A],[C],[B]],
 ['setup failure',null,null,'NOT_COMPLETED',[],[],[]],
 ['candidate fail only ran',null,run(cp([B])),'NOT_COMPLETED',[],[],[]],
 ['original fail candidate absent',run(cp([A])),null,'NOT_COMPLETED',[],[],[]],
 ['partial candidate',run(cp([A]),cp([A])),{checkpoints:[cp()]},'NOT_COMPLETED',[],[],[]],
 ['unavailable evidence',run(cp([A])),run(cp([],true)),'INCONCLUSIVE',[],[],[]],
 ['rule explicitly uncollected',run(cp([A])),run(cp([],false,[A])),'INCONCLUSIVE',[],[],[]],
 ['violation then recovery on both',run(cp([A]),cp()),run(cp([A]),cp()),'REMAINS',[],[],[A]],
 ['uncertainty then proof',run(cp([A]),cp([A])),run(cp([],true),cp()),'RESOLVED',[A],[],[]],
 ['uncertain baseline cannot prove regression',run(cp([],true)),run(cp([B])),'INCONCLUSIVE',[],[],[]]
];
