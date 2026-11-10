import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, approved, FakePayPal } from '../test-support/checkout-fixture.mjs';
import { OrderStore } from '../src/order-store.mjs';
import { CheckoutService } from '../src/checkout-service.mjs';
import { RETRY_WINDOW_MS, CheckoutError, usdMinor } from '../src/checkout-contract.mjs';

test('normal checkout requires approval, capture, and bound read-back; fulfillment is durable and unique', async t => {
  const { service, provider, store } = fixture(t);
  const created = await service.create(service.newOrder().id);
  assert.equal(created.amountMinor, 1200);
  assert.equal(created.paid, false);
  await service.capture(created.id);
  assert.equal(provider.captureCalls.length, 0);
  provider.approve(created.paypalOrderId);
  const before = await service.reconcile(created.id);
  assert.equal(before.state, 'AWAITING_CAPTURE');
  assert.equal(before.paid, false);
  assert.equal(before.fulfillmentCount, 0);
  const paid = await service.capture(created.id);
  assert.equal(paid.paid, true);
  assert.equal(paid.evidenceStatus, 'VERIFIED');
  assert.equal(paid.lastEvidence.operation, 'GET_ORDER');
  assert.equal(paid.lastEvidence.businessOrderId, created.id);
  assert.equal(paid.lastEvidence.paypalOrderId, created.paypalOrderId);
  assert.equal(paid.lastEvidence.captures[0].id, paid.captureId);
  await Promise.all([service.capture(created.id), service.capture(created.id), service.reconcile(created.id)]);
  assert.equal(provider.captureCalls.length, 1);
  assert.equal(store.fulfillmentCount(created.id), 1);
});

const mutations = [
  ['provider order', raw => { raw.id = 'OTHER'; }],
  ['intent', raw => { raw.intent = 'AUTHORIZE'; }],
  ['business custom ID', raw => { raw.purchase_units[0].custom_id = 'OTHER'; }],
  ['business reference ID', raw => { raw.purchase_units[0].reference_id = 'OTHER'; }],
  ['order amount', raw => { raw.purchase_units[0].amount.value = '11.99'; }],
  ['order currency', raw => { raw.purchase_units[0].amount.currency_code = 'EUR'; }],
  ['extra purchase unit', raw => { raw.purchase_units.push(structuredClone(raw.purchase_units[0])); }],
  ['capture amount', raw => { raw.purchase_units[0].payments.captures[0].amount.value = '12.01'; }],
  ['capture currency', raw => { raw.purchase_units[0].payments.captures[0].amount.currency_code = 'EUR'; }],
  ['capture missing ID', raw => { delete raw.purchase_units[0].payments.captures[0].id; }],
  ['capture related order', raw => { raw.purchase_units[0].payments.captures[0].supplementary_data = { related_ids: { order_id: 'OTHER' } }; }],
  ['capture custom ID', raw => { raw.purchase_units[0].payments.captures[0].custom_id = 'OTHER'; }],
  ['multiple captures', raw => { raw.purchase_units[0].payments.captures.push(structuredClone(raw.purchase_units[0].payments.captures[0])); }],
  ['missing captures', raw => { delete raw.purchase_units[0].payments; }],
  ['null capture', raw => { raw.purchase_units[0].payments.captures = [null]; }],
  ['unknown capture state', raw => { raw.purchase_units[0].payments.captures[0].status = 'SURPRISE'; }],
  ['missing final capture evidence', raw => { delete raw.purchase_units[0].payments.captures[0].final_capture; }],
  ['approved order with completed capture', raw => { raw.status = 'APPROVED'; }]
];
for (const [name, mutate] of mutations) test(`untrusted ${name} evidence cannot establish payment`, async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  provider.complete(order.paypalOrderId);
  mutate(provider.orders.get(order.paypalOrderId));
  const result = await service.capture(order.id);
  assert.equal(result.paid, false);
  assert.equal(result.fulfillmentCount, 0);
  assert.equal(result.evidenceStatus, 'INCONCLUSIVE');
  assert.equal(provider.captureCalls.length, 0);
});

for (const status of ['PENDING', 'DECLINED', 'FAILED', 'REFUNDED']) test(`${status} capture never fulfills or triggers another capture`, async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  provider.complete(order.paypalOrderId);
  provider.orders.get(order.paypalOrderId).purchase_units[0].payments.captures[0].status = status;
  const result = await service.capture(order.id);
  assert.equal(result.paid, false);
  assert.equal(result.fulfillmentCount, 0);
  assert.equal(result.evidenceStatus, 'INCONCLUSIVE');
  assert.equal(provider.captureCalls.length, 0);
});

test('test-only lost success response recovers exclusively through provider read-back', async t => {
  const { service, provider } = fixture(t, { enableTestFaults: true });
  const order = await approved(service, provider, { dropCaptureResponse: true });
  const result = await service.capture(order.id);
  assert.equal(result.faultInjected, true);
  assert.equal(result.captureResponseId, null);
  assert.equal(result.paid, true);
  assert.equal(result.fulfillmentCount, 1);
  assert.equal(result.evidenceMode, 'local-simulation');
  assert.deepEqual(result.events.slice(-2).map(e => e.type), ['TEST_CAPTURE_RESPONSE_DROPPED', 'BOUND_CAPTURE_VERIFIED']);
  assert.equal(provider.captureCalls.length, 1);
});

