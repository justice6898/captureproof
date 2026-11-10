// Executed only in a disposable, credential-free, OS-network-denied subprocess.
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';

// macOS may inject this encoding hint after exec; remove it before target loading.
delete process.env.__CF_USER_TEXT_ENCODING;
const config = JSON.parse(readFileSync('input.json', 'utf8'));
// Fail closed before loading any external module. These probes use no real secrets/services.
const isolation = { environmentScrubbed: Object.keys(process.env).every(k => ['LANG', 'TZ'].includes(k)), fileReadBlocked: false, subprocessBlocked: false, networkBlocked: false };
try { readFileSync(config.canaryPath); } catch (e) { isolation.fileReadBlocked = e.code === 'ERR_ACCESS_DENIED' || e.code === 'EPERM'; }
try { spawnSync('/usr/bin/true'); } catch (e) { isolation.subprocessBlocked = e.code === 'ERR_ACCESS_DENIED' || e.code === 'EPERM'; }
isolation.networkBlocked = await new Promise(resolve => {
  const s = createConnection({ host: '127.0.0.1', port: 9 });
  s.on('connect', () => { s.destroy(); resolve(false); });
  s.on('error', e => resolve(['EPERM', 'EACCES'].includes(e.code)));
  s.setTimeout(500, () => { s.destroy(); resolve(false); });
});
if (!Object.values(isolation).every(Boolean)) throw new Error('ISOLATION_NOT_ESTABLISHED ' + JSON.stringify({ ...isolation, environmentNames: Object.keys(process.env) }));

const clone = value => structuredClone(value);
const events = [], actions = [];
let currentAction = -1, order = null, captures = [], readsFailed = false;
const record = (kind, data) => events.push({ id: `${config.runId}:${events.length + 1}`, ordinal: events.length + 1, at: new Date().toISOString(), actionIndex: currentAction, kind, ...clone(data) });
const ids = config.ids;
const money = () => ({ currencyCode: config.currency, value: config.major });
const snapshot = () => ({ order: clone(order), captures: clone(captures) });
const respond = (method, args, result) => { record('sdk_request', { method, args }); record('sdk_response', { method, result }); return { result: clone(result) }; };
class ApiError extends Error { constructor(code) { super(code); this.statusCode = 422; this.headers = {}; } }
class Client { constructor(options) { if (options.environment !== 'sandbox') throw new Error('SANDBOX_REQUIRED'); } }
class OrdersController {
  async createOrder(args) {
    if (order || args.body.intent !== 'AUTHORIZE') throw new Error('INVALID_CREATE');
    order = { id: ids.order, status: 'CREATED', intent: 'AUTHORIZE', purchaseUnits: clone(args.body.purchaseUnits) };
    return respond('createOrder', args, order);
  }
  async getOrder(args) {
    if (args.id !== order?.id) throw new Error('ORDER_ID_MISMATCH');
    if (config.providerMode === 'read-unavailable' && captures.length && !readsFailed) {
      readsFailed = true; record('sdk_request', { method: 'getOrder', args });
      record('sdk_error', { method: 'getOrder', code: 'SIMULATED_READ_UNAVAILABLE' });
      throw new ApiError('SIMULATED_READ_UNAVAILABLE');
    }
    return respond('getOrder', args, order);
  }
}
class PaymentsController {
  async captureAuthorizedPayment(args) {
    record('sdk_request', { method: 'captureAuthorizedPayment', args });
    if (args.authorizationId !== ids.authorization || !order?.purchaseUnits[0].payments?.authorizations?.length) throw new Error('AUTHORIZATION_ID_MISMATCH');
    if (captures.length) { record('sdk_error', { method: 'captureAuthorizedPayment', code: 'AUTHORIZATION_ALREADY_CAPTURED' }); throw new ApiError('AUTHORIZATION_ALREADY_CAPTURED'); }
    const capture = { id: ids.capture, status: config.providerMode === 'pending' ? 'PENDING' : 'COMPLETED', amount: money(), finalCapture: true };
    captures.push(clone(capture));
    order.purchaseUnits[0].payments.captures = clone(captures);
    if (capture.status === 'COMPLETED') order.purchaseUnits[0].payments.authorizations[0].status = 'CAPTURED';
    record('simulated_provider_commit', { capture });
    if (config.providerMode === 'lost-response') {
      record('sdk_error', { method: 'captureAuthorizedPayment', code: 'SIMULATED_RESPONSE_DISCARDED_AFTER_COMMIT' });
      throw new ApiError('SIMULATED_RESPONSE_DISCARDED_AFTER_COMMIT');
    }
    record('sdk_response', { method: 'captureAuthorizedPayment', result: capture });
    return { result: clone(capture) };
  }
}
class MedusaError extends Error { static Types = { INVALID_DATA: 'INVALID_DATA' }; constructor(_type, message) { super(message); } }
const source = readFileSync('service.ts', 'utf8');
const sha256 = text => createHash('sha256').update(text).digest('hex');
if (sha256(source) !== config.sourceHash) throw new Error('SOURCE_HASH_MISMATCH');
const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
const erased = stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: config.sourceUrl });
const module = new SourceTextModule(erased, { context, identifier: config.sourceUrl });
const types = Object.fromEntries(source.match(/import \{([^}]+)\} from "@medusajs\/framework\/types"/)[1].split(',').map(s => [s.trim(), undefined]));
const dependencies = {
  '@medusajs/framework/utils': { AbstractPaymentProvider: class {}, PaymentActions: { NOT_SUPPORTED: 'not_supported' } },
  '@medusajs/framework/types': types,
  '@medusajs/utils': { AbstractEventBusModuleService: class {}, MedusaError },
  '@paypal/paypal-server-sdk': { OrdersController, PaymentsController, Client, ApiError, CheckoutPaymentIntent: { Authorize: 'AUTHORIZE' },
    Environment: { Sandbox: 'sandbox', Production: 'production' }, LogLevel: { Info: 'info' }, Order: undefined,
    OrderStatus: { Created: 'CREATED', Saved: 'SAVED', Approved: 'APPROVED', PayerActionRequired: 'PAYER_ACTION_REQUIRED', Voided: 'VOIDED', Completed: 'COMPLETED' }, PatchOp: { Replace: 'replace' } }
};
await module.link(specifier => {
  if (!Object.hasOwn(dependencies, specifier)) throw new Error('UNALLOWLISTED_IMPORT');
  const exports = dependencies[specifier];
  return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
});
await module.evaluate({ timeout: 500 });
const target = new module.namespace.default({ logger: { error: () => record('target_log', { message: 'Target logged an error; no raw envelope retained.' }) }, event_bus: {} },
  { oAuthClientId: 'offline-dummy', oAuthClientSecret: 'offline-dummy', environment: 'sandbox' });
