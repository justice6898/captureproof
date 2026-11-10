import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { fixture } from '../test-support/checkout-fixture.mjs';
import { checkoutServer } from '../src/checkout-http.mjs';
import { PayPalSandbox } from '../src/paypal-sandbox.mjs';

async function app(t, options) {
  const f = fixture(t, options);
  const server = checkoutServer(f.service);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  f.service.origin = origin;
  const request = (path, data, headers = {}) => fetch(origin + path, data === undefined ? { headers } : {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data)
  });
  return { ...f, request, origin };
}

test('HTTP local checkout covers create, manual approval, capture, and persisted view', async t => {
  const { request, provider } = await app(t);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sandbox buyer/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  let response = await request('/api/orders', {});
  assert.equal(response.status, 201);
  let order = await response.json();
  order = await (await request(`/api/orders/${order.id}/create`, {})).json();
  assert.equal(order.paid, false);
  provider.approve(order.paypalOrderId);
  const before = await (await request(`/api/orders/${order.id}/reconcile`, {})).json();
  assert.equal(before.paid, false);
  const paid = await (await request(`/api/orders/${order.id}/capture`, {})).json();
  assert.equal(paid.paid, true);
  assert.equal(paid.fulfillmentCount, 1);
  const saved = await (await request(`/api/orders/${order.id}`)).json();
  assert.equal(saved.captureId, paid.captureId);
});

test('browser cannot set price, currency, paid state, provider order, or request ID', async t => {
  const { request, provider } = await app(t);
  for (const data of [{ amountMinor: 1 }, { currency: 'EUR' }, { paid: true }, { paypalOrderId: 'OTHER' }, { captureRequestId: 'new' }]) {
    assert.equal((await request('/api/orders', data)).status, 400);
  }
  const order = await (await request('/api/orders', {})).json();
  for (const operation of ['create', 'capture', 'reconcile']) assert.equal((await request(`/api/orders/${order.id}/${operation}`, { paid: true })).status, 400);
  assert.equal(provider.createCalls.length, 0);
});

test('cross-origin, missing-origin and invalid Host mutations are rejected', async t => {
  const { request, origin, store } = await app(t);
  assert.equal((await request('/api/orders', {}, { Origin: 'https://unrelated.test' })).status, 403);
  assert.equal((await fetch(origin + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  // fetch derives Host from its URL, so use the HTTP client to send a real mismatched Host.
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(origin + '/api/orders', { method: 'POST', headers: {
      Host: 'unrelated.test', Origin: origin, 'Content-Type': 'application/json'
    } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(wrongHostStatus, 403);
  assert.equal(store.list().length, 0);
});

test('return query parameters and GET requests cannot authorize a capture', async t => {
  const { request, provider, service } = await app(t);
  const order = service.newOrder();
  await service.create(order.id);
  assert.equal((await request(`/?order=${order.id}&approval=returned&token=OTHER&paid=true`)).status, 200);
  assert.equal((await request(`/api/orders/${order.id}/capture`)).status, 404);
  assert.equal(provider.captureCalls.length, 0);
  assert.equal(service.view(order.id).paid, false);
});

test('HTTP missing credentials are actionable and public config excludes credentials', async t => {
  const { request, service } = await app(t);
  service.provider = new PayPalSandbox();
  const config = await (await request('/api/config')).json();
  assert.equal(config.configured, false);
  assert.doesNotMatch(JSON.stringify(config), /clientId|clientSecret|access_token/);
  const order = await (await request('/api/orders', {})).json();
  const response = await request(`/api/orders/${order.id}/create`, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'SANDBOX_CREDENTIALS_MISSING');
});

test('HTTP fault controls are gated and recovery shows a test-only dropped response', async t => {
  const { request, provider, service } = await app(t);
  assert.equal((await request('/api/orders', { dropCaptureResponse: true })).status, 403);
  service.enableTestFaults = true;
  let order = await (await request('/api/orders', { dropCaptureResponse: true })).json();
  order = await (await request(`/api/orders/${order.id}/create`, {})).json();
  provider.approve(order.paypalOrderId);
  const recovered = await (await request(`/api/orders/${order.id}/capture`, {})).json();
  assert.equal(recovered.faultInjected, true);
  assert.equal(recovered.paid, true);
  assert.equal(recovered.fulfillmentCount, 1);
});

test('malformed and oversized request bodies fail without creating orders', async t => {
  const { request, origin, store } = await app(t);
  assert.equal((await request('/api/orders', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('/api/orders', { ignored: 'x'.repeat(3000) })).status, 413);
  for (const body of ['{', 'null', '[]']) {
    const response = await fetch(origin + '/api/orders', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
  }
  assert.equal(store.list().length, 0);
});

test('HTTP comparison exposes observed FAIL/PASS and blocks generic merchant repair of experiment orders', async t => {
  const { request, provider, store } = await app(t, { enableTestFaults: true });
  for (const [implementation, expected] of [['flawed', 'FAIL'], ['corrected', 'PASS']]) {
    const created = await request('/api/runs', { implementation });
    assert.equal(created.status, 201);
    let run = await created.json();
    run = await (await request(`/api/runs/${run.id}/prepare`, {})).json();
    assert.equal(run.verdict.status, 'INCONCLUSIVE');
    provider.approve(run.order.paypalOrderId);
    const response = await request(`/api/runs/${run.id}/execute`, {});
    assert.equal(response.status, 200);
    run = await response.json();
    assert.equal(run.verdict.status, expected);
    const before = store.get(run.businessOrderId);
    for (const operation of ['create', 'capture', 'reconcile']) {
      assert.equal((await request(`/api/orders/${run.businessOrderId}/${operation}`, {})).status, 409);
    }
    assert.equal((await request(`/api/runs/${run.id}/audit`, {})).status, 200);
    assert.deepEqual(store.get(run.businessOrderId), before);
    assert.equal((await (await request(`/api/runs/${run.id}`)).json()).verdict.status, expected);
  }
  assert.equal((await (await request('/api/runs')).json()).length, 2);
  assert.equal((await request('/runs.js')).status, 200);
  const html = await (await request('/')).text();
  assert.match(html, /Collect evidence \(no recovery\)/);
  assert.match(html, /Explicitly recover merchant/);
});

test('HTTP run actions require same-origin POST and reject client-supplied evidence and verdicts', async t => {
  const { request, store } = await app(t, { enableTestFaults: true });
  assert.equal((await request('/api/runs', { implementation: 'flawed' }, { Origin: 'https://unrelated.test' })).status, 403);
  assert.equal((await request('/api/runs', { implementation: 'flawed', verdict: 'PASS' })).status, 400);
  assert.equal((await request('/api/runs', { implementation: 'unsupported' })).status, 400);
  assert.equal(store.listRuns().length, 0);
  const run = await (await request('/api/runs', { implementation: 'flawed' })).json();
  for (const operation of ['prepare', 'execute', 'audit', 'recover']) {
    assert.equal((await request(`/api/runs/${run.id}/${operation}`)).status, 404);
    assert.equal((await request(`/api/runs/${run.id}/${operation}`, { settled: true, paid: true })).status, 400);
  }
  assert.equal(store.get(run.businessOrderId).paid, false);
});