test('fault requires explicit server enablement', t => {
  const { service } = fixture(t);
  assert.throws(() => service.newOrder({ dropCaptureResponse: true }), { code: 'TEST_FAULTS_DISABLED' });
});

test('success response with failed read-back stays unpaid until later reconciliation', async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  const get = provider.get.bind(provider);
  provider.get = id => provider.captureCalls.length ? Promise.reject(new Error('private response content')) : get(id);
  const result = await service.capture(order.id);
  assert.equal(result.paid, false);
  assert.equal(result.fulfillmentCount, 0);
  assert.equal(result.state, 'INCONCLUSIVE');
  assert.equal(JSON.stringify(result).includes('private response content'), false);
  provider.get = get;
  const recovered = await service.reconcile(order.id);
  assert.equal(recovered.paid, true);
  assert.equal(recovered.fulfillmentCount, 1);
  assert.equal(provider.captureCalls.length, 1);
});

test('response and read-back capture identity conflict is inconclusive', async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  const capture = provider.capture.bind(provider);
  provider.capture = async (...args) => {
    const raw = await capture(...args);
    raw.purchase_units[0].payments.captures[0].id = 'DIFFERENTCAPTURE';
    return raw;
  };
  const result = await service.capture(order.id);
  assert.equal(result.paid, false);
  assert.equal(result.lastError, 'CAPTURE_IDENTITY_MISMATCH');
});

test('transport failure after provider commit is recovered without recapture', async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  const capture = provider.capture.bind(provider);
  provider.capture = async (...args) => { await capture(...args); throw new CheckoutError('PAYPAL_TRANSPORT_OR_RESPONSE_ERROR', 502); };
  const result = await service.capture(order.id);
  assert.equal(result.paid, true);
  assert.equal(result.fulfillmentCount, 1);
  assert.equal(provider.captureCalls.length, 1);
});

test('capture retry reads provider first and reuses a request ID persisted before network I/O', async t => {
  const { service, provider, store } = fixture(t);
  const order = await approved(service, provider);
  const capture = provider.capture.bind(provider);
  let first = true;
  provider.capture = async (id, requestId) => {
    const persisted = store.get(order.id);
    assert.equal(persisted.captureRequestId, requestId);
    assert.notEqual(persisted.captureStartedAt, null);
    if (first) { first = false; provider.captureCalls.push({ id, requestId }); throw new CheckoutError('PAYPAL_HTTP_503', 502); }
    return capture(id, requestId);
  };
  const unresolved = await service.capture(order.id);
  assert.equal(unresolved.paid, false);
  assert.equal(unresolved.state, 'PENDING');
  const result = await service.capture(order.id);
  assert.equal(result.paid, true);
  assert.equal(provider.captureCalls.length, 2);
  assert.deepEqual(provider.captureCalls.map(c => c.requestId), [order.captureRequestId, order.captureRequestId]);
});

test('expired capture retry is read-only and never rotates its key', async t => {
  let now = 1000;
  const { service, provider, store } = fixture(t, { now: () => now });
  const order = await approved(service, provider);
  provider.capture = async () => { throw new Error('timeout'); };
  await service.capture(order.id);
  now += RETRY_WINDOW_MS;
  let attempts = 0;
  provider.capture = async () => { attempts++; };
  const result = await service.capture(order.id);
  assert.equal(attempts, 0);
  assert.equal(result.lastError, 'CAPTURE_RETRY_WINDOW_EXPIRED');
  assert.equal(store.get(order.id).captureRequestId, order.captureRequestId);
  provider.complete(order.paypalOrderId);
  assert.equal((await service.reconcile(order.id)).paid, true);
});

test('missing credentials do not create provider orders or payment evidence', async t => {
  const { service, provider } = fixture(t);
  provider.configured = false;
  const order = service.newOrder();
  await assert.rejects(service.create(order.id), { code: 'SANDBOX_CREDENTIALS_MISSING' });
  assert.equal(provider.createCalls.length, 0);
  assert.equal(service.view(order.id).paid, false);
});

test('ambiguous create retries reuse identical persisted parameters; expired retry is blocked', async t => {
  let now = 1000;
  const { service, provider } = fixture(t, { now: () => now });
  const calls = [];
  provider.create = async order => { calls.push(order); throw new CheckoutError('PAYPAL_HTTP_503', 502); };
  const order = service.newOrder();
  await service.create(order.id); await service.create(order.id);
  assert.equal(calls[0].createRequestId, calls[1].createRequestId);
  assert.equal(calls[0].origin, calls[1].origin);
  assert.equal(calls[0].amountMinor, calls[1].amountMinor);
  now += RETRY_WINDOW_MS;
  await assert.rejects(service.create(order.id), { code: 'CREATE_RETRY_WINDOW_EXPIRED' });
  assert.equal(calls.length, 2);
  assert.equal(service.view(order.id).paid, false);
});