let data = null, lastStatus = null;
const targetSnapshot = output => ({ sessionStatus: output?.status ?? null, order: clone(output?.data?.paypalOrder ?? null), providerOrderId: output?.data?.paypalOrderId ?? null });
for (const [index, action] of config.sequence.entries()) {
  currentAction = index;
  const before = snapshot(), start = events.length;
  record('action_start', { action });
  let output = null, error = null;
  try {
    if (action === 'initiate') { output = await target.initiatePayment({ amount: config.major, currency_code: config.currency }); data = output.data; }
    else if (action === 'approve') { order.status = 'APPROVED'; record('simulated_buyer_approval', { orderId: order.id }); }
    else if (action === 'authorize') {
      // This is the README's browser-side order.authorize step, not merchant capture.
      order.status = 'COMPLETED'; order.purchaseUnits[0].payments = { authorizations: [{ id: ids.authorization, status: 'CREATED', amount: money() }] };
      record('simulated_buyer_authorization', { authorizationId: ids.authorization });
      output = await target.authorizePayment({ data }); data = output.data; lastStatus = output.status;
    } else if (action === 'capture') { output = await target.capturePayment({ data }); data = output.data; }
    else if (action === 'status') { output = await target.getPaymentStatus({ data }); lastStatus = output.status; }
    else if (action === 'retrieve') { output = await target.retrievePayment({ data }); data = output.data; }
    else if (action === 'settle') {
      captures[0].status = 'COMPLETED'; order.purchaseUnits[0].payments.captures = clone(captures); order.purchaseUnits[0].payments.authorizations[0].status = 'CAPTURED';
      record('simulated_settlement', { captureId: captures[0].id });
    } else throw new Error('UNSUPPORTED_ACTION');
  } catch (e) { error = String(e.message).slice(0, 160); }
  const returned = targetSnapshot(output), retained = targetSnapshot({ data, status: lastStatus });
  record('action_end', { action, returned, error, retained });
  actions.push({ index, action, before, after: snapshot(), returned, error, retained, evidenceRefs: events.slice(start).map(e => e.id) });
}
process.stdout.write(JSON.stringify({ runId: config.runId, evidenceMode: 'external-code-simulated-provider', integrationLevel: 'isolated external service module',
  isolation, sourceHash: sha256(source), transformedHash: sha256(erased), transformation: 'Node stripTypeScriptTypes(mode=strip); no business-logic edits',
  sequence: config.sequence, providerMode: config.providerMode, events, actions, providerFinal: snapshot(), fulfillment: null, merchantDatabasePaidState: null }));
