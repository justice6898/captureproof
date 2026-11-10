// Independently constructed oracle inputs. No runner, database or provider is executed.
export function persistenceObservation({ open = true, status = 'COMPLETED' } = {}) {
  const ids = { order: 'order-1', authorization: 'auth-1', capture: 'capture-1', payment: 'payment-1', session: 'session-1', collection: 'collection-1' };
  const money = { currency_code: 'USD', value: '12.00' };
  const capture = { id: ids.capture, status, amount: { ...money } };
  const order = { id: ids.order, purchase_units: [{ amount: { ...money }, payments: { authorizations: [{ id: ids.authorization, amount: { ...money } }], captures: [capture] } }] };
  const amount = { amount: '12', raw_amount: { value: '12' }, currency_code: 'USD' };
  const rows = {
    payment: [{ ...amount, id: ids.payment, payment_session_id: ids.session, payment_collection_id: ids.collection, captured_at: null, data: { paypalOrderId: ids.order, paypalOrder: { id: ids.order, purchaseUnits: [{ amount: { currencyCode: 'USD', value: '12.00' }, payments: { authorizations: [{ id: ids.authorization }] } }] } } }],
    payment_session: [{ ...amount, id: ids.session, payment_collection_id: ids.collection }],
    payment_collection: [{ ...amount, id: ids.collection, status: 'authorized', captured_amount: '0', completed_at: null }],
    capture: [], captureproof_operation: []
  };
  const events = [
    { id: 'boundary', kind: 'capture_boundary_end', ordinal: 1 },
    { id: 'read-provider', kind: 'provider_response', actor: 'auditor', path: `/v2/checkout/orders/${ids.order}`, status: 200, body: structuredClone(order), ordinal: 2 },
    { id: 'read-db', kind: 'fresh_database_read', ordinal: 3 }
  ];
  return { ids, contract: { amountMinor: 1200, currency: 'USD', ids: { order: ids.order, authorization: ids.authorization, capture: ids.capture } },
    completionWindowOpen: open, events, providerFinal: { order, capture }, returned: { kind: 'rejected' },
    isolation: { environmentScrubbed: true, fileReadBlocked: true, subprocessBlocked: true, networkBlocked: true },
    ...Object.fromEntries(['before', 'after', 'afterShutdown'].map((key, i) => [key, { independentConnection: true, backend_pid: i + 1, transaction_id: String(i + 1), rows: structuredClone(rows) }])) };
}
export function changeCommitted(trace, mutate) {
  for (const snapshot of [trace.after, trace.afterShutdown]) mutate(snapshot.rows);
  return trace;
}
