import { evaluate } from './verdict.mjs';

export const SCENARIOS = ['approval_only', 'capture_response_lost', 'duplicate_webhook'];

// Purposefully limited fake provider, NOT a reimplementation of PayPal semantics.
// Its responses are always marked local-simulation in the resulting evidence.
class SimulatedProvider {
  constructor(orderId, businessOrderId) {
    this.orderId = orderId;
    this.businessOrderId = businessOrderId;
    this.captureRecord = null;
    this.requestIds = new Set();
  }
  async capture(requestId, { dropResponse = false } = {}) {
    if (!requestId) throw new Error('A logical capture needs a stable request ID.');
    if (this.captureRecord && !this.requestIds.has(requestId)) throw new Error('This fixture supports only one full capture per order.');
    this.requestIds.add(requestId);
    this.captureRecord ??= { id: 'SIM-CAP-1', orderId: this.orderId, status: 'COMPLETED', currency: 'USD', amountMinor: 1200 };
    if (dropResponse) throw new Error('SIMULATED_RESPONSE_LOST_AFTER_CAPTURE');
    return structuredClone(this.captureRecord);
  }
  async observe() {
    return { orderId: this.orderId, businessOrderId: this.businessOrderId, evidenceId: 'sim-provider-snapshot', complete: true, captures: this.captureRecord ? [structuredClone(this.captureRecord)] : [] };
  }
}

export async function runExperiment({ scenario, implementation = 'fixed', deliveries = 2, label = 'default' } = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error('Unsupported scenario');
  if (!['fixed', 'seeded-bug'].includes(implementation)) throw new Error('Unsupported fixture');
  if (!Number.isInteger(deliveries) || deliveries < 1 || deliveries > 100) throw new Error('Deliveries must be 1..100');
  const orderId = `SIM-ORDER-${label}`;
  const businessOrderId = `SIM-BUSINESS-${label}`;
  const provider = new SimulatedProvider(orderId, businessOrderId);
  const merchant = { orderId, businessOrderId, evidenceId: 'sim-merchant-snapshot', paid: false, fulfillmentCount: 0 };
  const trace = [];
  const processedCaptures = new Set();
  const fulfill = capture => {
    if (capture.status !== 'COMPLETED') return;
    if (implementation === 'fixed' && processedCaptures.has(capture.id)) return;
    processedCaptures.add(capture.id);
    merchant.paid = true;
    merchant.fulfillmentCount++;
  };
  trace.push({ id: 'sim-approved', type: 'BUYER_APPROVED', orderId });
  if (scenario === 'approval_only') {
    if (implementation === 'seeded-bug') { merchant.paid = true; merchant.fulfillmentCount++; }
  } else if (scenario === 'capture_response_lost') {
    try { await provider.capture(`capture-${businessOrderId}`, { dropResponse: true }); }
    catch (error) {
      trace.push({ id: 'sim-timeout', type: 'MERCHANT_CAPTURE_RESPONSE_LOST', detail: error.message });
      if (implementation === 'fixed') {
        // Reconcile observed provider state before deciding whether another request is needed.
        const state = await provider.observe();
        for (const capture of state.captures) fulfill(capture);
        trace.push({ id: 'sim-reconciled', type: 'MERCHANT_RECONCILED' });
      }
    }
  } else {
    const capture = await provider.capture(`capture-${businessOrderId}`);
    for (let n = 0; n < deliveries; n++) {
      // Internal handler fixture only; no signature verification is bypassed on a real endpoint.
      trace.push({ id: `sim-delivery-${n}`, type: 'SIMULATED_VERIFIED_EVENT', eventId: 'SIM-EVENT-1', captureId: capture.id });
      fulfill(capture);
    }
  }
  const observation = { evidenceMode: 'local-simulation', scenario, orderId, businessOrderId, currency: 'USD', expectedMinor: 1200, settled: true, provider: await provider.observe(), merchant };
  return { implementation, scenario, trace, observation, verdict: evaluate(observation) };
}
