/**
 * Deterministic checks for ONE order, ONE USD capture, immediate digital fulfillment.
 * This accepts trusted adapter observations, not arbitrary user-uploaded evidence.
 * A PASS is scoped to one completed experiment; it is not a safety certification.
 */
// Stricter evidence/completion gate for the live response-discard experiment.
// Labels and implementation references deliberately are not inputs to this decision.
export function evaluateLostResponse(o) {
  const incomplete = reason => ({ status: 'INCONCLUSIVE', evidenceMode: o?.evidenceMode ?? 'unknown',
    findings: [{ code: 'MORE_EVIDENCE_REQUIRED', reason,
      evidenceRefs: [o?.provider?.evidenceId, o?.merchant?.evidenceId].filter(Boolean) }] });
  if (o?.scenario !== 'capture_response_lost' || o?.faultObserved !== true) return incomplete('The declared application response-discard fault has not been observed.');
  if (o.settled !== true) return incomplete('The merchant completion/recovery boundary has not been reached.');
  if (o.merchant?.coherent !== true) return incomplete('Merchant state changed while evidence was collected. Collect again.');
  if (o.provider?.complete !== true || o.provider?.orderStatus !== 'COMPLETED' || o.provider?.captures?.length !== 1) return incomplete('A complete bound provider read-back is required.');
  const c = o.provider.captures[0];
  if (c?.status !== 'COMPLETED' || c?.finalCapture !== true || c?.amountMinor !== o.expectedMinor || c?.currency !== o.currency) return incomplete('A completed final capture of the contracted amount is required.');
  const m = o.merchant;
  if (!Array.isArray(m.fulfillmentCaptureIds) || m.fulfillmentCaptureIds.length !== m.fulfillmentCount ||
      m.fulfillmentCaptureIds.some(id => id !== c.id) || (m.paid && m.captureId !== c.id) || (m.captureId && m.captureId !== c.id)) return incomplete('Merchant capture/entitlement identities conflict with the provider.');
  return evaluate(o);
}

export function evaluate(observation) {
  const o = observation;
  const invalid = (reason) => ({ status: 'INCONCLUSIVE', findings: [{ code: 'INVALID_EVIDENCE', reason }], evidenceMode: o?.evidenceMode ?? 'unknown' });
  if (!o || !['local-simulation', 'paypal-sandbox'].includes(o.evidenceMode)) return invalid('Missing evidence provenance.');
  if (!['approval_only', 'capture_response_lost', 'duplicate_webhook'].includes(o.scenario)) return invalid('Unsupported experiment.');
  if (!o.orderId || !o.businessOrderId || o.currency !== 'USD' || !Number.isSafeInteger(o.expectedMinor) || o.expectedMinor <= 0) return invalid('Invalid order contract.');
  if (!o.provider || o.provider.orderId !== o.orderId || o.provider.businessOrderId !== o.businessOrderId || !o.provider.evidenceId) return invalid('Provider evidence does not belong to this order.');
  if (!o.merchant || o.merchant.orderId !== o.orderId || o.merchant.businessOrderId !== o.businessOrderId || !o.merchant.evidenceId) return invalid('Merchant evidence does not belong to this order.');
  if (typeof o.provider.complete !== 'boolean' || typeof o.settled !== 'boolean') return invalid('Coverage and settling status must be explicit.');
  if (!Array.isArray(o.provider.captures) || typeof o.merchant.paid !== 'boolean' || !Number.isSafeInteger(o.merchant.fulfillmentCount) || o.merchant.fulfillmentCount < 0) return invalid('Malformed observations.');
  const unique = new Map();
  for (const capture of o.provider.captures) {
    if (!capture || !capture.id || capture.orderId !== o.orderId || capture.currency !== 'USD' || !Number.isSafeInteger(capture.amountMinor) || capture.amountMinor < 0 || !['COMPLETED', 'PENDING', 'DECLINED'].includes(capture.status)) return invalid('Capture identity, status, or amount is invalid.');
    const previous = unique.get(capture.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(capture)) return invalid('Conflicting snapshots for one capture; reconcile first.');
    unique.set(capture.id, capture);
  }
  const captures = [...unique.values()];
  const completed = captures.filter(c => c.status === 'COMPLETED');
  const amount = completed.reduce((sum, c) => sum + c.amountMinor, 0);
  if (!Number.isSafeInteger(amount)) return invalid('Amount exceeds supported integer range.');
  const refs = [o.provider.evidenceId, o.merchant.evidenceId];
  const findings = [];
  const fail = (code, reason) => findings.push({ code, reason, evidenceRefs: refs });
  if (o.merchant.fulfillmentCount > 1) fail('DUPLICATE_FULFILLMENT', 'One business order produced more than one fulfillment.');
  if (amount > o.expectedMinor) fail('EXCESS_CAPTURE', 'Completed captures exceed the expected amount.');
  if (o.provider.complete && (o.merchant.paid || o.merchant.fulfillmentCount > 0) && amount !== o.expectedMinor) fail('PAID_WITHOUT_CAPTURE', 'Merchant marked paid or fulfilled without the required completed capture.');
  if (o.settled && o.provider.complete && amount === o.expectedMinor) {
    if (!o.merchant.paid) fail('CAPTURE_NOT_RECONCILED', 'The capture completed, but the merchant still does not show paid after the experiment settled.');
    if (o.merchant.fulfillmentCount === 0) fail('MISSING_FULFILLMENT', 'The completed capture has no fulfillment after the experiment settled.');
  }
  if (o.scenario === 'approval_only' && amount !== 0) fail('INVALID_EXPERIMENT', 'An approval-only experiment unexpectedly captured funds.');
  const pending = captures.some(c => c.status === 'PENDING');
  const requiredCaptureMissing = o.scenario !== 'approval_only' && amount < o.expectedMinor;
  const incomplete = !o.provider.complete || !o.settled || pending || requiredCaptureMissing;
  if (!findings.length && incomplete) findings.push({ code: 'MORE_EVIDENCE_REQUIRED', reason: 'No failure proven; provider coverage, settlement, or completed capture is missing.', evidenceRefs: refs });
  return { status: findings.some(f => f.code !== 'MORE_EVIDENCE_REQUIRED') ? 'FAIL' : incomplete ? 'INCONCLUSIVE' : 'PASS', findings, evidenceMode: o.evidenceMode, capturedMinor: amount, fulfillmentCount: o.merchant.fulfillmentCount };
}
