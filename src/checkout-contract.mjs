export const PRODUCT = Object.freeze({ name: 'CaptureProof Digital Sample', amountMinor: 1200, currency: 'USD' });
export const PROVIDER_ID = /^[A-Z0-9]{1,36}$/;
// Stay below the documented six-hour request-key retention; never rotate a retry key.
export const RETRY_WINDOW_MS = 5 * 60 * 60 * 1000;

export class CheckoutError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function usdMinor(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function moneyMatches(amount, order) {
  return amount?.currency_code === order.currency && usdMinor(amount?.value) === order.amountMinor;
}

// Only selected non-personal fields leave the adapter/service boundary for persistence.
export function inspectProviderOrder(raw, order) {
  const invalid = reason => ({ valid: false, paid: false, state: 'INCONCLUSIVE', reason });
  if (!raw || raw.id !== order.paypalOrderId || raw.intent !== 'CAPTURE') return invalid('ORDER_BINDING_MISMATCH');
  if (!Array.isArray(raw.purchase_units) || raw.purchase_units.length !== 1) return invalid('PURCHASE_UNIT_MISMATCH');
  const unit = raw.purchase_units[0];
  if (unit?.reference_id !== order.id || unit?.custom_id !== order.id || !moneyMatches(unit?.amount, order)) return invalid('BUSINESS_ORDER_OR_AMOUNT_MISMATCH');
  if (!['CREATED', 'SAVED', 'APPROVED', 'VOIDED', 'COMPLETED', 'PAYER_ACTION_REQUIRED'].includes(raw.status)) return invalid('UNKNOWN_ORDER_STATUS');
  if (unit.payments !== undefined && (!unit.payments || typeof unit.payments !== 'object' || Array.isArray(unit.payments))) return invalid('MALFORMED_PAYMENTS');
  if (unit.payments && Object.hasOwn(unit.payments, 'captures') && !Array.isArray(unit.payments.captures)) return invalid('MALFORMED_CAPTURES');
  if (unit.payments?.authorizations?.length || unit.payments?.refunds?.length) return invalid('UNSUPPORTED_PAYMENT_STATE');
  const captures = unit.payments?.captures ?? [];
  if (!Array.isArray(captures) || captures.length > 1) return invalid('UNSUPPORTED_CAPTURE_COUNT');
  const evidence = { paypalOrderId: raw.id, businessOrderId: unit.custom_id, referenceId: unit.reference_id,
    orderStatus: raw.status, amountMinor: order.amountMinor, currency: order.currency, captures: [] };
  if (!captures.length) return { valid: true, paid: false, state: raw.status === 'APPROVED' ? 'AWAITING_CAPTURE' :
    ['CREATED', 'PAYER_ACTION_REQUIRED'].includes(raw.status) ? 'AWAITING_APPROVAL' : 'INCONCLUSIVE',
    reason: 'COMPLETED_CAPTURE_MISSING', canCapture: raw.status === 'APPROVED', evidence };
  const c = captures[0];
  if (!c || typeof c.id !== 'string' || !PROVIDER_ID.test(c.id) || !moneyMatches(c.amount, order)) return invalid('CAPTURE_BINDING_OR_AMOUNT_MISMATCH');
  if ((c.custom_id !== undefined && c.custom_id !== order.id) ||
      (order.captureId && c.id !== order.captureId) ||
      (order.captureResponseId && c.id !== order.captureResponseId) ||
      (c.supplementary_data?.related_ids?.order_id !== undefined && c.supplementary_data.related_ids.order_id !== order.paypalOrderId)) return invalid('CAPTURE_IDENTITY_MISMATCH');
  if (!['COMPLETED', 'PENDING', 'DECLINED', 'FAILED'].includes(c.status)) return invalid('UNSUPPORTED_CAPTURE_STATUS');
  evidence.captures.push({ id: c.id, status: c.status, amountMinor: order.amountMinor, currency: order.currency, finalCapture: c.final_capture === true });
  const paid = raw.status === 'COMPLETED' && c.status === 'COMPLETED' && c.final_capture === true;
  return { valid: true, paid, state: paid ? 'PAID' : c.status === 'PENDING' ? 'PENDING' : 'INCONCLUSIVE',
    reason: paid ? 'BOUND_COMPLETED_CAPTURE' : 'COMPLETED_CAPTURE_MISSING', canCapture: false, captureId: c.id, evidence };
}

export function approvalUrl(raw) {
  const link = Array.isArray(raw?.links) ? raw.links.find(l => ['payer-action', 'approve'].includes(l?.rel) && l.method === 'GET') : null;
  try {
    const url = new URL(link?.href);
    if (url.origin === 'https://www.sandbox.paypal.com' && !url.username && !url.password &&
        url.pathname === '/checkoutnow' && url.searchParams.get('token') === raw.id) return url.href;
  } catch { /* Missing approval evidence stays unavailable. */ }
  return null;
}
