import { randomUUID } from 'node:crypto';
import { buildDiagnosisInput } from './diagnosis-input.mjs';
import { hash, PROMPT_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION, INSTRUCTIONS, DIAGNOSIS_SCHEMA, DiagnosisError, validateDiagnosis } from './diagnosis-contract.mjs';
import { withMonetaryFacts } from './diagnosis-money.mjs';
import { diagnosisPresentation } from './diagnosis-presentation.mjs';

export class DiagnosisService {
  #active = new Map();
  constructor({ orders, records, provider, buildInput = buildDiagnosisInput, now = Date.now, contract = null, attemptContext = null, beforeDispatch = null }) {
    Object.assign(this, { orders, records, provider, buildInput, now, attemptContext, beforeDispatch });
    this.contract = contract ?? { PROMPT_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION, INSTRUCTIONS, DIAGNOSIS_SCHEMA, validate: validateDiagnosis, present: diagnosisPresentation };
    this.present = (record, input) => this.contract.present(record, input);
  }
  prepare(id) {
    const { PROMPT_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION, INSTRUCTIONS, DIAGNOSIS_SCHEMA } = this.contract;
    const original = this.buildInput(this.orders, id);
    const bundle = { ...original, input: withMonetaryFacts(original.input) };
    const fingerprint = hash({ input: bundle.input, provenance: bundle.provenance, config: this.provider.config,
      providerMode: this.provider.mode, prompt: INSTRUCTIONS, schema: DIAGNOSIS_SCHEMA, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, validatorVersion: VALIDATOR_VERSION });
    return { bundle, fingerprint };
  }
  view(id) {
    const { bundle, fingerprint } = this.prepare(id);
    const history = this.records.list(id);
    const isRunning = r => r.status === 'running' && this.now() - r.createdAt <= (r.config?.timeoutMs ?? this.provider.config.timeoutMs) + 5000;
    return { configured: this.provider.configured, unavailableReason: this.provider.configured ? null : this.provider.unavailableReason, model: this.provider.config.model, reasoning: this.provider.config.reasoning,
      fingerprint, running: this.#active.has(id) || history.some(isRunning), records: history.map(r => ({
        ...this.present(r, r.fingerprint === fingerprint ? bundle.input : r.input),
        ...(r.status === 'running' && !isRunning(r) ? { status: 'failed', error: 'AI_INTERRUPTED' } : {}),
        matchesCurrentInputs: r.fingerprint === fingerprint })) };
  }
  analyze(id) {
    if (this.#active.has(id)) return this.#active.get(id);
    const work = Promise.resolve().then(() => this.#analyze(id));
    this.#active.set(id, work);
    return work.finally(() => this.#active.delete(id));
  }
  async #analyze(id) {
    const { PROMPT_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION, INSTRUCTIONS, DIAGNOSIS_SCHEMA } = this.contract;
    const { bundle, fingerprint } = this.prepare(id);
    const previous = this.records.list(id).filter(r => r.fingerprint === fingerprint);
    const saved = previous.map(r => this.present(r, bundle.input)).find(r => r.reusable);
    if (saved) return { ...saved, saved: true };
    if (!this.provider.configured) throw new DiagnosisError(this.provider.unavailableReason ?? 'AI_NOT_CONFIGURED');
    const start = this.now();
    let record = { id: randomUUID(), runId: id, fingerprint, status: 'running', providerAttempt: true,
      mode: this.provider.mode, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, validatorVersion: VALIDATOR_VERSION, promptHash: hash(INSTRUCTIONS), schemaHash: hash(DIAGNOSIS_SCHEMA),
      requestedModel: this.provider.config.model, returnedModel: null, responseStatus: null, config: this.provider.config,
      createdAt: start, finishedAt: null, latencyMs: null, usage: null, error: null, result: null,
      input: bundle.input, sourceProvenance: bundle.provenance, sourceMappings: bundle.mappings, literalAliases: bundle.aliases };
    if (this.attemptContext) record.requestContext = this.attemptContext({ bundle, fingerprint });
    if (this.beforeDispatch) record.dispatchPhase = 'NOT_SENT';
    const reserved = this.records.reserve(record, this.provider.config.maxAttempts, this.provider.config.timeoutMs, this.present);
    if (reserved.id !== record.id) return { ...this.present(reserved, bundle.input), saved: true };
    let metadata = {}, candidate, finalized = false, lateMetadata;
    try {
      const output = await this.provider.analyze(bundle.input, { clientRequestId: record.id,
        ...(this.beforeDispatch ? { beforeDispatch: async requestBody => {
          await this.beforeDispatch({ bundle, fingerprint, record, requestBody });
          const dispatchRecord = { ...record, dispatchPhase: 'TRANSMISSION_POSSIBLE' };
          this.records.save(dispatchRecord);
          record = dispatchRecord;
        } } : {}), onLateMetadata: late => {
        lateMetadata = late;
        if (finalized && record.error === 'AI_TIMEOUT') {
          record = { ...record, lateTransportMetadata: late, costReconciliationRequired: late.usageStatus === 'REPORTED' };
          this.records.save(record);
        }
      } });
      candidate = output.result;
      metadata = { ...Object.fromEntries(['clientRequestId', 'providerRequestId', 'effectiveDeadlineMs', 'elapsedMs', 'transportAttempts', 'localCancellation', 'providerOutcome', 'usageStatus', 'returnedServiceTier'].filter(k => output[k] !== undefined).map(k => [k, output[k]])), metadataOmissions: output.metadataOmissions ?? [], responseStatus: output.responseStatus ?? null, returnedModel: output.returnedModel, responseId: output.responseId, usage: output.usage };
      const result = this.contract.validate(output.result, bundle.input);
      record = { ...record, ...metadata, result, status: 'succeeded' };
    } catch (error) {
      record = { ...record, ...metadata, ...(error instanceof DiagnosisError ? error.metadata : {}), status: 'failed',
        error: error instanceof DiagnosisError ? error.code : 'AI_INTERNAL_ERROR' };
    }
    record.finishedAt = this.now(); record.latencyMs = record.finishedAt - start;
    if (record.status === 'failed') record.rejectedReview = this.records.retainRejected(record, candidate, DIAGNOSIS_SCHEMA);
    if (lateMetadata && record.error === 'AI_TIMEOUT') Object.assign(record, { lateTransportMetadata: lateMetadata, costReconciliationRequired: lateMetadata.usageStatus === 'REPORTED' });
    this.records.save(record); finalized = true;
    return { ...this.present(record, bundle.input), saved: false };
  }
}
