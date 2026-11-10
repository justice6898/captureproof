// Runs only inside the external runner's OS sandbox. No inherited credentials.
const fs = require('node:fs');
const { createRequire, Module } = require('node:module');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const config = JSON.parse(fs.readFileSync('input.json', 'utf8'));
delete process.env.__CF_USER_TEXT_ENCODING;
const runtimeRequire = createRequire(config.runtime + '/package.json');
const events = [];
const clone = x => JSON.parse(JSON.stringify(x));
let actor = 'merchant';
const record = (kind, fields = {}) => events.push({ id: `${config.runId}:${(config.ordinalOffset??0)+events.length + 1}`, ordinal: (config.ordinalOffset??0)+events.length + 1, workerPid:process.pid, actor, at: new Date().toISOString(), kind, ...clone(fields) });

async function main() {
  const isolation = { environmentScrubbed: Object.keys(process.env).every(k => ['LANG', 'TZ'].includes(k)), fileReadBlocked: false, subprocessBlocked: false, networkBlocked: false };
  try { fs.readFileSync(config.canaryPath); } catch (e) { isolation.fileReadBlocked = ['EPERM','EACCES'].includes(e.code); }
  const spawn = spawnSync('/usr/bin/true');
  isolation.subprocessBlocked = ['EPERM','EACCES'].includes(spawn.error?.code);
  isolation.networkBlocked = await new Promise(resolve => {
    const s = net.createConnection({ host: '127.0.0.1', port: 9 });
    s.on('connect', () => { s.destroy(); resolve(false); });
    s.on('error', e => resolve(['EPERM','EACCES'].includes(e.code)));
    s.setTimeout(500, () => { s.destroy(); resolve(false); });
  });
  if (!Object.values(isolation).every(Boolean)) throw new Error('ISOLATION_NOT_ESTABLISHED ' + JSON.stringify(isolation));
  record('isolation', isolation);
  const sdk = runtimeRequire('@paypal/paypal-server-sdk');
  const model = require('./provider-model.cjs')(config,record);
  const transport = async request => {
    const response = await model.transport(request);
    if (config.crashBarrier === 'after-acceptance' && request.method.toUpperCase() === 'POST' && new URL(request.url).pathname.endsWith('/capture') && response.status === 201) await crashBarrier('after-acceptance');
    return response;
  };
  const { Client: PgClient } = runtimeRequire('pg');
  const clientUrl = `postgres://postgres@127.0.0.1:${config.port}/postgres`;
  const operations = require(config.runtime+'/operations.cjs')(PgClient,clientUrl);
  const reserve = operations.reserve;
  operations.reserve = async (...args) => {
    const reserved = await reserve(...args);
    if (reserved && config.crashBarrier === 'after-reservation') await crashBarrier('after-reservation');
    return reserved;
  };
  async function crashBarrier(location) {
    const database = await freshRead('barrier_after_committed_reservation');
    record('crash_barrier', { location });
    const evidence = { location, workerPid: process.pid, database, provider: model.snapshot(), events: clone(events), isolation };
    fs.writeFileSync('crash-barrier.json', JSON.stringify(evidence));
    process.stdout.write('CRASH_BARRIER_READY\n');
    // The controller kills this process. No exception unwinds Medusa cleanup.
    await new Promise(() => {});
  }
  class LocalClient extends sdk.Client {
    constructor(options) {
      super({ ...options, logging: { logger: { log() {} } }, httpClientOptions: { retryConfig: { maxNumberOfRetries: 0 } }, unstable_httpClientOptions: { adapter: transport } });
    }
  }
  const target = new Module(config.targetPath);
  target.filename = config.targetPath;
  target.require = name => name === '@paypal/paypal-server-sdk' ? { ...sdk, Client: LocalClient } : runtimeRequire(name);
  target._compile(fs.readFileSync(config.targetPath, 'utf8'), config.targetPath);
  let suppliedFactory;
  if(config.suppliedCandidate){
    const crypto=require('node:crypto');
    for(const file of config.suppliedCandidate.files)if(crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex')!==file.sha256)throw Error('CANDIDATE_SOURCE_MISMATCH');
    suppliedFactory=require('./'+config.suppliedCandidate.entry);
    if(typeof suppliedFactory!=='function')throw Error('CANDIDATE_FACTORY_REQUIRED');
  }
  const Provider = suppliedFactory ? suppliedFactory(target.exports.default,sdk,operations,{retentionBasis:'simulator',providerRetentionMs:3600000,replayWindowMs:require(config.runtime+'/capture-contract.cjs').APPLICATION_REPLAY_WINDOW_MS,merchantContext:'offline-single-merchant'}) : config.implementation==='candidate-v3' ? require(config.runtime+'/candidate-v3.cjs')(target.exports.default,sdk,operations,{retentionBasis:'simulator',providerRetentionMs:3600000,replayWindowMs:require(config.runtime+'/capture-contract.cjs').APPLICATION_REPLAY_WINDOW_MS,merchantContext:'offline-single-merchant'}) : config.implementation==='candidate-v2' ? require(config.runtime+'/candidate-v2.cjs')(target.exports.default,sdk,operations,{retentionVerified:true,replayWindowMs:3600000}) : config.implementation==='candidate' ? require(config.runtime+'/candidate.cjs')(target.exports.default,sdk,operations) : target.exports.default;
  // Observe the unmodified function body without altering its inputs or returns.
  for (const method of ['initiatePayment', 'authorizePayment', 'capturePayment', 'retrievePayment']) {
    const original = Provider.prototype[method];
    Provider.prototype[method] = async function (...args) {
      record('target_call', { method, input: args[0] });
      try { const value = await original.apply(this, args); record('target_return', { method, value }); return value; }
      catch (e) { record('target_error', { method, message: e.message }); throw e; }
    };
  }
  const utils = runtimeRequire('@medusajs/framework/utils');
  const { ModulesDefinition } = runtimeRequire('@medusajs/framework/modules-sdk');
  const { MikroORM } = runtimeRequire('@mikro-orm/postgresql');
  const { initModules } = runtimeRequire(config.runtime + '/node_modules/@medusajs/test-utils/dist/init-modules.js');
  const paymentPath = config.runtime + '/node_modules/@medusajs/payment';
  const models = utils.toMikroOrmEntities(utils.loadModels(paymentPath + '/dist/models'));
  if(!config.resume) {
  const orm = await MikroORM.init({ clientUrl, entities: Object.values(models), schema: 'public', debug: false });
  await orm.schema.createSchema();
  await orm.close();
  }
  await operations.setup();
  const logger = Object.fromEntries(['info','warn','error','debug','log'].map(k => [k, () => {}]));
  const eventBus = { emit: async () => {}, subscribe() {}, unsubscribe() {} };
  const app = await initModules({ databaseConfig: { clientUrl, schema: 'public' }, modulesConfig: {
    link_modules: runtimeRequire('@medusajs/link-modules'),
    payment: { definition: ModulesDefinition.payment, resolve: paymentPath, dependencies: ['logger','event_bus'], options: { [utils.isSharedConnectionSymbol]: true, database: { clientUrl, schema: 'public' }, providers: [{ resolve: { services: [Provider] }, id: 'isolated', options: { oAuthClientId: 'local-placeholder', oAuthClientSecret: 'local-placeholder', environment: 'sandbox' } }] } }
  }, injectedDependencies: { logger, event_bus: eventBus } });
  const service = app.medusaApp.modules.payment;
  if(['candidate-v2','candidate-v3','supplied'].includes(config.implementation))require(config.runtime+'/capture-recovery.cjs').installCaptureRecovery(service,operations,utils.MathBN);
  async function freshRead(label) {
    const db = new PgClient({ connectionString: clientUrl });
    await db.connect();
    try {
      const meta = (await db.query('SELECT pg_backend_pid() AS backend_pid, txid_current()::text AS transaction_id')).rows[0];
      const rows = {};
      for (const table of ['payment_collection','payment_session','payment','capture','captureproof_operation']) rows[table] = (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
      const result = { label, independentConnection: true, ...meta, rows };
      record('fresh_database_read', result);
      return result;
    } finally { await db.end(); }
  }
  try {
    let ids;
    if(!config.resume) {
      const collection=await service.createPaymentCollections({amount:12,currency_code:'USD'});
      const session=await service.createPaymentSession(collection.id,{provider_id:`pp_${Provider.identifier}_isolated`,amount:12,currency_code:'USD',data:{},context:{}});
      model.action('authorize');
      const payment=await service.authorizePaymentSession(session.id,{});
      ids={...config.ids,collection:collection.id,session:session.id,payment:payment.id};
    } else {
      const persisted=await freshRead('worker_restart_initial');
      if(persisted.rows.payment.length!==1)throw new Error('RESTART_PAYMENT_MISSING');
      const payment=persisted.rows.payment[0];
      ids={...config.ids,collection:payment.payment_collection_id,session:payment.payment_session_id,payment:payment.id};
      record('worker_resumed',{ids,processId:process.pid,provider:model.snapshot()});
    }
    const auditClient=new LocalClient({environment:sdk.Environment.Sandbox,clientCredentialsAuthCredentials:{oAuthClientId:'local-placeholder',oAuthClientSecret:'local-placeholder'}});
    const checkpoints=[];
    for(const action of config.actions??[config.mode==='authorized'?'observe':'capture']) {
      if(!['capture','observe'].includes(action)){actor='scenario';model.action(action);actor='merchant';continue;}
      const start=events.length;
      const before=await freshRead('before_'+action);
      let returned={kind:'not_requested'};
      if(action==='capture'){
        record('capture_boundary_start',{paymentId:ids.payment});
        try{returned={kind:'resolved',value:await service.capturePayment({payment_id:ids.payment,amount:12})};}
        catch(e){returned={kind:'rejected',message:e.message};}
        record('capture_boundary_end',{result:returned});
      }
      // Auditor uses the same real SDK against the independent scenario state.
      // It never invokes a merchant payment method or modifies financial rows.
      actor='auditor';
      const auditBefore=await freshRead('before_audit');
      try {await new sdk.OrdersController(auditClient).getOrder({id:ids.order});}
      catch(e){record('audit_unavailable',{statusCode:e.statusCode??null});}
      const knownCapture=model.snapshot().capture;
      if(knownCapture) {
        try {await new sdk.PaymentsController(auditClient).getCapturedPayment({captureId:knownCapture.id});}
        catch(e){record('audit_unavailable',{resource:'capture',statusCode:e.statusCode??null});}
      }
      const after=await freshRead('after_'+action);
      const afterShutdown=await freshRead('independent_confirmation');
      if(JSON.stringify(auditBefore.rows)!==JSON.stringify(after.rows))throw new Error('AUDITOR_MUTATED_MERCHANT');
      record('observation_boundary_end',{action});actor='merchant';
      const state=model.snapshot();
      checkpoints.push({runId:config.runId,mode:config.mode,implementation:config.implementation??'original',action,completionWindowOpen:(config.openCheckpoints??[]).includes((config.checkpointOffset??0)+checkpoints.length),isolation,events:events.slice(start),ids,providerFinal:{order:state.order,capture:state.capture},providerCounters:{capturePostAttempts:state.capturePostAttempts,acceptedOperations:state.acceptedOperations,distinctCaptures:state.capture?1:0,requestIds:state.requestIds},returned,before,after,afterShutdown,auditorNonMutation:true});
    }
    await app.shutdown();
    const finalRead=await freshRead('after_orm_shutdown');
    const last=checkpoints.at(-1);
    if(last){last.afterShutdown=finalRead;last.events.push(events.at(-1));}
    return {...last,events,checkpoints,workerPid:process.pid,providerState:model.snapshot()};
  } catch (e) { await app.shutdown(); throw e; }
}
main().then(result => process.stdout.write(JSON.stringify(result))).catch(e => { process.stderr.write(`${e.stack}\n`); process.exit(1); });
