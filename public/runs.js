(() => {
  const el = id => document.getElementById(id);
  let selected = new URLSearchParams(location.search).get('run') ?? '';
  let config;
  let busy = false;
  const date = value => value === null ? 'Not reached' : new Date(value).toISOString();
  async function api(path, data) {
    const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Request failed');
    return result;
  }
  function show(run) {
    window.dispatchEvent(new CustomEvent('captureproof-run', { detail: run?.id ?? null }));
    el('run-actions').hidden = !run;
    el('run-summary').replaceChildren(); el('run-findings').replaceChildren(); el('run-timeline').replaceChildren();
    el('run-json').textContent = run ? JSON.stringify(run, null, 2) : 'No run selected.';
    if (!run) return;
    const audit = run.timeline.findLast(e => e.type === 'AUDIT_READ_ONLY');
    const p = audit?.observation.provider;
    const m = audit?.observation.merchant;
    const fields = {
      Scenario: run.scenario, Implementation: run.implementation.label, 'Evidence mode': run.evidenceMode,
      Verdict: run.verdict.status, 'Initial completed verdict': run.baselineVerdict?.status ?? 'Not established',
      'Observation window': run.phase, 'Completion boundary': date(run.completedAt),
      'Provider state (last audit)': p ? `${p.orderStatus ?? 'Unavailable'} / ${p.captures.map(c => c.status).join(', ') || 'No capture evidence'}` : 'Not observed',
      'Merchant state (last audit)': m ? `${m.state}; paid=${m.paid}` : 'Not observed',
      'Persisted fulfillment count (last audit)': m?.fulfillmentCount ?? 'Not observed',
      'Business order': run.businessOrderId, 'PayPal order': run.order.paypalOrderId ?? 'Not created',
      'Capture (last audit)': p?.captures.map(c => c.id).join(', ') || 'Not observed'
    };
    for (const [label, value] of Object.entries(fields)) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = String(value);
      el('run-summary').append(dt, dd);
    }
    for (const finding of run.verdict.findings) {
      const item = document.createElement('li'); item.textContent = `${finding.code}: ${finding.reason}`; el('run-findings').append(item);
    }
    for (const event of run.timeline) {
      const item = document.createElement('li');
      const observation = event.observation;
      const detail = observation ? ` — ${event.verdict.status}; provider ${observation.provider.orderStatus ?? 'unavailable'}, merchant ${observation.merchant.state}, paid=${observation.merchant.paid}, fulfillment=${observation.merchant.fulfillmentCount}` : '';
      item.textContent = `${event.sequence}. ${date(event.at)} — ${event.type}${detail}`;
      if (event.merchantEvents?.length) {
        const text = document.createElement('p'); text.textContent = event.merchantEvents.map(e => `${date(e.at)}: ${e.type}`).join(' → '); item.append(text);
      }
      el('run-timeline').append(item);
    }
    el('run-approve').hidden = !run.order.approvalUrl || run.order.faultInjected;
    if (run.order.approvalUrl) el('run-approve').href = run.order.approvalUrl;
    el('run-prepare').disabled = busy || !config.configured || Boolean(run.order.paypalOrderId);
    el('run-execute').disabled = busy || !config.configured || !run.order.paypalOrderId || run.order.faultInjected;
    el('run-audit').disabled = busy || !run.order.paypalOrderId;
    el('run-recover').disabled = busy || !run.order.faultInjected || run.order.paid;
  }
  async function refresh() {
    const runs = await api('/api/runs');
    el('runs').replaceChildren(new Option('Select a run', ''), ...runs.map(r => new Option(`${r.implementation.key} — ${r.verdict.status} — ${r.id}`, r.id)));
    el('runs').value = selected;
    show(selected ? await api(`/api/runs/${selected}`) : null);
  }
  function creationControls() {
    for (const name of ['flawed', 'corrected']) el(`new-${name}`).disabled = busy || !config?.configured || !config?.testFaultsEnabled;
  }
  async function action(work) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('#run-panel button, #run-panel select').forEach(e => { e.disabled = true; });
    el('run-approve').hidden = true; el('run-message').textContent = 'Working…';
    try { await work(); el('run-message').textContent = 'Recorded. Collect evidence never repairs the merchant; explicit recovery is a separate action.'; }
    catch (error) { el('run-message').textContent = error.message; }
    finally { busy = false; el('runs').disabled = false; creationControls(); try { await refresh(); } catch (error) { el('run-message').textContent = error.message; } }
  }
  for (const implementation of ['flawed', 'corrected']) el(`new-${implementation}`).onclick = () => action(async () => {
    const run = await api('/api/runs', { implementation });
    selected = run.id; history.replaceState(null, '', `/?run=${selected}`);
    await api(`/api/runs/${selected}/prepare`, {});
  });
  el('runs').onchange = () => action(async () => { selected = el('runs').value; history.replaceState(null, '', selected ? `/?run=${selected}` : '/'); });
  for (const operation of ['prepare', 'execute', 'audit', 'recover']) el(`run-${operation}`).onclick = () => action(() => api(`/api/runs/${selected}/${operation}`, {}));
  (async () => {
    try {
      config = await api('/api/config'); creationControls(); await refresh();
      if (!config.testFaultsEnabled) el('run-message').textContent = 'New comparison runs require ENABLE_TEST_FAULTS=true on the server. Saved results remain available.';
    } catch (error) { el('run-message').textContent = error.message; }
  })();
})();
