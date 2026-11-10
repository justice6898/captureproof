import { randomUUID } from 'node:crypto';
import { PRODUCT, PROVIDER_ID, RETRY_WINDOW_MS, CheckoutError, approvalUrl, inspectProviderOrder } from './checkout-contract.mjs';

export class CheckoutService {
  #queues = new Map();
  constructor({ store, provider, origin, enableTestFaults = false, now = Date.now }) {
    Object.assign(this, { store, provider, origin, enableTestFaults, now });
  }
  newOrder({ dropCaptureResponse = false } = {}, experiment = null) {
    if (dropCaptureResponse && !this.enableTestFaults) throw new CheckoutError('TEST_FAULTS_DISABLED', 403);
    if (experiment && (!dropCaptureResponse || !['terminal-failure', 'reconcile'].includes(experiment.responseLossPolicy))) throw new CheckoutError('INVALID_EXPERIMENT');
    return this.store.insert({ id: randomUUID(), productName: PRODUCT.name, amountMinor: PRODUCT.amountMinor,
      currency: PRODUCT.currency, origin: this.origin, revision: 0, createdAt: this.now(),
      createRequestId: randomUUID(), captureRequestId: randomUUID(), createStartedAt: null, captureStartedAt: null,
      paypalOrderId: null, captureId: null, captureResponseId: null, approvalUrl: null,
      state: 'NEW', paid: false, evidenceStatus: 'INCONCLUSIVE', evidenceMode: this.provider.evidenceMode,
      lastEvidence: null, lastError: null, dropCaptureResponse, faultInjected: false, events: [],
      ...(experiment ? { experimentRunId: experiment.runId, responseLossPolicy: experiment.responseLossPolicy } : {}) });
  }
  view(id) { return { ...this.store.get(id), fulfillmentCount: this.store.fulfillmentCount(id) }; }
  // Serializes actions on one order in this process. SQL constraints also protect durable identity.
  async #serial(id, action) {
    const previous = this.#queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.#queues.set(id, next);
    try { return await next; } finally { if (this.#queues.get(id) === next) this.#queues.delete(id); }
  }
  #save(order, type, patch = {}) {
    return this.store.save({ ...order, ...patch, events: [...order.events,
      { id: randomUUID(), type, at: this.now(), ...(patch.lastError ? { code: patch.lastError } : {}) }] });
  }
  #errorCode(error) { return error instanceof CheckoutError ? error.code : 'INTERNAL_OPERATION_ERROR'; }
  #retryAllowed(started) { return started === null || (this.now() >= started && this.now() - started < RETRY_WINDOW_MS); }
  create(id) {
    return this.#serial(id, async () => {
      let order = this.store.get(id);
      if (order.paypalOrderId) return this.view(id);
      if (!this.provider.configured) throw new CheckoutError('SANDBOX_CREDENTIALS_MISSING', 503);
      if (!this.#retryAllowed(order.createStartedAt)) throw new CheckoutError('CREATE_RETRY_WINDOW_EXPIRED', 409);
      order = this.#save(order, 'CREATE_REQUESTED', { createStartedAt: order.createStartedAt ?? this.now(), state: 'CREATING', lastError: null });
      let raw;
      try { raw = await this.provider.create(order); }
      catch (error) {
        this.#save(order, 'CREATE_UNRESOLVED', { state: 'INCONCLUSIVE', lastError: this.#errorCode(error) });
        return this.view(id);
      }
      if (typeof raw?.id !== 'string' || !PROVIDER_ID.test(raw.id)) {
        this.#save(order, 'CREATE_UNRESOLVED', { state: 'INCONCLUSIVE', lastError: 'PAYPAL_INVALID_ORDER_RESPONSE' });
        return this.view(id);
      }
      order = this.#save(order, 'PROVIDER_ORDER_BOUND', { paypalOrderId: raw.id, approvalUrl: approvalUrl(raw), state: 'AWAITING_APPROVAL' });
      await this.#read(order);
      return this.view(id);
    });
  }
  async #read(order) {
    let raw;
    try { raw = await this.provider.get(order.paypalOrderId); }
    catch (error) {
      order = this.#save(order, 'READ_BACK_UNRESOLVED', { state: order.paid ? 'PAID' : 'INCONCLUSIVE',
        evidenceStatus: 'INCONCLUSIVE', lastError: this.#errorCode(error) });
      return { order, inspection: null };
    }
    const inspection = inspectProviderOrder(raw, order);
    const patch = { state: order.paid ? 'PAID' : inspection.state, evidenceStatus: 'INCONCLUSIVE', lastError: inspection.reason };
    if (inspection.valid) {
      patch.lastEvidence = { ...inspection.evidence, id: randomUUID(), observedAt: this.now(), source: this.provider.evidenceMode, operation: 'GET_ORDER' };
      patch.approvalUrl = approvalUrl(raw) ?? order.approvalUrl;
      if (order.captureStartedAt !== null && !inspection.paid && inspection.canCapture) patch.state = 'PENDING';
      if (inspection.paid) Object.assign(patch, { paid: true, state: 'PAID', captureId: inspection.captureId,
        evidenceStatus: 'VERIFIED', lastError: null, approvalUrl: null });
    }
    order = this.#save(order, inspection.paid ? 'BOUND_CAPTURE_VERIFIED' : 'READ_BACK_INCONCLUSIVE', patch);
    return { order, inspection };
  }
  reconcile(id) {
    return this.#serial(id, async () => {
      const order = this.store.get(id);
      if (!order.paypalOrderId) throw new CheckoutError('PROVIDER_ORDER_MISSING', 409);
      await this.#read(order);
      return this.view(id);
    });
  }
  capture(id) {
    return this.#serial(id, async () => {
      let order = this.store.get(id);
      if (!order.paypalOrderId) throw new CheckoutError('PROVIDER_ORDER_MISSING', 409);
      // Isolated seeded fixture: a repeated capture action must not silently repair its failure.
      if (order.experimentRunId && order.responseLossPolicy === 'terminal-failure' && order.faultInjected) return this.view(id);
      // Read before every attempt, including retries and process restarts.
      const read = await this.#read(order);
      order = read.order;
      if (order.paid || !read.inspection?.valid || !read.inspection.canCapture) return this.view(id);
      if (!this.#retryAllowed(order.captureStartedAt)) {
        this.#save(order, 'CAPTURE_RETRY_BLOCKED', { state: 'INCONCLUSIVE', lastError: 'CAPTURE_RETRY_WINDOW_EXPIRED' });
        return this.view(id);
      }
      order = this.#save(order, 'CAPTURE_REQUESTED', { captureStartedAt: order.captureStartedAt ?? this.now(), state: 'CAPTURING', lastError: null });
      let raw;
      try { raw = await this.provider.capture(order.paypalOrderId, order.captureRequestId); }
      catch (error) {
        order = this.#save(order, 'CAPTURE_RESPONSE_UNRESOLVED', { state: 'PENDING', lastError: this.#errorCode(error) });
      }
      if (raw) {
        const inspection = inspectProviderOrder(raw, order);
        if (order.dropCaptureResponse && !order.faultInjected && inspection.paid) {
          // Test-only merchant fault: discard a validated success before consuming its capture ID.
          raw = undefined;
          order = this.#save(order, 'TEST_CAPTURE_RESPONSE_DROPPED', { faultInjected: true, state: 'PENDING' });
          if (order.experimentRunId && order.responseLossPolicy === 'terminal-failure') {
            this.#save(order, 'FIXTURE_TERMINAL_FAILURE', { state: 'FAILED', lastError: 'CAPTURE_RESPONSE_LOST_TERMINAL' });
            return this.view(id);
          }
        } else {
          order = this.#save(order, 'CAPTURE_RESPONSE_RECEIVED', {
            captureResponseId: inspection.valid && inspection.captureId ? inspection.captureId : order.captureResponseId,
            state: 'PENDING'
          });
        }
      }
      // Neither an HTTP success nor a capture response writes paid/fulfillment state.
      await this.#read(order);
      return this.view(id);
    });
  }
}
