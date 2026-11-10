import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/verdict.mjs';
import { runExperiment, SCENARIOS } from '../src/experiment.mjs';
import { validatePlan } from '../src/plan-contract.mjs';

for (const scenario of SCENARIOS) {
  test(`${scenario}: detects the seeded merchant bug`, async () => {
    assert.equal((await runExperiment({ scenario, implementation: 'seeded-bug' })).verdict.status, 'FAIL');
  });
  test(`${scenario}: fixed fixture satisfies the narrow experiment`, async () => {
    assert.equal((await runExperiment({ scenario })).verdict.status, 'PASS');
  });
}

async function complete() { return (await runExperiment({ scenario: 'duplicate_webhook' })).observation; }
test('missing provider coverage cannot become PASS', async () => {
  const o = await complete(); o.provider.complete = false;
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('unfinished recovery is not prematurely reported as failure', async () => {
  const o = await complete(); o.settled = false; o.merchant.paid = false; o.merchant.fulfillmentCount = 0;
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('a capture from another order cannot authorize fulfillment', async () => {
  const o = await complete(); o.provider.captures[0].orderId = 'UNRELATED';
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('wrong currency evidence is rejected', async () => {
  const o = await complete(); o.provider.captures[0].currency = 'EUR';
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('pending capture cannot justify paid state', async () => {
  const o = await complete(); o.provider.captures[0].status = 'PENDING';
  assert.equal(evaluate(o).status, 'FAIL');
});
test('duplicate observation of one capture is not double counted', async () => {
  const o = await complete(); o.provider.captures.push(structuredClone(o.provider.captures[0]));
  assert.equal(evaluate(o).status, 'PASS');
});
test('conflicting observations must be reconciled first', async () => {
  const o = await complete(); o.provider.captures.push({ ...o.provider.captures[0], amountMinor: 500 });
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('underpayment cannot authorize full fulfillment', async () => {
  const o = await complete(); o.provider.captures[0].amountMinor = 1199;
  assert.ok(evaluate(o).findings.some(f => f.code === 'PAID_WITHOUT_CAPTURE'));
});
test('an absent capture is not a successful capture experiment', async () => {
  const o = await complete(); o.provider.captures = []; o.merchant.paid = false; o.merchant.fulfillmentCount = 0;
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('noninteger money is rejected', async () => {
  const o = await complete(); o.provider.captures[0].amountMinor = 12.34;
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('a malformed capture observation stays inconclusive instead of crashing', async () => {
  const o = await complete(); o.provider.captures = [null];
  assert.equal(evaluate(o).status, 'INCONCLUSIVE');
});
test('fixed handler tolerates 1..100 repeated deliveries', async () => {
  for (let deliveries = 1; deliveries <= 100; deliveries++) {
    const r = await runExperiment({ scenario: 'duplicate_webhook', deliveries, label: `repeat-${deliveries}` });
    assert.equal(r.observation.merchant.fulfillmentCount, 1);
    assert.equal(r.verdict.status, 'PASS');
  }
});
test('buggy handler is detected for all 2..100 repeated deliveries', async () => {
  for (let deliveries = 2; deliveries <= 100; deliveries++) {
    const r = await runExperiment({ scenario: 'duplicate_webhook', implementation: 'seeded-bug', deliveries });
    assert.equal(r.verdict.status, 'FAIL');
  }
});
test('bounded AI plan accepts cited known scenarios', () => {
  assert.equal(validatePlan([{ scenario: 'approval_only', reason: 'The fixture mentions early fulfillment.', evidenceRefs: ['code:12'] }], ['code:12']).length, 1);
});
test('AI cannot add arbitrary execution fields', () => {
  assert.throws(() => validatePlan([{ scenario: 'approval_only', reason: 'test', evidenceRefs: ['code:12'], command: 'do-anything' }], ['code:12']));
});
test('AI cannot invent supporting evidence', () => {
  assert.throws(() => validatePlan([{ scenario: 'approval_only', reason: 'test', evidenceRefs: ['invented'] }], ['code:12']));
});
test('AI cannot request an unsupported financial action', () => {
  assert.throws(() => validatePlan([{ scenario: 'refund_all', reason: 'test', evidenceRefs: ['code:12'] }], ['code:12']));
});
