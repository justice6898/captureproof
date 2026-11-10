import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PayPalSandbox } from '../src/paypal-sandbox.mjs';
import { approvalUrl } from '../src/checkout-contract.mjs';

const token = () => Response.json({ access_token: 'TEST-ACCESS-TOKEN', expires_in: 300 });
const credentials = { clientId: 'TEST-CLIENT', clientSecret: 'TEST-SECRET' };

test('Sandbox adapter sends OAuth, bound create body, fixed host, and stable capture headers', async () => {
  const requests = [];
  const provider = new PayPalSandbox({ ...credentials, fetchImpl: async (url, options) => {
    requests.push({ url, ...options });
    return url.endsWith('/token') ? token() : Response.json({ id: 'TESTORDER' });
  } });
  const order = { id: randomUUID(), amountMinor: 1200, currency: 'USD', productName: 'Digital sample',
    origin: 'http://127.0.0.1:3000', createRequestId: randomUUID() };
  await provider.create(order);
  const captureRequestId = randomUUID();
  await provider.capture('TESTORDER', captureRequestId);
  await provider.capture('TESTORDER', captureRequestId);
  await provider.get('TESTORDER');
  assert.equal(requests.length, 5);
  assert.ok(requests.every(r => new URL(r.url).origin === 'https://api-m.sandbox.paypal.com' && r.redirect === 'error' && r.signal instanceof AbortSignal));
  assert.equal(requests[0].body, 'grant_type=client_credentials');
  assert.equal(requests[0].headers.Authorization, `Basic ${Buffer.from('TEST-CLIENT:TEST-SECRET').toString('base64')}`);
  const payload = JSON.parse(requests[1].body);
  assert.equal(payload.intent, 'CAPTURE');
  assert.deepEqual(payload.purchase_units[0].amount, { currency_code: 'USD', value: '12.00' });
  assert.equal(payload.purchase_units[0].custom_id, order.id);
  assert.equal(payload.purchase_units[0].reference_id, order.id);
  assert.equal(payload.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
  assert.equal(payload.payment_source.paypal.experience_context.return_url, `${order.origin}/?order=${order.id}&approval=returned`);
  assert.equal(requests[1].headers['PayPal-Request-Id'], order.createRequestId);
  for (const capture of requests.slice(2, 4)) {
    assert.equal(capture.headers['PayPal-Request-Id'], captureRequestId);
    assert.equal(capture.headers.Prefer, 'return=representation');
    assert.equal(capture.method, 'POST'); assert.equal(capture.body, '{}');
  }
  assert.equal(requests[4].method, 'GET');
  assert.equal(requests[4].headers['PayPal-Request-Id'], undefined);
});

test('missing and placeholder credentials fail before network access', async () => {
  for (const config of [{}, { clientId: 'replace_with_sandbox_client_id', clientSecret: 'replace_with_sandbox_client_secret' }]) {
    const provider = new PayPalSandbox({ ...config, fetchImpl: () => { assert.fail('Unexpected network request'); } });
    assert.equal(provider.configured, false);
    await assert.rejects(provider.get('TESTORDER'), { code: 'SANDBOX_CREDENTIALS_MISSING' });
  }
});

for (const status of [401, 422, 429, 500]) test(`provider HTTP ${status} errors never expose raw bodies or credentials`, async () => {
  const provider = new PayPalSandbox({ ...credentials, fetchImpl: async url => url.endsWith('/token') ? token() :
    Response.json({ message: 'TEST-SECRET private@example.test', details: ['private payload'] }, { status }) });
  await assert.rejects(provider.get('TESTORDER'), error => {
    assert.equal(error.code, `PAYPAL_HTTP_${status}`);
    assert.doesNotMatch(String(error), /TEST-SECRET|private/);
    return true;
  });
});

test('expired authorization cache is cleared after a 401 without automatically retrying a write', async () => {
  let tokens = 0; let calls = 0;
  const provider = new PayPalSandbox({ ...credentials, fetchImpl: async url => {
    if (url.endsWith('/token')) { tokens++; return token(); }
    calls++; return Response.json({}, { status: calls === 1 ? 401 : 200 });
  } });
  await assert.rejects(provider.capture('TESTORDER', randomUUID()), { code: 'PAYPAL_HTTP_401' });
  assert.equal(calls, 1);
  await provider.get('TESTORDER');
  assert.equal(tokens, 2);
});

test('malformed JSON and network errors are redacted and never treated as success', async () => {
  for (const respond of [() => new Response('private invalid JSON'), () => { throw new Error('TEST-SECRET'); }, () => Response.json(null)]) {
    const provider = new PayPalSandbox({ ...credentials, fetchImpl: async url => url.endsWith('/token') ? token() : respond() });
    await assert.rejects(provider.get('TESTORDER'), error => {
      assert.match(error.code, /^PAYPAL_/); assert.doesNotMatch(String(error), /TEST-SECRET|private/); return true;
    });
  }
});

test('adapter timeout aborts a hanging request', async () => {
  const provider = new PayPalSandbox({ ...credentials, timeoutMs: 10, fetchImpl: async (_url, { signal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(token()), 1000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }) });
  await assert.rejects(provider.get('TESTORDER'), { code: 'PAYPAL_TRANSPORT_OR_RESPONSE_ERROR' });
});

test('provider IDs cannot become paths or external URLs', () => {
  const provider = new PayPalSandbox(credentials);
  for (const id of ['../capture', 'https://example.test', '', undefined]) assert.throws(() => provider.get(id), { code: 'INVALID_PROVIDER_ORDER_ID' });
});

test('approval links must point to the Sandbox checkout and the same provider order', () => {
  for (const links of [undefined, null, {}, 'invalid']) assert.equal(approvalUrl({ id: 'TESTORDER', links }), null);
  for (const href of ['https://www.paypal.com/checkoutnow?token=TESTORDER', 'https://example.test/checkoutnow?token=TESTORDER',
    'https://www.sandbox.paypal.com/checkoutnow?token=OTHER', 'javascript:alert(1)',
    'https://private@www.sandbox.paypal.com/checkoutnow?token=TESTORDER']) {
    assert.equal(approvalUrl({ id: 'TESTORDER', links: [{ rel: 'payer-action', method: 'GET', href }] }), null);
  }
  const href = 'https://www.sandbox.paypal.com/checkoutnow?token=TESTORDER';
  for (const rel of ['approve', 'payer-action']) assert.equal(approvalUrl({ id: 'TESTORDER', links: [{ rel, method: 'GET', href }] }), href);
});
