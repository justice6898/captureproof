import { OrderStore } from '../src/order-store.mjs';
import { CheckoutService } from '../src/checkout-service.mjs';

export class FakePayPal {
  configured = true;
  evidenceMode = 'local-simulation';
  orders = new Map();
  createCalls = [];
  captureCalls = [];
  getCalls = [];
  async create(order) {
    this.createCalls.push(structuredClone(order));
    const id = `TESTORDER${this.createCalls.length}`;
    const raw = { id, intent: 'CAPTURE', status: 'PAYER_ACTION_REQUIRED',
      purchase_units: [{ reference_id: order.id, custom_id: order.id, amount: { currency_code: 'USD', value: '12.00' } }],
      links: [{ rel: 'payer-action', method: 'GET', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
    this.orders.set(id, raw);
    return structuredClone(raw);
  }
  async get(id) { this.getCalls.push(id); return structuredClone(this.orders.get(id)); }
  approve(id) { this.orders.get(id).status = 'APPROVED'; }
  complete(id) {
    const raw = this.orders.get(id);
    raw.status = 'COMPLETED';
    raw.purchase_units[0].payments = { captures: [{ id: `TESTCAP${id}`, status: 'COMPLETED', final_capture: true,
      amount: { currency_code: 'USD', value: '12.00' } }] };
    return structuredClone(raw);
  }
  async capture(id, requestId) {
    this.captureCalls.push({ id, requestId });
    return this.complete(id);
  }
}

export function fixture(t, options = {}) {
  const store = new OrderStore(':memory:');
  t.after(() => store.close());
  const provider = new FakePayPal();
  const service = new CheckoutService({ store, provider, origin: 'http://127.0.0.1:3000', ...options });
  return { store, provider, service };
}

export async function approved(service, provider, input) {
  let order = service.newOrder(input);
  order = await service.create(order.id);
  provider.approve(order.paypalOrderId);
  return order;
}
