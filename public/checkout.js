const el = id => document.getElementById(id);
let selected = new URLSearchParams(location.search).get('order') ?? '';
let config;
let busy = false;
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result;
}
function show(order) {
  el('actions').hidden = !order || Boolean(order.experimentRunId);
  if (order?.experimentRunId && new URLSearchParams(location.search).get('order') === order.id) {
    location.replace(`/?run=${order.experimentRunId}`);
    return;
  }
  el('record').textContent = order ? JSON.stringify(order, null, 2) : 'No order selected.';
  el('approve').hidden = !order?.approvalUrl || order.paid;
  if (order?.approvalUrl) el('approve').href = order.approvalUrl;
  el('create').disabled = busy || !config?.configured || Boolean(order?.paypalOrderId);
  el('capture').disabled = busy || !config?.configured || !order?.paypalOrderId || order.paid;
  el('reconcile').disabled = busy || !config?.configured || !order?.paypalOrderId;
}
async function refresh() {
  const orders = await api('/api/orders');
  el('orders').replaceChildren(new Option('Select an order', ''), ...orders.map(o => new Option(`${o.id} — ${o.state}`, o.id)));
  el('orders').value = selected;
  show(selected ? await api(`/api/orders/${selected}`) : null);
}
async function action(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('#checkout button, #checkout select').forEach(e => { e.disabled = true; });
  el('approve').hidden = true;
  el('message').textContent = 'Working…';
  try { await work(); el('message').textContent = 'Saved. Review the payment state and evidence below.'; }
  catch (error) { el('message').textContent = `${error.message}. Reload saved orders before retrying if the request was interrupted.`; }
  finally {
    busy = false;
    el('new').disabled = false; el('orders').disabled = false;
    try { await refresh(); } catch (error) { el('message').textContent = error.message; }
  }
}
el('new').onclick = () => action(async () => {
  const order = await api('/api/orders', { dropCaptureResponse: el('fault').checked });
  selected = order.id;
  history.replaceState(null, '', `/?order=${selected}`);
  if (config.configured) await api(`/api/orders/${selected}/create`, {});
});
el('orders').onchange = () => action(async () => {
  selected = el('orders').value;
  history.replaceState(null, '', selected ? `/?order=${selected}` : '/');
});
for (const operation of ['create', 'capture', 'reconcile']) el(operation).onclick = () => action(() => api(`/api/orders/${selected}/${operation}`, {}));
(async () => {
  try {
    config = await api('/api/config');
    el('configuration').textContent = config.configured ? 'Sandbox configured. No payment is verified until provider read-back succeeds.' : 'LIVE SANDBOX NOT VERIFIED — configure Sandbox credentials in the server .env file.';
    el('product').textContent = `${config.product.name} — USD ${(config.product.amountMinor / 100).toFixed(2)}`;
    el('fault').disabled = !config.testFaultsEnabled;
    el('new').disabled = false;
    if (new URLSearchParams(location.search).has('approval')) el('message').textContent = 'Returned from PayPal. This return URL is not payment evidence. Read provider state, then capture after approval.';
    await refresh();
  } catch (error) { el('message').textContent = error.message; }
})();
