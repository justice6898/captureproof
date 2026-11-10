import { CheckoutError, PROVIDER_ID } from './checkout-contract.mjs';

const BASE = 'https://api-m.sandbox.paypal.com';

export class PayPalSandbox {
  #clientId; #secret; #fetch; #token; #expires = 0;
  constructor({ clientId, clientSecret, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
    this.#clientId = clientId; this.#secret = clientSecret; this.#fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.evidenceMode = 'paypal-sandbox';
  }
  get configured() {
    return [this.#clientId, this.#secret].every(v => typeof v === 'string' && v.trim() && !v.startsWith('replace_with_'));
  }
  async #request(path, options) {
    try {
      const response = await this.#fetch(BASE + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      // Provider error bodies can contain personal data; never log or forward them.
      if (!response.ok) throw new CheckoutError(`PAYPAL_HTTP_${response.status}`, 502);
      const body = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new CheckoutError('PAYPAL_INVALID_RESPONSE', 502);
      return body;
    } catch (error) {
      if (error instanceof CheckoutError) throw error;
      throw new CheckoutError('PAYPAL_TRANSPORT_OR_RESPONSE_ERROR', 502);
    }
  }
  async #accessToken() {
    if (!this.configured) throw new CheckoutError('SANDBOX_CREDENTIALS_MISSING', 503);
    if (this.#token && Date.now() < this.#expires) return this.#token;
    const body = await this.#request('/v1/oauth2/token', { method: 'POST', headers: {
      Authorization: `Basic ${Buffer.from(`${this.#clientId}:${this.#secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }, body: 'grant_type=client_credentials' });
    if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new CheckoutError('PAYPAL_INVALID_TOKEN_RESPONSE', 502);
    this.#token = body.access_token;
    this.#expires = Date.now() + Math.max(0, body.expires_in - 60) * 1000;
    return this.#token;
  }
  async #api(path, method = 'GET', body, requestId) {
    const token = await this.#accessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    if (method === 'POST') {
      if (!/^[0-9a-f-]{36}$/.test(requestId ?? '')) throw new CheckoutError('INVALID_REQUEST_ID');
      headers['PayPal-Request-Id'] = requestId;
    }
    try { return await this.#request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch (error) { if (error.code === 'PAYPAL_HTTP_401') { this.#token = null; this.#expires = 0; } throw error; }
  }
  create(order) {
    const value = `${Math.floor(order.amountMinor / 100)}.${String(order.amountMinor % 100).padStart(2, '0')}`;
    return this.#api('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE', purchase_units: [{ reference_id: order.id, custom_id: order.id,
        description: order.productName, amount: { currency_code: order.currency, value } }],
      payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        return_url: `${order.origin}/?order=${order.id}&approval=returned`,
        cancel_url: `${order.origin}/?order=${order.id}&approval=cancelled` } } }
    }, order.createRequestId);
  }
  get(orderId) { this.#validateId(orderId); return this.#api(`/v2/checkout/orders/${orderId}`); }
  capture(orderId, requestId) { this.#validateId(orderId); return this.#api(`/v2/checkout/orders/${orderId}/capture`, 'POST', {}, requestId); }
  #validateId(id) { if (typeof id !== 'string' || !PROVIDER_ID.test(id)) throw new CheckoutError('INVALID_PROVIDER_ORDER_ID'); }
}
