import { assessPersistence } from './external-persistence.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { canonicalMoney } from './diagnosis-money.mjs';
import { crashProgress } from './crash-evidence.mjs';
import capturePolicy from '../external/medusa-persistence/capture-contract.cjs';
import { usdMinor } from './checkout-contract.mjs';

// An explicit read-only catalog. No runner, provider, database or diagnosis dependency.
export const EXTERNAL_REPORT_ID = '23f07c13-1ef6-456b-a1df-3497d070bdd6';
export const CRASH_REPORT_ID = 'da3bbb86-3647-49d3-973d-efc3eacbb4be';
export const REPORT_CATALOG = Object.freeze([{ id: EXTERNAL_REPORT_ID, label: 'Historical · 15-scenario comparison' }, { id: CRASH_REPORT_ID, label: 'Recorded · Reservation crash recovery' }]);
const root = new URL(`../data/external-executions/${EXTERNAL_REPORT_ID}/`, import.meta.url);
const statuses = ['PASS', 'FAIL', 'INCONCLUSIVE'];
const variants = ['original', 'candidate'];
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const hash = x => createHash('sha256').update(x).digest('hex');
const str = x => typeof x === 'string' ? x : null;
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, ['string', 'number', 'boolean'].includes(typeof o?.[k]) ? o[k] : null]));
const requireEvidence = (ok, code) => { if (!ok) throw new Error(code); };
const aggregate = checkpoints => checkpoints.some(c => c.verdict.status === 'FAIL') ? 'FAIL' : checkpoints.some(c => c.verdict.status === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
const money = (major, currency) => canonicalMoney(usdMinor(String(major)), currency)?.display ?? 'Unavailable / invalid money';
const uncertaintyNeeds = new Map([
  ['Read-back and the completion boundary must be observed.', 'A successful order read-back and an observed completed method boundary.'],
  ['Provider read-back conflicts with the independently retained scenario state.', 'Coherent order read-back matching retained provider identity, capture, amount and currency.'],
  ['Capture-detail evidence is unavailable or conflicts with order/binding evidence.', 'Capture detail agreeing with order, authorization, capture identity, amount, currency and status.'],
  ['The declared explicit-reconciliation window has not finished.', 'An explicit reconciliation boundary followed by independent provider and committed database observations.']
]);
export function uncertainty(verdict) {
  if (verdict.status !== 'INCONCLUSIVE') return null;
  return { reason: str(verdict.reason) || 'Reason not recorded.',
    needed: uncertaintyNeeds.get(verdict.reason) ?? 'Resolution requirements are not established by this record; inspect the missing or conflicting observations.' };
}
function snapshot(s) {
  requireEvidence(s?.rows && s.independentConnection === true && s.backend_pid && s.transaction_id, 'INCOMPLETE_DATABASE_EVIDENCE');
  for (const key of ['payment', 'payment_session', 'payment_collection', 'capture', 'captureproof_operation']) requireEvidence(Array.isArray(s.rows[key]), 'INCOMPLETE_DATABASE_EVIDENCE');
  requireEvidence(s.rows.payment.length === 1 && s.rows.payment_collection.length === 1 && s.rows.payment_session.length === 1, 'INCOMPLETE_DATABASE_EVIDENCE');
  const p = s.rows.payment[0], c = s.rows.payment_collection[0];
  requireEvidence(Object.hasOwn(p, 'captured_at') && typeof c.status === 'string', 'INCOMPLETE_DATABASE_EVIDENCE');
  requireEvidence([[p.amount,p.currency_code],[c.amount,c.currency_code],[c.captured_amount,c.currency_code]].every(([n,currency]) => canonicalMoney(usdMinor(String(n)), currency)), 'INVALID_DATABASE_MONEY');
  return { label: str(s.label), independentConnection: true, backendPid: s.backend_pid, transactionId: s.transaction_id,
    payment: { ...pick(p, ['id', 'captured_at', 'payment_collection_id', 'payment_session_id']), amount: money(p.amount, p.currency_code),
      storedProviderOrderId: str(p.data?.paypalOrderId), storedCaptures: (p.data?.paypalOrder?.purchaseUnits?.[0]?.payments?.captures ?? []).map(x => ({ id: str(x.id), status: str(x.status), amount: money(x.amount?.value, x.amount?.currencyCode) })) },
    collection: { ...pick(c, ['id', 'status', 'completed_at']), amount: money(c.amount, c.currency_code), capturedAmount: money(c.captured_amount, c.currency_code) },
    captures: s.rows.capture.filter(x => !x.deleted_at).map(x => ({ ...pick(x, ['id', 'payment_id']), amount: money(x.amount, p.currency_code) })),
    operations: s.rows.captureproof_operation.map(x => ({ ...pick(x, ['id', 'state', 'capture_id', 'created_at', 'updated_at']) })) };
}
function resource(x) {
  return x ? { ...pick(x, ['id', 'status']), amount: money(x.amount?.value, x.amount?.currency_code),
    related: pick(x.supplementary_data?.related_ids, ['order_id', 'authorization_id']) } : null;
}
function event(e) {
  // Deliberately excludes bodies, arbitrary input/output, SQL, headers and credentials.
  return { ...pick(e, ['id', 'ordinal', 'at', 'actor', 'kind', 'workerPid']),
    action: str(e.action), method: str(e.method), path: str(e.path), status: typeof e.status === 'number' ? e.status : null,
    requestId: str(e.requestId), label: str(e.label), outcome: str(e.result?.kind), providerCommitted: e.providerCommitted === true };
}
function semanticSteps(def) {
  const steps = [];
  def.phases.forEach((phase, p) => {
    let actions = [];
    phase.forEach((action, i) => {
      actions.push(action);
      if (['capture', 'observe'].includes(action)) {
        steps.push({ key: `${p + 1}.${i + 1}`, phase: p + 1, actions, action }); actions = [];
      }
    });
  });
  return steps;
}
function execution(r, row, def, reference) {
  requireEvidence(uuid.test(r.runId) && row.artifact === `${r.runId}.json` && r.implementation === row.implementation && r.mode === def.mode, 'EXECUTION_IDENTITY_MISMATCH');
  requireEvidence(r.evidenceMode === 'SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES' &&
    equal(r.provenance?.plugin, reference.original), 'INCOMPATIBLE_PROVENANCE');
  requireEvidence(Object.entries(reference.fileHashes).filter(([k]) => !k.endsWith('repair-scenarios.json')).every(([k,v]) => r.hashes?.[k] === v), 'INCOMPATIBLE_SOURCE_HASHES');
  requireEvidence(equal(r.scenario, { phases: def.phases, lostResponse: def.lostResponse === true, openCheckpoints: def.openCheckpoints ?? [] }), 'INCOMPATIBLE_SCENARIO');
  requireEvidence(canonicalMoney(r.contract?.amountMinor, r.contract?.currency), 'INVALID_MONEY_CONTRACT');
  requireEvidence(r.rules?.version && Array.isArray(r.rules.rules) && Array.isArray(r.events), 'MISSING_RULES_OR_EVENTS');
  const steps = semanticSteps(def);
  requireEvidence(Array.isArray(r.checkpoints) && r.checkpoints.length === steps.length && steps.length, 'INCOMPLETE_CHECKPOINTS');
  requireEvidence(Array.isArray(r.workerPids) && r.workerPids.length === def.phases.length, 'INCOMPLETE_PROCESS_EVIDENCE');
  requireEvidence(new Set(r.workerPids).size === r.workerPids.length, 'INCOMPLETE_PROCESS_EVIDENCE');
  const checkpoints = r.checkpoints.map((c, i) => {
    requireEvidence(c.runId === r.runId && c.action === steps[i].action && statuses.includes(c.verdict?.status) && Array.isArray(c.verdict.rules) && Array.isArray(c.events) && c.events.length, 'MALFORMED_CHECKPOINT');
    requireEvidence(c.providerCounters && ['capturePostAttempts', 'distinctCaptures'].every(k => Number.isSafeInteger(c.providerCounters[k]) && c.providerCounters[k] >= 0), 'MISSING_PROVIDER_COUNTERS');
    requireEvidence(equal(c.contract, r.contract) && equal(c.ids, r.ids), 'CHECKPOINT_BINDING_MISMATCH');
    const refs = new Set(r.events.map(e => e.id));
    requireEvidence(c.verdict.rules.every(rule => typeof rule.id === 'string' && statuses.includes(rule.status) && Array.isArray(rule.evidenceRefs) && rule.evidenceRefs.every(id => refs.has(id))), 'MISSING_RULE_REFERENCES');
    const reads = c.events.filter(e => e.actor === 'auditor' && e.kind === 'provider_response');
    const order = reads.findLast(e => e.path === `/v2/checkout/orders/${c.ids.order}`);
    const detail = reads.findLast(e => e.path === `/v2/payments/captures/${c.ids.capture}`);
    if (c.verdict.status !== 'INCONCLUSIVE') requireEvidence(order?.status === 200 && order.body?.id && c.auditorNonMutation === true, 'INCOMPLETE_AUDIT_EVIDENCE');
    const unit = order?.status === 200 ? order.body?.purchase_units?.[0] : null;
    return { index: i + 1, semantic: steps[i], workerPid: r.workerPids[steps[i].phase - 1],
      at: c.events.at(-1).at, verdict: { status: c.verdict.status, reason: str(c.verdict.reason), eventualCompletion: str(c.verdict.eventualCompletion),
        rules: c.verdict.rules.map(rule => ({ ...pick(rule, ['id', 'status', 'reason']), evidenceRefs: rule.evidenceRefs.map(str) })) },
      uncertainty: uncertainty(c.verdict), completionWindowOpen: c.completionWindowOpen === true,
      outcome: str(c.returned?.kind), error: str(c.returned?.message), auditorNonMutation: c.auditorNonMutation === true,
      provider: { orderRead: { ref: order?.id ?? null, httpStatus: order?.status ?? null, id: str(order?.body?.id), status: str(order?.body?.status) },
        authorization: resource(unit?.payments?.authorizations?.[0]), orderCaptures: (unit?.payments?.captures ?? []).map(resource),
        detailRead: { ref: detail?.id ?? null, httpStatus: detail?.status ?? null, capture: detail?.status === 200 ? resource(detail.body) : null },
        retainedSimulatorCapture: resource(c.providerFinal?.capture) },
      counters: { posts: c.providerCounters.capturePostAttempts, providerCaptures: c.providerCounters.distinctCaptures },
      before: snapshot(c.before), after: snapshot(c.after), afterShutdown: snapshot(c.afterShutdown), events: c.events.map(event) };
  });
  requireEvidence(statuses.includes(r.comparisonStatus) && r.comparisonStatus === row.status && aggregate(r.checkpoints) === r.comparisonStatus && equal(r.verdict, r.checkpoints.at(-1).verdict), 'VERDICT_HISTORY_MISMATCH');
  requireEvidence(row.checkpoints?.length === checkpoints.length && row.checkpoints.every((c,i) => c.verdict === checkpoints[i].verdict.status && c.posts === checkpoints[i].counters.posts && c.providerCaptures === checkpoints[i].counters.providerCaptures && c.dbCaptures === checkpoints[i].afterShutdown.captures.length), 'SUMMARY_CHECKPOINT_MISMATCH');
  return { availability: 'AVAILABLE', id: r.runId, artifact: row.artifact, implementation: row.implementation, recordedVerdict: r.comparisonStatus,
    startedAt: str(r.startedAt), finishedAt: str(r.finishedAt), ids: pick(r.ids, ['order', 'authorization', 'capture', 'payment', 'session', 'collection']),
    money: canonicalMoney(r.contract.amountMinor, r.contract.currency), checkpoints, events: r.events.map(event),
    runtime: { medusa: str(r.provenance.medusa?.tag), postgresPackage: str(r.provenance.versions?.['@embedded-postgres/darwin-arm64']) },
    pairingKey: hash(JSON.stringify({ scenario: r.scenario, mode: r.mode, money: [r.contract.amountMinor, r.contract.currency], rules: r.rules, provenance: r.provenance, hashes: r.hashes })) };
}
export function projectExternalReport(summary, read, reference) {
  requireEvidence(summary?.manifest?.version === 'pending-repair-1' && Array.isArray(summary.manifest.scenarios) && Array.isArray(summary.results), 'UNSUPPORTED_MANIFEST');
  const definitions = summary.manifest.scenarios;
  requireEvidence(definitions.length && new Set(definitions.map(x => x.name)).size === definitions.length && definitions.every(d => /^[a-z0-9-]+$/.test(d.name) && Array.isArray(d.phases) && d.phases.every(p => Array.isArray(p) && p.every(a => typeof a === 'string'))), 'MALFORMED_MANIFEST');
  const issues = [];
  const cases = definitions.map(def => {
    const result = { scenario: def.name, mode: def.mode, negativeEvidence: def.negativeEvidence === true, steps: semanticSteps(def) };
    for (const implementation of variants) {
      const rows = summary.results.filter(x => x.scenario === def.name && x.implementation === implementation);
      try {
        requireEvidence(rows.length === 1, rows.length ? 'DUPLICATE_EXECUTION' : 'MISSING_EXECUTION');
        requireEvidence(/^[0-9a-f-]{36}\.json$/.test(rows[0].artifact) && uuid.test(rows[0].artifact.slice(0, -5)), 'INVALID_ARTIFACT_REFERENCE');
        result[implementation] = execution(read(rows[0].artifact), rows[0], def, reference);
      } catch (e) {
        // Never leak filesystem paths or raw JSON parser errors.
        const code = /^[A-Z_]+$/.test(e.message) ? e.message : 'MISSING_OR_MALFORMED_ARTIFACT';
        result[implementation] = { availability: 'UNAVAILABLE', recordedVerdict: statuses.includes(rows[0]?.status) ? rows[0].status : null, issue: code, checkpoints: [] };
        issues.push(`${def.name} / ${implementation}: ${code}`);
      }
    }
    result.paired = variants.every(v => result[v].availability === 'AVAILABLE') && result.original.pairingKey === result.candidate.pairingKey;
    if (!result.paired) issues.push(`${def.name}: UNMATCHED_OR_INCOMPATIBLE_PAIR`);
    return result;
  });
  const extras = summary.results.filter(r => !definitions.some(d => d.name === r.scenario) || !variants.includes(r.implementation));
  if (extras.length) issues.push(`${extras.length} unclassified manifest entries excluded from supported pairs and verdict counts.`);
  const counts = Object.fromEntries(variants.map(v => [v, { executions: cases.length, available: cases.filter(c => c[v].availability === 'AVAILABLE').length,
    ...Object.fromEntries([...statuses, 'UNAVAILABLE'].map(s => [s, cases.filter(c => s === 'UNAVAILABLE' ? c[v].availability !== 'AVAILABLE' : c[v].availability === 'AVAILABLE' && c[v].recordedVerdict === s).length])),
    checkpoints: cases.reduce((n,c) => n + c[v].checkpoints.length,0), inconclusiveCheckpoints: cases.reduce((n,c) => n + c[v].checkpoints.filter(p => p.verdict.status === 'INCONCLUSIVE').length,0) }]));
  const patterns = new Map();
  for (const c of cases) for (const v of variants) for (const cp of c[v].checkpoints) {
    const failures = cp.verdict.rules.filter(r => r.status === 'FAIL');
    if (cp.verdict.status === 'FAIL' && !failures.length) failures.push({ id: 'UNCLASSIFIED' });
    for (const rule of failures) {
      if (!patterns.has(rule.id)) patterns.set(rule.id, { id: rule.id, observations: [] });
      patterns.get(rule.id).observations.push({ scenario: c.scenario, implementation: v, runId: c[v].id, checkpoint: cp.index, evidenceRefs: rule.evidenceRefs ?? [] });
    }
  }
  for (const p of patterns.values()) { p.executions = new Set(p.observations.map(o => o.runId)).size; p.checkpoints = p.observations.length; }
  return { id: EXTERNAL_REPORT_ID, availability: issues.length ? 'PARTIAL' : 'AVAILABLE', issues,
    provenanceLabel: 'Recorded execution · Real Medusa + PostgreSQL · Simulated PayPal',
    scope: str(reference.scope), target: pick(reference.original, ['name', 'version', 'revision']),
    candidate: { version: reference.version, authorship: str(reference.authorship), sha256: reference.fileHashes['external/medusa-persistence/candidate.cjs'] },
    runtime: cases.flatMap(c => variants.map(v => c[v])).find(r => r.availability === 'AVAILABLE')?.runtime ?? null,
    units: { verdicts: 'scenario-executions', pairs: 'compatible scenario pairs', checkpoints: 'method / observation boundaries' },
    counts, scenarioCount: cases.length, executionCount: summary.results.length, compatiblePairs: cases.filter(c => c.paired).length,
    unclassifiedEntries: extras.length, cases, patterns: [...patterns.values()],
    limitations: ['PayPal responses are simulated. This external candidate has no live Sandbox verification.', 'Fulfillment and entitlements were not exercised.',
      'Concurrency and abrupt mid-instruction crashes remain unverified.', 'Reservation before transmission is a potential liveness gap, not an observed duplicate charge. A reservation does not prove a request was sent.'],
    recommendations: {
      PENDING_NOT_COMPLETED: { implemented: 'Reject unresolved capture before Medusa commits completed bookkeeping; require bound COMPLETED evidence.', verified: 'Inspect PENDING checkpoints and independent DB reads; inspect later explicit recovery separately.', unverified: 'Live-provider timing, fulfillment and concurrency.', source: 'candidate.cjs:77–88' },
      EXACT_BINDING: { implemented: 'Validate order, authorization, capture, exact amount and currency; persist coherent completed read-back.', verified: 'Negative evidence windows remain unknown; restored evidence is checked at a later boundary.', unverified: 'Real-provider consistency delays and legacy records without binding.', source: 'candidate.cjs:29–38,77–88' },
      COMPLETED_CAPTURE_RECORDED: { implemented: 'Reconcile the same provider capture through the normal Medusa capture entry point, using the durable operation identity.', verified: 'Explicit recovery and repeated calls are visible only in their recorded sequences.', unverified: 'Crash after reservation before transmission; no automatic safe retry is established.', source: 'candidate.cjs:39–88; operations.cjs' }
    } };
}
export function availableReportCatalog(){return REPORT_CATALOG.filter(r=>existsSync(new URL(`../data/external-executions/${r.id}/summary.json`,import.meta.url)));}
export function loadExternalReport(id = EXTERNAL_REPORT_ID) {
  if (!REPORT_CATALOG.some(x => x.id === id)) return null;
  if (id === CRASH_REPORT_ID) return loadCrashReport();
  try {
    const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
    const reference = read('sources/repair-reference.json');
    const source = readFileSync(new URL('sources/candidate.cjs', root), 'utf8');
    requireEvidence(hash(source) === reference.fileHashes?.['external/medusa-persistence/candidate.cjs'], 'CANDIDATE_SOURCE_HASH_MISMATCH');
    const report = projectExternalReport(read('summary.json'), read, reference);
    report.source = { reference: 'sources/candidate.cjs', sha256: hash(source), lines: source.split('\n').map((text, i) => ({ number: i + 1, text })) };
    return report;
  } catch (e) {
    return { id, availability: 'UNAVAILABLE', issues: [/^[A-Z_]+$/.test(e.message) ? e.message : 'MISSING_OR_MALFORMED_REPORT'], cases: [] };
  }
}


function loadCrashReport() {
  const base = new URL(`../data/external-executions/${CRASH_REPORT_ID}/`, import.meta.url);
  const read = name => readFileSync(new URL(name, base), 'utf8');
  try {
    const summary=JSON.parse(read('summary.json'));
    requireEvidence(summary.version==='reservation-crash-1' && summary.executions.length===6, 'UNSUPPORTED_CRASH_REPORT');
    const names=['prior','repaired','accepted','completed','pending','invalid'];
    const executions=summary.executions.map((entry,index)=>{
      requireEvidence(entry.name===names[index] && entry.artifact===`${names[index]}.json`, 'INVALID_CRASH_REFERENCE');
      const raw=read(entry.artifact);requireEvidence(hash(raw)===entry.sha256, 'CRASH_ARTIFACT_HASH_MISMATCH');
      const r=JSON.parse(raw);requireEvidence(r.runId===entry.runId && r.implementation===entry.implementation && r.comparisonStatus===entry.recordedVerdict && aggregate(r.checkpoints)===entry.recordedVerdict, 'CRASH_VERDICT_MISMATCH');
      const sourceDirectory=entry.sourceDirectory??(entry.name==='prior'?'sources-prior':'sources');
      requireEvidence(['sources','sources-prior'].includes(sourceDirectory),'INVALID_SOURCE_REFERENCE');
      const sourceFiles=['candidate.cjs','operations.cjs','external-persistence-worker.cjs','external-provider-model.cjs','external-persistence.mjs',...(r.implementation==='candidate-v2'?['candidate-v2.cjs','capture-recovery.cjs']:[])];
      const sourceReferences=sourceFiles.map(file=>{const key=Object.keys(r.hashes).find(k=>k.endsWith('/'+file));requireEvidence(key && hash(read(`${sourceDirectory}/${file}`))===r.hashes[key], 'CRASH_SOURCE_HASH_MISMATCH');return {file:`${sourceDirectory}/${file}`,sha256:r.hashes[key]};});
      const points=[];
      if(r.crash){
        requireEvidence(r.crash.signal==='SIGKILL' && r.workerPids.length===2 && r.workerPids[0]!==r.workerPids[1], 'CRASH_RESTART_NOT_ESTABLISHED');
        const p=r.crash.afterTermination.provider;
        points.push({label:'After SIGKILL · controller observation',boundary:'UNFINISHED',posts:p.capturePostAttempts,accepted:p.acceptedOperations??null,distinctCaptures:p.capture?1:0,captureId:p.capture?.id??null,captureStatus:p.capture?.status??null,database:snapshot(r.crash.afterTermination.database),workerPid:r.workerPids[0],reason:'No handler completion boundary. Controller knows transport counts; the application receives no definitely-unsent flag.'});
        const restart=r.events.find(e=>e.kind==='fresh_database_read' && e.label==='worker_restart_initial');
        requireEvidence(restart,'RESTART_SNAPSHOT_MISSING');
        points.push({label:'Restart · before explicit recovery',boundary:'UNFINISHED',posts:null,accepted:null,distinctCaptures:null,captureId:null,captureStatus:null,database:snapshot(restart),workerPid:r.workerPids[1],reason:'Fresh worker reads normal persisted payment/operation state. Provider counts were not collected at this boundary; earlier controller counts are not a new restart observation.'});
      }
      for(const [i,c] of r.checkpoints.entries()){
        const p=c.providerFinal.capture;
        points.push({label:`Explicit call / observation ${i+1}`,boundary:c.verdict.status,posts:c.providerCounters.capturePostAttempts,accepted:c.providerCounters.acceptedOperations??null,distinctCaptures:c.providerCounters.distinctCaptures,captureId:p?.id??null,captureStatus:p?.status??null,database:snapshot(c.afterShutdown),workerPid:c.events[0].workerPid,
          outcome:str(c.returned.kind),error:str(c.returned.message),reason:str(c.verdict.reason),rules:c.verdict.rules.map(x=>({...pick(x,['id','status','reason']),evidenceRefs:x.evidenceRefs.map(str)})),auditorNonMutation:c.auditorNonMutation===true,
          providerObservations:c.events.filter(e=>e.actor==='auditor'&&e.kind==='provider_response').map(e=>({ref:e.id,httpStatus:e.status,path:e.path,orderId:str(e.body?.id),orderCaptures:(e.body?.purchase_units?.[0]?.payments?.captures??[]).map(resource),capture:e.path.includes('/payments/captures/')?resource(e.body):null}))});
      }
      requireEvidence(equal(crashProgress(r),entry.progress),'CRASH_PROGRESS_MISMATCH');
      return {name:entry.name,label:str(entry.label),runId:r.runId,implementation:r.implementation,recordedVerdict:r.comparisonStatus,progress:crashProgress(r),fault:r.crash?.location??null,
        startedAt:r.startedAt,finishedAt:r.finishedAt,money:canonicalMoney(r.contract.amountMinor,r.contract.currency),points,sourceReferences,events:r.events.map(event),
        operationIds:[...new Set(points.flatMap(p=>p.database.operations.map(o=>o.id)))],providerCaptureIds:[...new Set(points.map(p=>p.captureId).filter(Boolean))]};
    });
    return {id:CRASH_REPORT_ID,kind:'reservation-crash',availability:'AVAILABLE',issues:[],executions,
      provenanceLabel:'Recorded execution · Real Medusa + PostgreSQL · Simulated PayPal',
      retentionContext:{...capturePolicy.captureContract,experiment:{implementation:'candidate-v2',retentionMs:summary.policy.retentionMs,evidenceMode:'SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES',unchanged:true}},
      policy:pick(summary.policy,['scope','retentionMs','retry']),limitations:summary.limitations.map(str),
      target:{name:'@rsc-labs/medusa-paypal-payment',version:'0.0.2',revision:'0c4f91334409708e9b21b2ba44b824fc1a5dd0f3'},
      source:['candidate-v2.cjs','capture-recovery.cjs'].map(name=>({name,sha256:hash(read('sources/'+name)),text:read('sources/'+name)}))};
  }catch(e){return {id:CRASH_REPORT_ID,kind:'reservation-crash',availability:'UNAVAILABLE',issues:[/^[A-Z_]+$/.test(e.message)?e.message:'MISSING_OR_MALFORMED_CRASH_REPORT'],executions:[]};}
}

// Fresh jobs reuse the same allowlisted projections; no financial rules live in the UI.
export function projectVerificationExecution(r) {
  requireEvidence(uuid.test(r.runId) && r.evidenceMode==='SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES' && r.checkpoints?.length, 'INVALID_VERIFICATION_RESULT');
  requireEvidence(aggregate(r.checkpoints)===r.comparisonStatus,'VERDICT_HISTORY_MISMATCH');
  const checkpoints=r.checkpoints.map((c,i)=>({index:i+1,action:c.action,returned:pick(c.returned,['kind','message']),verdict:c.verdict,assessment:assessPersistence(c),
    counters:{posts:c.providerCounters?.capturePostAttempts,accepted:c.providerCounters?.acceptedOperations??null,providerCaptures:c.providerCounters?.distinctCaptures},
    afterShutdown:snapshot(c.afterShutdown),providerCapture:resource(c.providerFinal.capture),auditorNonMutation:c.auditorNonMutation===true,
    observations:c.events.filter(e=>e.kind==='provider_response').map(e=>({ref:e.id,actor:e.actor,path:e.path,httpStatus:e.status,capture:e.path.includes('/payments/captures/')?resource(e.body):null,orderCaptures:(e.body?.purchase_units?.[0]?.payments?.captures??[]).map(resource)}))}));
  return {runId:r.runId,implementation:r.implementation,startedAt:r.startedAt,finishedAt:r.finishedAt,verdict:r.comparisonStatus,progress:crashProgress(r),
    money:canonicalMoney(r.contract.amountMinor,r.contract.currency),sourceHashes:r.hashes,runtime:r.provenance.versions,
    crash:r.crash?{location:r.crash.location,signal:r.crash.signal,boundary:'UNFINISHED',database:snapshot(r.crash.afterTermination.database),controllerCounters:pick(r.crash.afterTermination.provider,['capturePostAttempts','acceptedOperations'])}:null,
    checkpoints,events:r.events.map(event)};
}
