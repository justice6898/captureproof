import { randomUUID } from 'node:crypto';
import { CheckoutError, inspectProviderOrder } from './checkout-contract.mjs';
import { evaluateLostResponse } from './verdict.mjs';

function snapshot(store, id) {
  const order = store.get(id);
  const captures = store.entitlementCaptures(id);
  return { order, merchant: { evidenceId: randomUUID(), businessOrderId: order.id, orderId: order.paypalOrderId,
    revision: order.revision, state: order.state, paid: order.paid, captureId: order.captureId,
    fulfillmentCount: captures.length, fulfillmentCaptureIds: captures, faultInjected: order.faultInjected } };
}

// The auditor has only provider GET and store reads. It never calls merchant recovery/save.
export async function collectRunEvidence({ store, provider, run, now = Date.now }) {
  const startedAt = now();
  const before = snapshot(store, run.businessOrderId);
  const order = before.order;
  let inspection = null;
  let error = null;
  try {
    if (!order.paypalOrderId) throw new CheckoutError('PROVIDER_ORDER_MISSING');
    inspection = inspectProviderOrder(await provider.get(order.paypalOrderId), order);
    if (!inspection.valid) error = inspection.reason;
  } catch (e) { error = e instanceof CheckoutError ? e.code : 'PROVIDER_READ_UNAVAILABLE'; }
  const after = snapshot(store, run.businessOrderId);
  const coherent = after.order.revision === order.revision &&
    JSON.stringify(after.merchant.fulfillmentCaptureIds) === JSON.stringify(before.merchant.fulfillmentCaptureIds);
  const contractMatches = order.experimentRunId === run.id && order.amountMinor === run.contract.amountMinor &&
    order.currency === run.contract.currency && order.captureRequestId === run.captureRequestId &&
    order.createRequestId === run.createRequestId && order.evidenceMode === run.evidenceMode && provider.evidenceMode === run.evidenceMode;
  if (!contractMatches) error = 'RUN_CONTRACT_CHANGED';
  const p = inspection?.evidence;
  const providerEvidence = { evidenceId: randomUUID(), orderId: p?.paypalOrderId ?? order.paypalOrderId,
    businessOrderId: p?.businessOrderId ?? order.id, complete: inspection?.paid === true && contractMatches,
    orderStatus: p?.orderStatus ?? null, operation: 'GET_ORDER', error,
    captures: (p?.captures ?? []).map(c => ({ ...c, orderId: order.paypalOrderId })) };
  const dropped = order.events.some(e => e.type === 'TEST_CAPTURE_RESPONSE_DROPPED');
  const observation = { evidenceMode: provider.evidenceMode, scenario: run.scenario,
    businessOrderId: order.id, orderId: order.paypalOrderId, currency: run.contract.currency, expectedMinor: run.contract.amountMinor,
    faultObserved: dropped && order.faultInjected && order.captureResponseId === null,
    settled: run.completedAt !== null && run.completedAt <= startedAt && run.phase === 'COMPLETED',
    provider: providerEvidence, merchant: { ...after.merchant, coherent } };
  return { id: randomUUID(), type: 'AUDIT_READ_ONLY', startedAt, at: now(),
    observation, merchantBefore: before.merchant, verdict: evaluateLostResponse(observation) };
}
