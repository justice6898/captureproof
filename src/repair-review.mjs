import { createHash } from 'node:crypto';
const sha = text => createHash('sha256').update(text).digest('hex');
const base = 'external/medusa-persistence/';
// These annotations describe reviewed source revisions, not every future file with the same name.
const revisions = Object.freeze({
  'target-service.cjs': 'a59c2e7ba870bcf29794d2aab547a14f373fa42179dbaef793e4b8b356b1ea0a',
  'candidate-v3.cjs': '9f1960ce62b59b4f62b232fab0961f98628253cf622aae02a9251a98b4dd36ef',
  'capture-recovery.cjs': '00996f77e4f93ee8bea04537abebba3de9636d696b3c759f470ea9a0f182061d',
  'capture-recovery-v3.cjs': '14a8b2772c99299f39eacfebd4e0d990340a40b1cdd2529683e031ba7e7cfb90',
  'capture-contract.cjs': '09522a31fcdf99094b8002367a75afafa72d0df5a8394c6bb577e0237bdc6c16',
  'operations.cjs': 'b7212c899eaea652f730343cb21043027d0ccff1e8901d4295a30ce1ca1fec96'
});
const wiring = 'scripts/external-persistence-worker.cjs';
// The supplied-source branch preserves the reviewed legacy registration and policy.
const wiringHashes = new Set(['20fb6c7cbb21c8fb9cc6a9a36ee389118a31f3466c904f05f79375d2ef87fa4c', '1ee60a12bac9fc61de0fcec38afdcf1440d5fdda227d2bcbc8fbaf4c26ba1909']);
const unavailable = reason => ({ availability:'UNAVAILABLE', reason, attribution:'Developer-authored engineering review; no model generation.' });

