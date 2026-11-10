import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CheckoutError } from './checkout-contract.mjs';
import { collectRunEvidence } from './run-auditor.mjs';

const sourceHash = createHash('sha256').update(readFileSync(new URL('./checkout-service.mjs', import.meta.url))).digest('hex');
export const RUN_FIXTURES = Object.freeze({
  flawed: { label: 'Deliberately flawed: terminal failure after response loss', policy: 'terminal-failure' },
  corrected: { label: 'Corrected: reconcile after response loss', policy: 'reconcile' }
});
const initialVerdict = mode => ({ status: 'INCONCLUSIVE', evidenceMode: mode,
  findings: [{ code: 'MORE_EVIDENCE_REQUIRED', reason: 'Awaiting the declared fault, completion boundary, and auditor evidence.' }] });

export class LostResponseRuns {
  #busy = new Set();
  constructor(checkout) { this.checkout = checkout; this.store = checkout.store; this.now = checkout.now; }
  async #exclusive(id, work) {
    if (this.#busy.has(id)) throw new CheckoutError('RUN_BUSY', 409);
    this.#busy.add(id);
    try { return await work(); } finally { this.#busy.delete(id); }
  }
  newRun(implementation) {
    if (!Object.hasOwn(RUN_FIXTURES, implementation)) throw new CheckoutError('INVALID_FIXTURE');
    const fixture = RUN_FIXTURES[implementation];
    const id = randomUUID();
    // A run and its fresh merchant order are committed together, before any provider call.
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const order = this.checkout.newOrder({ dropCaptureResponse: true }, { runId: id, responseLossPolicy: fixture.policy });
      const run = this.store.insertRun({ id, revision: 0, scenario: 'capture_response_lost',
        implementation: { key: implementation, label: fixture.label, reference: 'src/checkout-service.mjs', sha256: sourceHash },
        evidenceMode: this.checkout.provider.evidenceMode, businessOrderId: order.id,
        createRequestId: order.createRequestId, captureRequestId: order.captureRequestId,
        fault: 'APPLICATION_RESPONSE_DISCARD_AFTER_SUCCESS',
        contract: { amountMinor: order.amountMinor, currency: order.currency, fulfillment: 'Exactly one persisted entitlement',
          boundary: 'The capture handler returns terminal failure, or merchant recovery verifies payment. Unresolved recovery stays unfinished.' },
        createdAt: this.now(), startedAt: null, completedAt: null, phase: 'PREPARING',
        timeline: [], verdict: initialVerdict(this.checkout.provider.evidenceMode), baselineVerdict: null });
      this.store.db.exec('COMMIT');
      return run;
    } catch (e) { this.store.db.exec('ROLLBACK'); throw e; }
  }
  view(id) { const run = this.store.getRun(id); return { ...run, order: this.checkout.view(run.businessOrderId) }; }
  #record(run, type, patch = {}, detail = {}) {
    return this.store.saveRun({ ...run, ...patch, timeline: [...run.timeline,
      { id: randomUUID(), sequence: run.timeline.length + 1, type, at: this.now(), ...detail }] });
  }
  async #audit(run) {
    const audit = await collectRunEvidence({ store: this.store, provider: this.checkout.provider, run, now: this.now });
    return this.store.saveRun({ ...run, verdict: audit.verdict,
      baselineVerdict: run.baselineVerdict ?? (audit.verdict.status === 'INCONCLUSIVE' ? null : { auditId: audit.id, ...audit.verdict }),
      timeline: [...run.timeline, { ...audit, sequence: run.timeline.length + 1 }] });
  }
  prepare(id) {
    return this.#exclusive(id, async () => {
      let run = this.store.getRun(id);
      if (run.startedAt !== null) throw new CheckoutError('RUN_ALREADY_STARTED', 409);
      const order = await this.checkout.create(run.businessOrderId);
      run = this.#record(run, 'PROVIDER_ORDER_PREPARED', { phase: order.paypalOrderId ? 'AWAITING_APPROVAL' : 'PREPARING' },
        { paypalOrderId: order.paypalOrderId });
      await this.#audit(run);
      return this.view(id);
    });
  }
  audit(id) { return this.#exclusive(id, async () => { await this.#audit(this.store.getRun(id)); return this.view(id); }); }
  #boundary(run, order) {
    const terminal = order.faultInjected && (order.state === 'FAILED' || (order.paid && order.evidenceStatus === 'VERIFIED'));
    return this.#record(run, terminal ? 'MERCHANT_BOUNDARY_REACHED' : 'MERCHANT_WINDOW_UNFINISHED', {
      completedAt: terminal ? this.now() : null, phase: terminal ? 'COMPLETED' : 'AWAITING_RECOVERY'
    }, { merchantState: order.state, paid: order.paid, fulfillmentCount: order.fulfillmentCount,
      merchantEvents: order.events.filter(e => ['CAPTURE_REQUESTED', 'TEST_CAPTURE_RESPONSE_DROPPED', 'FIXTURE_TERMINAL_FAILURE', 'BOUND_CAPTURE_VERIFIED', 'READ_BACK_UNRESOLVED'].includes(e.type)) });
  }
  execute(id) {
    return this.#exclusive(id, async () => {
      let run = this.store.getRun(id);
      const order = this.store.get(run.businessOrderId);
      if (run.completedAt !== null || order.faultInjected) throw new CheckoutError('USE_AUDIT_OR_EXPLICIT_RECOVERY', 409);
      if (run.implementation.sha256 !== sourceHash) throw new CheckoutError('IMPLEMENTATION_CHANGED_CREATE_NEW_RUN', 409);
      run = this.#record(run, 'MERCHANT_EXECUTION_STARTED', { phase: 'EXECUTING', startedAt: run.startedAt ?? this.now(), completedAt: null, verdict: initialVerdict(run.evidenceMode) });
      // A crash leaves EXECUTING persisted, so subsequent audits remain inconclusive.
      const result = await this.checkout.capture(run.businessOrderId);
      run = this.#boundary(run, result);
      await this.#audit(run);
      return this.view(id);
    });
  }
  recover(id) {
    return this.#exclusive(id, async () => {
      let run = this.store.getRun(id);
      if (!this.store.get(run.businessOrderId).faultInjected) throw new CheckoutError('FAULT_NOT_OBSERVED', 409);
      // Preserve the broken state as an observation BEFORE explicitly repairing the merchant.
      run = await this.#audit(run);
      run = this.#record(run, 'EXPLICIT_MERCHANT_RECOVERY_STARTED', { completedAt: null, phase: 'RECOVERING', verdict: initialVerdict(run.evidenceMode) });
      const order = await this.checkout.reconcile(run.businessOrderId);
      // A failed explicit read must not turn the old terminal failure into a new completed boundary.
      if (!order.paid || order.evidenceStatus !== 'VERIFIED') {
        run = this.#record(run, 'RECOVERY_UNFINISHED', { phase: 'AWAITING_RECOVERY' });
      } else { run = this.#boundary(run, order); }
      await this.#audit(run);
      return this.view(id);
    });
  }
}