test('concurrent local capture clicks serialize one logical capture', async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  const results = await Promise.all(Array.from({ length: 8 }, () => service.capture(order.id)));
  assert.ok(results.every(r => r.paid && r.fulfillmentCount === 1));
  assert.equal(provider.captureCalls.length, 1);
});

test('SQLite restart preserves unresolved operations and recovers a committed capture once', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'captureproof-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'orders.sqlite');
  let store = new OrderStore(path);
  t.after(() => store.close());
  const provider = new FakePayPal();
  let service = new CheckoutService({ store, provider, origin: 'http://127.0.0.1:3000', enableTestFaults: true });
  const order = await approved(service, provider, { dropCaptureResponse: true });
  const get = provider.get.bind(provider);
  provider.get = id => provider.captureCalls.length ? Promise.reject(new Error('read unavailable')) : get(id);
  const lost = await service.capture(order.id);
  assert.equal(lost.faultInjected, true); assert.equal(lost.paid, false);
  store.close(); store = new OrderStore(path);
  provider.get = get;
  service = new CheckoutService({ store, provider, origin: 'http://127.0.0.1:3000' });
  assert.equal(store.get(order.id).captureRequestId, order.captureRequestId);
  assert.equal((await service.capture(order.id)).paid, true);
  store.close(); store = new OrderStore(path);
  assert.equal(store.get(order.id).paid, true);
  assert.equal(store.fulfillmentCount(order.id), 1);
  assert.equal(provider.captureCalls.length, 1);
});

test('SQL prevents capture reuse across business orders and rolls back fulfillment', async t => {
  const { service, provider, store } = fixture(t);
  const a = await approved(service, provider);
  const b = await approved(service, provider);
  const paidA = await service.capture(a.id);
  provider.complete(b.paypalOrderId);
  provider.orders.get(b.paypalOrderId).purchase_units[0].payments.captures[0].id = paidA.captureId;
  await assert.rejects(service.reconcile(b.id), /UNIQUE constraint/);
  assert.equal(store.get(b.id).paid, false);
  assert.equal(store.fulfillmentCount(b.id), 0);
  assert.equal(store.fulfillmentCount(a.id), 1);
});

test('SQL revision guard rejects stale writes without losing paid state', async t => {
  const { service, provider, store } = fixture(t);
  const order = await approved(service, provider);
  const stale = store.get(order.id);
  await service.capture(order.id);
  assert.throws(() => store.save(stale), { code: 'ORDER_CHANGED_RELOAD_REQUIRED' });
  assert.equal(store.get(order.id).paid, true);
  assert.equal(store.fulfillmentCount(order.id), 1);
});

test('provider personal data is excluded from stored evidence', async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  const raw = provider.orders.get(order.paypalOrderId);
  raw.payer = { email_address: 'private@example.test' };
  raw.purchase_units[0].shipping = { name: { full_name: 'Private Name' } };
  const result = await service.capture(order.id);
  assert.equal(result.paid, true);
  assert.doesNotMatch(JSON.stringify(result), /private@example|Private Name/);
});

test('USD parsing uses exact minor units and rejects malformed or unsafe amounts', () => {
  assert.equal(usdMinor('12'), 1200); assert.equal(usdMinor('12.0'), 1200); assert.equal(usdMinor('12.01'), 1201);
  for (const value of ['1e1', '-12.00', '12.001', '012.00', '', '9007199254740992', 12, null]) assert.equal(usdMinor(value), null);
});

test('malformed payment containers cannot trigger capture or establish payment', async t => {
  const { service, provider } = fixture(t);
  for (const payments of [null, [], 'invalid', { captures: null }, { captures: {} }]) {
    const order = await approved(service, provider);
    provider.orders.get(order.paypalOrderId).purchase_units[0].payments = payments;
    const result = await service.capture(order.id);
    assert.equal(result.state, 'INCONCLUSIVE');
    assert.equal(result.paid, false);
    assert.equal(result.fulfillmentCount, 0);
  }
  assert.equal(provider.captureCalls.length, 0);
});

test('malformed approval links retain the provider identity for read-back', async t => {
  const { service, provider } = fixture(t);
  const create = provider.create.bind(provider);
  provider.create = async order => { const raw = await create(order); raw.links = {}; return raw; };
  const result = await service.create(service.newOrder().id);
  assert.ok(result.paypalOrderId);
  assert.equal(result.paid, false);
  assert.equal(result.lastEvidence.operation, 'GET_ORDER');
});

test('an unavailable later observation does not erase a historical entitlement or claim current verification', async t => {
  const { service, provider } = fixture(t);
  const order = await approved(service, provider);
  const paid = await service.capture(order.id);
  provider.get = async () => { throw new Error('unavailable'); };
  const result = await service.reconcile(order.id);
  assert.equal(result.paid, true);
  assert.equal(result.captureId, paid.captureId);
  assert.equal(result.fulfillmentCount, 1);
  assert.equal(result.evidenceStatus, 'INCONCLUSIVE');
  assert.equal(provider.captureCalls.length, 1);
});