export function buildRepairReview(job, executions, readSource, {caseId} = {}) {
  const campaign=job.plan.kind==='campaign' && caseId==='pending-restart';
  const entries=campaign?job.executions.filter(e=>e.caseId===caseId):job.executions;
  if(job.state!=='COMPLETED' || executions.length!==2) return unavailable('A completed paired execution is required. Existing partial evidence remains below.');
  if(!campaign && (job.plan.scenario!=='pending-restart' || job.plan.baseline!=='original' || job.plan.target!=='candidate-v3')) return unavailable('This code review covers pinned upstream versus revision 3 in pending-restart only. No repair conclusion is borrowed from another scenario.');
  const [before,after]=executions;
  if(before.implementation!=='original'||after.implementation!==(campaign?'supplied':'candidate-v3')||before.runId===after.runId) return unavailable('Execution pairing does not match the declared baseline and candidate.');
  if(campaign && (entries.length!==2 || entries[0].runId!==before.runId || entries[0].role!=='baseline' || entries[1].runId!==after.runId || entries[1].role!=='candidate' || JSON.stringify(entries[0].spec)!==JSON.stringify(entries[1].spec)))return unavailable('Campaign pair identity differs.');
  const first=before.checkpoints?.[0],initial=after.checkpoints?.[0],last=after.checkpoints?.at(-1);
  const failed=first?.verdict?.rules?.find(r=>r.id==='PENDING_NOT_COMPLETED'&&r.status==='FAIL');
  if(!failed || before.verdict!=='FAIL' || after.verdict!=='PASS' || first.providerCapture?.status!=='PENDING' || !first.afterShutdown?.payment?.captured_at ||
    initial?.providerCapture?.status!=='PENDING' || initial.afterShutdown?.payment?.captured_at!==null || initial.afterShutdown?.captures?.length!==0 ||
    last?.providerCapture?.status!=='COMPLETED' || !last.afterShutdown?.payment?.captured_at || last.afterShutdown?.captures?.length!==1)
    return unavailable('The selected observations do not establish the reviewed pending/paid discrepancy and completed candidate outcome. Inspect the original verdicts below.');
  try {
    const files=new Map();
    const load=path=>{
      if(files.has(path))return files.get(path);
      const entry=job.sources.find(s=>s.path===path);if(!entry)throw Error('Missing frozen source');
      const content=readSource(entry);if(sha(content)!==entry.sha256)throw Error('Frozen source hash mismatch');
      const file={path,sha256:entry.sha256,content};files.set(path,file);return file;
    };
    if(campaign)for(const [supplied,name]of [['provider.cjs','candidate-v3.cjs'],['capture-recovery.cjs','capture-recovery.cjs'],['capture-recovery-v3.cjs','capture-recovery-v3.cjs'],['capture-contract.cjs','capture-contract.cjs']])if(after.sourceHashes['supplied/'+supplied]!==revisions[name]||load('supplied/'+supplied).sha256!==revisions[name])throw Error('Supplied source is not the annotated revision');
    for(const[name,expected]of Object.entries(revisions))if(load(base+name).sha256!==expected)throw Error('Source revision has no matching engineering annotation');
    if(!wiringHashes.has(load(wiring).sha256))throw Error('Integration wiring revision has no matching annotation');
    // Every annotated execution component must also be identified by the executed trace.
    for(const r of executions)for(const[path,expected]of Object.entries(r.sourceHashes))if(load(path).sha256!==expected)throw Error('Executed source differs from the frozen snapshot');
    for(const path of [base+'candidate-v3.cjs',base+'capture-recovery.cjs',base+'capture-recovery-v3.cjs',base+'capture-contract.cjs',base+'operations.cjs',wiring])
      if(after.sourceHashes[path]!==load(path).sha256)throw Error('Candidate component lacks execution provenance');
    if(before.sourceHashes[base+'target-service.cjs']!==revisions['target-service.cjs'])throw Error('Baseline source lacks execution provenance');
    const provenance=JSON.parse(load(base+'provenance.json').content);
    if(provenance.plugin?.revision!=='0c4f91334409708e9b21b2ba44b824fc1a5dd0f3'||provenance.versions?.['@medusajs/payment']!=='2.7.0')throw Error('Pinned target identity differs');
    function excerpt(path,start,end){
      const f=load(path),lines=f.content.split('\n');
      const begin=lines.findIndex(line=>line.includes(start));if(begin<0)throw Error('Source anchor unavailable');
      const finish=end?lines.findIndex((line,i)=>i>begin&&line.includes(end)):lines.length;
      if(finish<=begin)throw Error('Source range unavailable');
      return {path,sha256:f.sha256,startLine:begin+1,endLine:finish,lines:lines.slice(begin,finish).map((text,i)=>({number:begin+i+1,text}))};
    }
    const evidence=(r,c)=>({runId:r.runId,checkpoint:c.index,verdict:c.verdict.status,providerStatus:c.providerCapture?.status??null,merchantPaid:!!c.afterShutdown.payment.captured_at,collectionState:c.afterShutdown.collection.status,counters:{...c.counters,databaseRows:c.afterShutdown.captures.length},independentSql:{backendPid:c.afterShutdown.backendPid,transactionId:c.afterShutdown.transactionId}});
    const components=[
      {id:'provider-gate',title:'Replace the provider capture method with a completion gate',layer:'CaptureProof provider subclass; upstream file unchanged',relationship:'Override, not a textual patch to the upstream package.',
        change:'Upstream returns retrieved order data after the SDK call. Revision 3 binds order, authorization, capture, amount and currency, reads capture detail, and throws CAPTURE_PENDING until completed evidence agrees.',
        verified:'Checkpoint 1: upstream paid at PENDING; candidate remains unpaid. Returned recovery checkpoints complete only after read-back.',evidenceRefs:[evidence(before,first),evidence(after,initial),evidence(after,last)],
        before:excerpt(base+'target-service.cjs','    async capturePayment(', '    async authorizePayment('),after:excerpt(base+'candidate-v3.cjs','  async capturePayment(')},
      {id:'binding',title:'Bind initialization and authorization to the full USD capture',layer:'CaptureProof provider subclass',relationship:'Added guards and persisted captureBinding; no upstream file rewrite.',
        change:'Session, order, authorization, exact money and merchant context are carried into the operation and validated against read-back.',verified:'Selected completed candidate observations bind one USD 12.00 capture to the merchant payment. Other invalid-input cases are not rerun here.',evidenceRefs:[evidence(after,last)],before:null,after:excerpt(base+'candidate-v3.cjs','  async initiatePayment(', '  async capturePayment(')},
      {id:'operations',title:'Keep logical capture identity in a PostgreSQL operation record',layer:'CaptureProof persistence adapter',relationship:'Additional table and adapter, not an upstream schema migration.',
        change:'Persist reservation, binding and capture identity across worker restart. The logical request ID is independent of a tentative Medusa capture-row ID.',verified:'Candidate uses one capture POST and one provider capture across three checkpoints. Stable repeated completion is observed; concurrency is not tested.',evidenceRefs:after.checkpoints.map(c=>evidence(after,c)),before:null,after:excerpt(base+'operations.cjs','module.exports')},
      {id:'host',title:'Install the exact host integration hook',layer:'Pinned Medusa host extension',relationship:'Wraps capturePayment_ through the harness; not included by installing the upstream plugin alone.',
        change:'Reuses one correctly bound tentative full-capture row when present, while leaving the provider completion gate in place. Normal compensation may delete a tentative row before a later valid row is created.',verified:'This pending-restart trace observes active rows 0 → 1 → 1. Reservation-crash row reuse is a separate historical experiment, not a new claim from this comparison.',evidenceRefs:after.checkpoints.map(c=>evidence(after,c)),before:null,after:excerpt(base+'capture-recovery.cjs','function installCaptureRecovery(', 'module.exports')},
      {id:'replay',title:'Retain bounded replay eligibility',layer:'CaptureProof application policy',relationship:'Revision 3 helper and policy dependency; simulator retention is not live PayPal verification.',
        change:'Require a valid immutable reservation timestamp, consistent update time, bound retention policy and an age strictly below the one-hour application window.',verified:'Included in the executed candidate. This pending-restart case recovers by read-back; it does not exercise replay expiry or every timing branch.',evidenceRefs:[evidence(after,last)],before:null,after:excerpt(base+'capture-recovery-v3.cjs','function canReplay(', 'module.exports')},
      {id:'wiring',title:'Register the provider, operation store and host hook together',layer:'CaptureProof local harness integration',relationship:'The export includes the original wiring for review, not production deployment configuration.',
        change:'The worker supplies the PostgreSQL adapter, constructs the revision-3 subclass with simulator policy, registers it with Medusa, and installs the host hook. The simulator transport and crash barriers belong only to the test harness.',verified:'Executed with actual Medusa/PostgreSQL and isolated simulated provider transport. No live provider credentials or production deployment were used.',evidenceRefs:[evidence(after,last)],before:null,after:excerpt(wiring,'  const Provider =','  async function freshRead(')}
    ];
    const selectedPaths=[...Object.keys(revisions).map(n=>base+n),wiring,'scripts/external-provider-model.cjs','src/external-persistence.mjs','src/crash-evidence.mjs',base+'provenance.json',base+'package-lock.json',base+'rules.json',base+'repair-scenarios.json'];
    const fileManifest=selectedPaths.map(path=>{const f=load(path);return {path,sha256:f.sha256,role:path===base+'target-service.cjs'?'unchanged upstream':path.startsWith('scripts/')||path.startsWith('src/')?'local harness reference':path.endsWith('.json')?'pinned prerequisite or contract':'authored integration candidate'};});
    return {availability:'AVAILABLE',version:'repair-review-1',kind:'INTEGRATION_SPECIFIC_CANDIDATE',attribution:'Deterministic evidence summary and developer-authored engineering review. Not AI-generated code or an automatically verified repair.',
      jobId:job.id,scenario:campaign?caseId:job.plan.scenario,executionStatus:job.state,
      target:{...provenance.plugin,medusa:provenance.medusa,versions:provenance.versions},
      executions:entries.map(e=>({runId:e.runId,implementation:e.implementation,artifact:e.artifact,sha256:e.sha256})),
      finding:{title:'Provider pending. Merchant already paid.',explanation:'The upstream capture method returned while the provider capture was PENDING. Medusa committed paid state. Revision 3 rejects that incomplete capture and later converges after completed read-back.',rule:failed.id,evidenceRefs:failed.evidenceRefs,baseline:evidence(before,first),candidate:evidence(after,initial),recovered:evidence(after,last)},
      components,fileManifest,
      integrationRequirements:['Use the pinned provider base and SDK types with the authored subclass; register it with the pinned Medusa payment module.','Provide the operations adapter and its captureproof_operation table with durable PostgreSQL commits. This is a harness setup, not a reviewed production migration.','Install installCaptureRecovery on the pinned host service; subclassing the plugin alone does not install that hook.','Provide a bound merchant context and explicit replay policy. The harness uses simulated one-hour retention; do not copy that assumption into a live integration.','Keep local simulator, placeholder credentials, crash barriers and schema creation confined to disposable test execution. Review production logging and migration separately.'],
      reproduction:{command:campaign?'npm run verify -- run builtin-v3':'npm run start:verification',url:'/external',target:campaign?'builtin-v3':job.plan.target,scenario:job.plan.scenario,action:campaign?'This explicit command launches the full four-case campaign (8 new executions), not a single artifact replay. Use the portable report reproducer for the selected failure only.':'Select the target and scenario, then explicitly click Run local verification. Opening this saved review does not execute it.',prerequisites:['CaptureProof workspace with Node 24+ on macOS and sandbox-exec.','Existing pinned dependencies in external/medusa-persistence/node_modules, including Medusa 2.7.0, SDK 1.0.0 and embedded PostgreSQL.','Permission to launch isolated local PostgreSQL; no application credentials required.'],expected:['Upstream: PENDING provider capture with paid merchant state fails PENDING_NOT_COMPLETED.','Candidate: unpaid with zero active rows at pending; after settle/restart, one completed provider capture and one stable active row.','Count capture POSTs, accepted operations, provider captures and DB rows separately.'],timing:'A fresh run is explicit and timed when it executes; the saved comparison is not a live demonstration.'},
      limits:['Integration-specific candidate, not a standalone upstream patch or a production-ready migration.','The whole candidate was compared; this is not an ablation test proving which individual component caused every improvement.','Real Medusa/PostgreSQL; simulated PayPal. No new live-provider, fulfillment, concurrency or real-network-outage verification.','No matching AI analysis for this job. Historical partial/rejected AI examples retain different evidence identities and review restrictions.']};
  } catch { return unavailable('Required executed source identity, frozen content or review anchors could not be verified. No repair bundle is offered.'); }
}

export function repairReviewBundle(review, readFile) {
  if(review.availability!=='AVAILABLE') return null;
  const files=review.fileManifest.map(f=>{const content=readFile(f.path);if(sha(content)!==f.sha256)throw Error('REPAIR_EXPORT_SOURCE_MISMATCH');return {...f,content};});
  return {...review,format:'captureproof-repair-review-bundle-1',portablePatch:false,files};
}
