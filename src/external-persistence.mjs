import { validateCandidate } from './local-candidate.mjs';
import { readFileSync, writeFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { usdMinor } from './checkout-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = join(root, 'external/medusa-persistence');
export const PERSISTENCE_RULES = JSON.parse(readFileSync(join(runtime, 'rules.json')));
const digest = x => createHash('sha256').update(x).digest('hex');
const env = { LANG: 'C', TZ: 'UTC' };
const q = JSON.stringify;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const PERSISTENCE_ASSESSMENT_VERSION = 'persistence-assessment-2';

export function evaluatePersistence(trace) {
  const rules = [];
  // Uncertainty cannot erase a violation already established by trusted observations.
  const inconclusive = reason => ({
    status: rules.some(rule => rule.status === 'FAIL') ? 'FAIL' : 'INCONCLUSIVE',
    reason: rules.some(rule => rule.status === 'FAIL')
      ? 'Confirmed payment-rule violation; unresolved evidence is reported separately.' : reason,
    rules, eventualCompletion: 'UNTESTED',
    ...(rules.length ? { uncertainty: { status: 'INCONCLUSIVE', reason } } : {})
  });
  if (!Array.isArray(trace?.events) || !trace.events.length || trace.events.some(e => !e || typeof e !== 'object') || !trace.contract || !trace.ids || !trace.isolation ||
      !['environmentScrubbed','fileReadBlocked','subprocessBlocked','networkBlocked'].every(k => trace.isolation[k] === true)) return inconclusive('Isolated observations and a money/identity contract are required.');
  if (!['order','authorization','capture','payment','session','collection'].every(k => typeof trace.ids[k] === 'string' && trace.ids[k]) ||
      !trace.events.some(e => e.kind === 'fresh_database_read' && e.id)) return inconclusive('Complete identities and database observation references are required.');
  const snapshots = [trace.before, trace.after, trace.afterShutdown];
  if (snapshots.some(x => !x?.independentConnection || !x.backend_pid || !x.transaction_id || !x.rows || ['payment','capture','payment_session','payment_collection'].some(t => !Array.isArray(x.rows[t])))) return inconclusive('Fresh independent committed database reads are required.');
  if (new Set(snapshots.map(x => x.backend_pid)).size !== 3 || JSON.stringify(trace.after.rows) !== JSON.stringify(trace.afterShutdown.rows)) return inconclusive('Independent post-operation reads must agree, including after ORM shutdown.');
  const rows = trace.afterShutdown.rows;
  if (rows.payment.length !== 1 || rows.payment_session.length !== 1 || rows.payment_collection.length !== 1) return inconclusive('A single complete payment/session/collection is required.');
  if (Object.values(rows).some(values => Array.isArray(values) && values.some(row => !row || typeof row !== 'object'))) return inconclusive('Database row observations are malformed.');
  const payment = rows.payment[0], session = rows.payment_session[0], collection = rows.payment_collection[0], captures = rows.capture.filter(c => !c.deleted_at);
  const responses = trace.events.filter(e => e.kind === 'provider_response');
  const captureResponse = responses.findLast(e => e.path?.endsWith('/capture'));
  const readBack = responses.findLast(e => e.path === `/v2/checkout/orders/${trace.ids.order}`);
  const boundary = trace.events.findLast(e => e.kind === 'capture_boundary_end');
  if (!readBack?.id || (captureResponse && !captureResponse.id) || readBack?.status !== 200 || !trace.providerFinal?.order || (captureResponse && !boundary)) return inconclusive('Read-back and the completion boundary must be observed.');
  if (JSON.stringify(readBack.body)!==JSON.stringify(trace.providerFinal.order)) return inconclusive('Provider read-back conflicts with the independently retained scenario state.');
  const providerCapture = trace.providerFinal.capture;
  const detail=responses.findLast(e=>e.path===`/v2/payments/captures/${trace.ids.capture}`);
  if(detail && (detail.status!==200 || detail.body?.id!==providerCapture?.id || detail.body?.status!==providerCapture?.status ||
      JSON.stringify(detail.body?.amount)!==JSON.stringify(providerCapture?.amount) || detail.body?.supplementary_data?.related_ids?.order_id!==trace.ids.order || detail.body?.supplementary_data?.related_ids?.authorization_id!==trace.ids.authorization)) return inconclusive('Capture-detail evidence is unavailable or conflicts with order/binding evidence.');
  if (captureResponse?.status === 201 && (!providerCapture || readBack.ordinal < captureResponse.ordinal || JSON.stringify(captureResponse.body) !== JSON.stringify(providerCapture) || JSON.stringify(readBack.body) !== JSON.stringify(trace.providerFinal.order))) return inconclusive('Capture response and subsequent read-back must agree.');
  const amount = trace.contract.amountMinor;
  if (!Number.isSafeInteger(amount) || amount <= 0 || trace.contract.currency !== 'USD') return inconclusive('Exact USD contract required.');
  const isAmount = value => usdMinor(String(value)) === amount;
  const order = trace.providerFinal.order, unit = order.purchase_units?.[0], auth = unit?.payments?.authorizations?.[0];
  if (!unit?.amount || !auth?.amount || !payment.data?.paypalOrder || (providerCapture && !providerCapture.amount)) return inconclusive('Order, authorization or money binding evidence is missing.');
  const check = (id, ok, reason) => rules.push({ id, status: ok ? 'PASS' : 'FAIL', reason, evidenceRefs: [trace.events.findLast(e => e.kind === 'fresh_database_read').id, captureResponse?.id ?? readBack.id] });
  const stored = payment.data.paypalOrder, storedUnit = stored.purchaseUnits?.[0];
  const present = value => value !== undefined && value !== null && value !== '';
  const moneyPresent = resource => present(resource?.value) && present(resource?.currency_code);
  if (![order.id, auth.id, stored.id, payment.data.paypalOrderId,
        storedUnit?.payments?.authorizations?.[0]?.id, storedUnit?.amount?.currencyCode,
        storedUnit?.amount?.value, ...['order', 'authorization', 'capture'].map(k => trace.contract.ids?.[k]),
        ...[payment, session, collection].flatMap(row => [row.id, row.amount, row.raw_amount?.value, row.currency_code]),
        payment.payment_session_id, payment.payment_collection_id, session.payment_collection_id,
        ...captures.flatMap(row => [row.payment_id, row.amount, row.raw_amount?.value])].every(present) ||
      !Object.hasOwn(payment, 'captured_at') || !Object.hasOwn(collection, 'completed_at') ||
      !present(collection.captured_amount) || !present(collection.status) ||
      !moneyPresent(unit.amount) || !moneyPresent(auth.amount) ||
      (providerCapture && (!present(providerCapture.id) || !moneyPresent(providerCapture.amount)))) {
    return inconclusive('Required identity or money observations are missing; absence is not a mismatch.');
  }
  check('EXACT_BINDING', ['order','authorization','capture'].every(k => trace.ids[k] === trace.contract.ids?.[k]) &&
    order.id === trace.ids.order && order.purchase_units.length === 1 && auth.id === trace.ids.authorization &&
    unit.amount.currency_code === 'USD' && isAmount(unit.amount.value) && auth.amount.currency_code === 'USD' && isAmount(auth.amount.value) &&
    payment.id === trace.ids.payment && session.id === trace.ids.session && collection.id === trace.ids.collection &&
    payment.payment_session_id === session.id && payment.payment_collection_id === collection.id && session.payment_collection_id === collection.id &&
    [payment,session,collection].every(x => x.currency_code === 'USD' && isAmount(x.amount) && isAmount(x.raw_amount?.value)) &&
    stored.id === order.id && payment.data.paypalOrderId === order.id && storedUnit?.payments?.authorizations?.[0]?.id === auth.id && storedUnit?.amount?.currencyCode === 'USD' && isAmount(storedUnit?.amount?.value) &&
    captures.every(c => c.payment_id === payment.id && isAmount(c.amount) && isAmount(c.raw_amount?.value)) &&
    (!providerCapture || (providerCapture.id === trace.ids.capture && providerCapture.amount.currency_code === 'USD' && isAmount(providerCapture.amount.value) && unit.payments.captures?.length === 1 && JSON.stringify(unit.payments.captures[0]) === JSON.stringify(providerCapture) &&
      (!(captures.length || payment.captured_at || collection.captured_amount!=='0') || (storedUnit?.payments?.captures?.length === 1 && storedUnit.payments.captures[0].id === providerCapture.id && storedUnit.payments.captures[0].status === providerCapture.status && storedUnit.payments.captures[0].amount?.currencyCode === 'USD' && isAmount(storedUnit.payments.captures[0].amount?.value))))),
    'Provider identities, exact money and persisted relationships are checked; Medusa values are major units.');
  const unresolved = captures.length === 0 && payment.captured_at === null && collection.completed_at === null && collection.captured_amount === '0' && collection.status === 'authorized';
  if (trace.completionWindowOpen && providerCapture?.status === 'COMPLETED' && unresolved) {
    return inconclusive('The declared explicit-reconciliation window has not finished.');
  }
  if (!providerCapture && !captureResponse && !trace.events.some(e => e.kind === 'capture_boundary_start')) check('AUTHORIZED_NOT_CAPTURED', unresolved, 'Authorization is distinct from captured payment.');
  else if (captureResponse?.status === 422 && !providerCapture && boundary?.result?.kind === 'rejected' && trace.returned?.kind === 'rejected') check('ERROR_NOT_CAPTURED', unresolved, 'Definitive provider rejection must not leave captured merchant state.');
  else if (providerCapture?.status === 'PENDING') check('PENDING_NOT_COMPLETED', unresolved, 'A PENDING resource cannot support completed merchant capture, even after the method resolves.');
  else if (providerCapture?.status === 'COMPLETED') check('COMPLETED_CAPTURE_RECORDED', captures.length === 1 && Boolean(payment.captured_at) && Boolean(collection.completed_at) && collection.status === 'completed' && isAmount(collection.captured_amount), 'Completed full capture must correspond to committed capture and collection totals.');
  else return inconclusive('Provider outcome is unresolved or unsupported by this contract.');
  return { status: rules.some(r => r.status === 'FAIL') ? 'FAIL' : 'PASS', rules, eventualCompletion: providerCapture?.status === 'PENDING' ? 'UNTESTED' : 'NOT_APPLICABLE', limitations: PERSISTENCE_RULES.limitations };
}

// Read-only reinterpretation is explicitly versioned and keeps the original result intact.
export function assessPersistence(trace) {
  const current = evaluatePersistence(trace);
  return { version: PERSISTENCE_ASSESSMENT_VERSION, recorded: trace.verdict ?? null,
    current, changed: JSON.stringify(current) !== JSON.stringify(trace.verdict ?? null),
    scope: 'Current evaluator applied to retained observations; not a new execution.' };
}

// Extends the existing fixed-target evidence path; never starts CaptureProof's
// server or loads its environment, payment records, or diagnosis pipeline.
export async function runExternalPersistence(mode, options={}) {
  if (!['authorized','completed','pending','error'].includes(mode)) throw new Error('INVALID_PERSISTENCE_CASE');
  const implementation=options.implementation??'original';
  if(!['original','candidate','candidate-v2','candidate-v3','supplied'].includes(implementation))throw new Error('INVALID_IMPLEMENTATION');
  if(options.crashBarrier && !['after-reservation','after-acceptance'].includes(options.crashBarrier))throw new Error('INVALID_CRASH_BARRIER');
  const supplied=implementation==='supplied'?validateCandidate(options.candidateBundle):null;
  const phases=options.phases??[[mode==='authorized'?'observe':'capture']];
  const allowed=['capture','observe','settle','lookup-unavailable','restore','hide-capture','reveal-capture','invalid-amount','invalid-currency','invalid-id','invalid-missing-amount','invalid-related-order'];
  if(!Array.isArray(phases)||!phases.length||phases.length>2||phases.some(p=>!Array.isArray(p)||!p.length||p.length>8||p.some(a=>!allowed.includes(a))||!p.some(a=>['capture','observe'].includes(a))))throw new Error('INVALID_PHASES');
  if(options.crashBarrier && (phases.length!==2 || implementation==='original'))throw new Error('CRASH_REQUIRES_CANDIDATE_AND_RESTART');
  if (process.platform !== 'darwin' || Number(process.versions.node.split('.')[0]) < 24) throw new Error('ISOLATION_REQUIRES_MACOS_NODE24');
  const provenance = JSON.parse(readFileSync(join(runtime,'provenance.json')));
  for(const [name,version] of Object.entries(provenance.versions))if(JSON.parse(readFileSync(join(runtime,'node_modules',name,'package.json'))).version!==version)throw new Error('PINNED_VERSION_MISMATCH');
  for(const [path,hash] of Object.entries(provenance.files))if(digest(readFileSync(join(runtime,path)))!==hash)throw new Error('PINNED_FILE_MISMATCH');
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'cp-medusa-')));
  const canary = realpathSync(mkdtempSync(join(tmpdir(), 'cp-canary-')));
  writeFileSync(join(canary, 'canary'), 'nonsecret isolation probe');
  const runId = randomUUID(), stem = runId.replaceAll('-', '').toUpperCase().slice(0,16);
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0,'127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const native = join(runtime, 'node_modules/@embedded-postgres/darwin-arm64/native');
  const base = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${q(workspace)}) (literal "/dev/null"))(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var") (subpath "/private/tmp"))(allow file-read* (subpath ${q(runtime)}) (subpath ${q(workspace)}) (literal ${q(realpathSync(process.execPath))}))(allow file-read-metadata)`;
  const dbProfile = base + `(allow network-bind (local ip "localhost:${port}"))(allow network-inbound (local ip "localhost:${port}"))`;
  const workerProfile = base + `(deny process-fork)(allow network-outbound (remote ip "localhost:${port}"))`;
  let postgres, pgLog = '';
  const startedAt = new Date().toISOString();
  try {
    const initialized = spawnSync('/usr/bin/sandbox-exec', ['-p', dbProfile, join(native, 'bin/initdb'), '-D', join(workspace,'db'), '-U','postgres','--auth=trust','--locale=C','--encoding=UTF8'], { env, encoding:'utf8', timeout:30000 });
    if (initialized.status !== 0) throw new Error((/sandbox_apply/.test(initialized.stderr??'')?'ISOLATION_UNAVAILABLE ':'POSTGRES_INIT_FAILED ') + (initialized.error?.code??'')+' '+(initialized.stderr??'').slice(-1500));
    postgres = spawn('/usr/bin/sandbox-exec', ['-p', dbProfile, join(native,'bin/postgres'), '-D', join(workspace,'db'), '-h','127.0.0.1','-p',String(port),'-k','', '-c','log_statement=all','-c','log_line_prefix=%m [%p] '], { env, stdio:['ignore','pipe','pipe'] });
    postgres.stdout.on('data', x => { pgLog += x; }); postgres.stderr.on('data', x => { pgLog += x; });
    let ready = false;
    for (let i=0;i<100;i++) {
      if (postgres.exitCode !== null) throw new Error('POSTGRES_START_FAILED ' + pgLog.slice(-1500));
      ready = await new Promise(resolve => { const s=createConnection({host:'127.0.0.1',port});s.on('connect',()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(false)); });
      if (ready) break; await sleep(50);
    }
    if (!ready) throw new Error('POSTGRES_NOT_READY');
    const config = { suppliedCandidate: supplied?{entry:supplied.entry,id:supplied.id,files:supplied.files.map(f=>({path:f.path,sha256:digest(f.content)}))}:null, runId, mode, implementation, crashExperiment:options.crashExperiment===true, openCheckpoints:options.openCheckpoints??[], lostResponse:options.lostResponse===true, runtime, port, providerStatePath:join(workspace,'provider-state.json'),targetPath: join(workspace,'target.cjs'), canaryPath:join(canary,'canary'), ids: { order:'O'+stem, authorization:'A'+stem, capture:'C'+stem } };
    if(supplied)for(const file of supplied.files)writeFileSync(join(workspace,file.path),file.content,{flag:'wx',mode:0o600});
    writeFileSync(join(workspace,'input.json'), JSON.stringify(config));
    writeFileSync(config.targetPath,readFileSync(join(runtime,'target-service.cjs')));
    writeFileSync(join(workspace,'worker.cjs'),readFileSync(join(root,'scripts/external-persistence-worker.cjs')));
    writeFileSync(join(workspace,'provider-model.cjs'),readFileSync(join(root,'scripts/external-provider-model.cjs')));
    const workers=[];let crash=null;
    for(const [phase,actions] of phases.entries()) {
    writeFileSync(join(workspace,'input.json'),JSON.stringify({...config,crashBarrier:phase===0?options.crashBarrier:undefined,resume:phase>0,actions,checkpointOffset:workers.reduce((n,w)=>n+w.checkpoints.length,0),ordinalOffset:workers.reduce((n,w)=>n+w.events.length,0)}));
    const execution = await new Promise(resolve => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p',workerProfile,realpathSync(process.execPath),'worker.cjs'], { cwd:workspace,env,stdio:['ignore','pipe','pipe'] });
      let out='',err='',barrierReached=false;const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
      child.stdout.on('data',x=>{out+=x;if(options.crashBarrier && phase===0 && out.includes('CRASH_BARRIER_READY\n')){barrierReached=true;child.kill('SIGKILL');}if(out.length>4e6)child.kill('SIGKILL');});child.stderr.on('data',x=>{err+=x;});
      child.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,out,err,barrierReached});});
    });
    if (execution.barrierReached && execution.signal === 'SIGKILL') {
      const barrier=JSON.parse(readFileSync(join(workspace,'crash-barrier.json')));
      const {Client}=createRequire(join(runtime,'package.json'))('pg');
      const db=new Client({connectionString:`postgres://postgres@127.0.0.1:${port}/postgres`});await db.connect();
      let database;
      try {
        const meta=(await db.query('SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id')).rows[0];
        const rows={};for(const table of ['payment_collection','payment_session','payment','capture','captureproof_operation'])rows[table]=(await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
        database={label:'controller_after_SIGKILL',independentConnection:true,...meta,rows};
      } finally {await db.end();}
      const provider=JSON.parse(readFileSync(config.providerStatePath));
      crash={...barrier,signal:execution.signal,afterTermination:{database,provider},controllerOnly:true};
      workers.push({workerPid:barrier.workerPid,events:barrier.events,checkpoints:[]});
      continue;
    }
    if(options.crashBarrier && phase===0)throw new Error('EXPECTED_CRASH_BARRIER_NOT_REACHED');
    if(execution.status!==0) throw new Error('PERSISTENCE_EXECUTION_BLOCKED '+execution.err.slice(-4500));
    const trace=JSON.parse(execution.out);
    if(trace.runId!==runId||trace.mode!==mode)throw new Error('EXECUTION_BINDING_MISMATCH');
    workers.push(trace);
    }
    const trace=workers.at(-1);
    await sleep(50);
    const result = { ...trace, assessmentVersion: PERSISTENCE_ASSESSMENT_VERSION, ...(crash?{crash}:{}), startedAt, finishedAt:new Date().toISOString(), evidenceMode:'SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES', provenance,
      contract: { amountMinor:1200, currency:'USD', medusaMajor:'12', paypalMajor:'12.00', ids:config.ids },
      rules:PERSISTENCE_RULES, transactionLog:pgLog.split('\n').filter(s=>/statement: (begin|commit|rollback)|(?:statement:|execute .*:) (?:insert into|update|delete from) "(?:public"\.")?(?:capture|payment|payment_collection)"/i.test(s)),
      scenario:{phases,lostResponse:config.lostResponse,openCheckpoints:config.openCheckpoints},databaseProcessId:postgres.pid,workerPids:workers.map(w=>w.workerPid),events:workers.flatMap(w=>w.events),
      hashes:Object.fromEntries([...(['candidate-v3','supplied'].includes(implementation)?['external/medusa-persistence/candidate-v3.cjs','external/medusa-persistence/capture-recovery-v3.cjs','external/medusa-persistence/capture-contract.cjs','external/medusa-persistence/capture-recovery.cjs']:[]),...(implementation==='candidate-v2'?['external/medusa-persistence/candidate-v2.cjs','external/medusa-persistence/capture-recovery.cjs']:[]),'external/medusa-persistence/target-service.cjs','external/medusa-persistence/package-lock.json','external/medusa-persistence/candidate.cjs','external/medusa-persistence/operations.cjs','scripts/external-provider-model.cjs','scripts/external-persistence-worker.cjs','src/external-persistence.mjs','src/local-candidate.mjs','external/medusa-persistence/rules.json'].map(p=>[p,digest(readFileSync(join(root,p)))])) };
    if(supplied){result.candidateIdentity={id:supplied.id,target:supplied.target,baseSha256:supplied.baseSha256};for(const f of supplied.files)result.hashes['supplied/'+f.path]=digest(f.content);}
    result.checkpoints=workers.flatMap(w=>w.checkpoints).map(c=>({...c,contract:result.contract,verdict:evaluatePersistence({...c,contract:result.contract})}));
    result.verdict = result.checkpoints.at(-1).verdict;
    result.comparisonStatus=result.checkpoints.some(c=>c.verdict.status==='FAIL')?'FAIL':result.checkpoints.some(c=>c.verdict.status==='INCONCLUSIVE')?'INCONCLUSIVE':'PASS';
    return result;
  } finally {
    if(postgres && postgres.exitCode===null){postgres.kill('SIGTERM');await new Promise(resolve=>postgres.once('close',resolve));}
    rmSync(workspace,{recursive:true,force:true});rmSync(canary,{recursive:true,force:true});
  }
}
