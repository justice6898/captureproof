import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePersistence } from '../src/external-persistence.mjs';
import { persistenceObservation, changeCommitted } from '../test-support/persistence-observations.mjs';

test('confirmed payment identity mismatch survives an unfinished reconciliation window', () => {
  const trace = changeCommitted(persistenceObservation(), rows => { rows.payment[0].id = 'other-payment'; });
  const before = structuredClone(trace);
  const open = evaluatePersistence(trace);
  const closed = evaluatePersistence({ ...trace, completionWindowOpen: false });
  assert.equal(open.status, 'FAIL');
  assert.equal(open.rules.find(r => r.id === 'EXACT_BINDING')?.status, 'FAIL');
  assert.equal(closed.rules.find(r => r.id === 'EXACT_BINDING')?.status, 'FAIL');
  assert.deepEqual(trace, before);
});

import { assessPersistence } from '../src/external-persistence.mjs';
import { projectVerificationExecution } from '../src/external-report.mjs';
import { scenarioFinding, checkpointDescription } from '../public/verification-state.mjs';
import { reportHTML } from '../src/portable-report.mjs';

test('valid open window retains passing binding but makes no completion claim; closed window requires completion', () => {
  const t = persistenceObservation(), open = evaluatePersistence(t);
  assert.equal(open.status, 'INCONCLUSIVE');
  assert.equal(open.rules.find(r => r.id === 'EXACT_BINDING').status, 'PASS');
  assert.equal(open.rules.some(r => r.id === 'COMPLETED_CAPTURE_RECORDED'), false);
  assert.equal(evaluatePersistence({ ...t, completionWindowOpen: false }).status, 'FAIL');
});

test('observed money and relationship violations survive unknown provider outcomes', () => {
  const cases = [
    rows => { rows.payment[0].amount = '13'; },
    rows => { rows.payment_session[0].currency_code = 'EUR'; },
    rows => { rows.payment[0].payment_collection_id = 'other-collection'; }
  ];
  for (const mutate of cases) {
    const result = evaluatePersistence(changeCommitted(persistenceObservation({ status: 'UNKNOWN' }), mutate));
    assert.equal(result.status, 'FAIL');
    assert.equal(result.rules[0].status, 'FAIL');
    assert.equal(result.uncertainty.status, 'INCONCLUSIVE');
  }
  assert.equal(evaluatePersistence(persistenceObservation({ status: 'UNKNOWN' })).status, 'INCONCLUSIVE');
});

test('missing or untrustworthy evidence is not converted into a violation', () => {
  for (const mutate of [
    t => { delete t.afterShutdown; },
    t => { t.isolation.networkBlocked = false; },
    t => { t.afterShutdown.rows.payment[0].id = 'conflicting-read'; },
    t => { t.events[1].body.id = 'conflicting-provider'; },
    t => { t.events = t.events.filter(e => e.kind !== 'provider_response'); },
    t => { changeCommitted(t, rows => { delete rows.payment[0].raw_amount; }); },
    t => { changeCommitted(t, rows => { delete rows.payment_session[0].currency_code; }); }
  ]) {
    const trace = persistenceObservation(); mutate(trace);
    const verdict = evaluatePersistence(trace);
    assert.equal(verdict.status, 'INCONCLUSIVE');
    assert.ok(verdict.rules.every(r => r.status !== 'FAIL'));
  }
});

test('versioned reassessment keeps recorded verdict; JSON, UI meaning and HTML retain failure plus uncertainty', () => {
  const trace = changeCommitted(persistenceObservation(), rows => { rows.payment[0].id = 'wrong'; });
  trace.verdict = { status: 'INCONCLUSIVE', rules: [], eventualCompletion: 'UNTESTED' };
  const original = structuredClone(trace), assessment = assessPersistence(trace);
  assert.equal(assessment.version, 'persistence-assessment-2');
  assert.equal(assessment.current.status, 'FAIL');
  assert.deepEqual(assessment.recorded, trace.verdict);
  assert.deepEqual(trace, original);
  const run = { runId: '00000000-0000-4000-8000-000000000001', implementation: 'original', evidenceMode: 'SIMULATED_PROVIDER_REAL_MEDUSA_POSTGRES', checkpoints: [trace], comparisonStatus: 'INCONCLUSIVE', events: trace.events, contract: trace.contract, provenance: { versions: {} }, hashes: {}, finishedAt: '2026-11-10T00:00:00Z' };
  const projection = projectVerificationExecution(run);
  assert.equal(projection.checkpoints[0].verdict.status, 'INCONCLUSIVE');
  assert.equal(projection.checkpoints[0].assessment.current.status, 'FAIL');
  const fresh = structuredClone(projection);fresh.verdict = 'FAIL';fresh.checkpoints[0].verdict = assessment.current;
  assert.match(scenarioFinding(fresh, null).finding, /identity, money or persisted relationships/);
  assert.doesNotMatch(scenarioFinding(fresh, null).finding, /did not record completed payment/);
  assert.match(checkpointDescription(fresh.checkpoints[0]), /FAIL.*Unresolved/);
  const exported = JSON.parse(JSON.stringify(projection));
  assert.deepEqual(exported.checkpoints[0].assessment, assessment);
  const html = reportHTML({ primary: { execution: projection } });
  const embedded = JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(embedded.primary.execution.checkpoints[0].assessment, assessment);
  assert.match(html, /Separate current assessment/);
});

test('completed bookkeeping requires exactly one row even during an open observation window', () => {
  const t = persistenceObservation();
  changeCommitted(t, rows => {
    rows.payment[0].captured_at = '2026-11-10T00:00:00Z';
    Object.assign(rows.payment_collection[0], { captured_amount: '12', status: 'completed', completed_at: '2026-11-10T00:00:00Z' });
    rows.capture = [{ id: 'db-capture-1', payment_id: t.ids.payment, amount: '12', raw_amount: { value: '12' } }];
    rows.payment[0].data.paypalOrder.purchaseUnits[0].payments.captures = [{ id: t.ids.capture, status: 'COMPLETED', amount: { currencyCode: 'USD', value: '12.00' } }];
  });
  assert.equal(evaluatePersistence(t).status, 'PASS');
  changeCommitted(t, rows => rows.capture.push({ ...rows.capture[0], id: 'db-capture-2' }));
  const duplicate = evaluatePersistence(t);
  assert.equal(duplicate.status, 'FAIL');
  assert.equal(duplicate.rules.find(r => r.id === 'EXACT_BINDING').status, 'PASS');
  assert.equal(duplicate.rules.find(r => r.id === 'COMPLETED_CAPTURE_RECORDED').status, 'FAIL');
});
