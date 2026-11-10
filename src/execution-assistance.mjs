import { withRetainedResponse } from './external-diagnosis-review.mjs';
import { DiagnosisService } from './diagnosis-service.mjs';
import { executionDiagnosisBundle } from './execution-diagnosis.mjs';
import { disabledExternalProvider, EXTERNAL_CONFIG } from './external-diagnosis-service.mjs';
import { EXTERNAL_CONTRACT } from './external-diagnosis-contract.mjs';
import { costPreflight, diagnosisCostReceipt } from './diagnosis-cost.mjs';
import { EXECUTION_PRICING_REVIEW, executionApproval } from './execution-assistance-policy.mjs';
import { DiagnosisError, hash } from './diagnosis-contract.mjs';

// Exact-run admission wraps the existing diagnosis service. Workers remain offline.
export class ExecutionAssistance {
  constructor({ jobs, records, provider = disabledExternalProvider(), approval = () => null, requireAuthorization = false, now = Date.now }) {
    Object.assign(this, { jobs, records, provider, approval, now });
    this.requireAuthorization = requireAuthorization || provider.mode !== 'mock-transport';
    this.services = new Map();
    if (hash(provider.config) !== hash(EXTERNAL_CONFIG)) throw new DiagnosisError('EXECUTION_AI_CONFIG_MISMATCH');
    if (provider.configured) {
      provider.preserveResponse = value => records.retainResponse(value);
      const previous = provider.beforeRequest;
      provider.beforeRequest = async text => {
        costPreflight(JSON.parse(text));
        if (previous) await previous(text);
      };
    }
  }

  prepare(jobId, runId) {
    const prepared = this.jobs.prepareExecution(jobId, runId);
    if (prepared.jobId !== jobId || prepared.executionId !== runId ||
        prepared.input.execution.runId !== runId || hash(JSON.stringify(prepared.request)) !== prepared.requestHash) {
      throw new DiagnosisError('EXECUTION_DIAGNOSIS_IDENTITY_MISMATCH');
    }
    if (hash(this.provider.config) !== hash(EXTERNAL_CONFIG)) throw new DiagnosisError('EXECUTION_AI_CONFIG_MISMATCH');
    const bundle = executionDiagnosisBundle(prepared), boundHash = hash(bundle);
    const probe = new DiagnosisService({ records: this.records, provider: this.provider,
      contract: EXTERNAL_CONTRACT, buildInput: () => bundle });
    const id = 'execution:' + runId, { fingerprint } = probe.prepare(id);
    const request = this.provider.requestBody(bundle.input), requestHash = hash(JSON.stringify(request));
    if (requestHash !== prepared.requestHash) throw new DiagnosisError('EXECUTION_AI_CONFIG_MISMATCH');
    let cost;
    try { cost = { status: 'ESTIMATE_NOT_AUTHORIZATION', ...costPreflight(request),
      policyVersion: 'diagnosis-cost-2026-10-19', pricingReviewDate: '2026-11-10',
      note: 'Rates rechecked against official pricing on 2026-11-10; recheck again before live authorization. This is an estimated upper bound, not settled billing. Reasoning is included in the output limit.' }; }
    catch (error) { cost = { status: 'BLOCKED', reason: error.code ?? 'COST_BOUND_UNAVAILABLE' }; }
    const requestIdentity = hash({ jobId, runId, fingerprint, requestHash, cost, pricingReview: EXECUTION_PRICING_REVIEW });
    const preview = { jobId, executionId: runId, requestIdentity, fingerprint, requestHash,
      contractVersion: prepared.contractVersion, config: this.provider.config, input: bundle.input,
      provenance: bundle.provenance, request, cost, pricingReview: EXECUTION_PRICING_REVIEW };
    let authorization = null, unavailableReason = null;
    if (this.requireAuthorization) {
      try { authorization = executionApproval(preview, this.approval(), this.now()); }
      catch (error) { unavailableReason = error.code; }
    }
    if (!this.provider.configured) unavailableReason = this.provider.unavailableReason ?? 'AI_NOT_CONFIGURED';
    if (cost.status === 'BLOCKED') unavailableReason = cost.reason;
    const validateBoundInput = () => {
      const current = executionDiagnosisBundle(this.jobs.prepareExecution(jobId, runId));
      if (hash(current) !== boundHash || hash(this.provider.config) !== hash(EXTERNAL_CONFIG)) {
        throw new DiagnosisError('EXECUTION_AI_PREVIEW_CHANGED');
      }
      return current;
    };
    if (!this.services.has(requestIdentity)) {
      this.services.set(requestIdentity, new DiagnosisService({ records: this.records, provider: this.provider,
        contract: EXTERNAL_CONTRACT,
        buildInput: validateBoundInput,
        attemptContext: () => {
          const grant = this.requireAuthorization ? executionApproval(preview, this.approval(), this.now()) : null;
          return { jobId, executionId: runId, requestIdentity, requestHash, fingerprint, cost,
            authorization: grant, pricingIsConfirmedBilling: false };
        },
        beforeDispatch: ({ record, requestBody }) => {
          validateBoundInput();
          if (hash(requestBody) !== requestHash || hash(costPreflight(JSON.parse(requestBody))) !== hash(costPreflight(request))) {
            throw new DiagnosisError('EXECUTION_AI_PREVIEW_CHANGED');
          }
          if (this.requireAuthorization) {
            const grant = executionApproval(preview, this.approval(), this.now());
            if (grant.approvalHash !== record.requestContext.authorization?.approvalHash) throw new DiagnosisError('EXECUTION_AI_NOT_AUTHORIZED');
          }
          const reserved = this.records.list(id).find(r => r.id === record.id);
          if (!reserved || reserved.status !== 'running' || reserved.requestContext?.requestIdentity !== requestIdentity ||
              reserved.requestContext?.requestHash !== requestHash) throw new DiagnosisError('AI_RESERVATION_MISMATCH');
        }
      }));
    }
    const core = this.services.get(requestIdentity);
    const previous = this.records.list(id).find(r => r.fingerprint === fingerprint && r.providerAttempt);
    return { core, id, preview: { ...preview,
      dispatchEnabled: !previous && !unavailableReason,
      unavailableReason, authorization,
      transport: this.provider.mode === 'mock-transport' ? 'INJECTED_TEST_TRANSPORT' : 'OPENAI_LIVE',
      records: this.records.list(id).filter(r=>r.providerAttempt&&(r.fingerprint===fingerprint||(hash(r.input)===hash(bundle.input)&&hash(r.sourceProvenance)===hash(bundle.provenance)))).map(r=>this.presentAttempt(core,r,preview)),
      limits: 'One attempt for this exact input. No automatic retry, including after interruption or unknown usage. Explanation is not a payment verdict or repair verification.' } };
  }

  presentAttempt(core, record, preview) {
    const result = withRetainedResponse(core.present(record, record.input), this.records.retainedResponse?.(record.id) ?? null);
    const interrupted = result.status === 'running' && this.now() - result.createdAt > this.provider.config.timeoutMs + 5000;
    const notSent = record.dispatchPhase === 'NOT_SENT';
    const receipt = diagnosisCostReceipt(record);
    return { ...result, ...receipt, saved: true,
      ...(interrupted ? { status: 'failed', error: 'AI_INTERRUPTED', ...(!notSent ? { providerOutcome: 'UNKNOWN', usageStatus: 'UNKNOWN' } : {}) } : {}),
      requestIdentity: record.requestContext?.requestIdentity ?? preview.requestIdentity, attemptConsumed: true,
      ...(notSent ? { providerOutcome: 'NOT_SENT', transportAttempts: 0 } : {}),
      unresolvedMaximumEstimateUsd: receipt.costUnresolved ? receipt.unresolvedMaximumEstimateUsd ?? preview.cost.maximumUsd ?? null : null,
      retainedResponse: result.retainedResponse,
      billingConfirmed: false
    };
  }

  preview(jobId, runId) { return this.prepare(jobId, runId).preview; }

  async analyze(jobId, runId, consent) {
    const { core, id, preview } = this.prepare(jobId, runId);
    if (!consent || Object.keys(consent).sort().join(',') !== 'confirm,requestIdentity' ||
        consent.confirm !== true || consent.requestIdentity !== preview.requestIdentity) {
      throw new DiagnosisError('EXECUTION_AI_PREVIEW_CHANGED');
    }
    const previous = this.records.list(id).find(r => r.fingerprint === preview.fingerprint && r.providerAttempt);
    if (previous) return this.presentAttempt(core, previous, preview);
    if (!preview.dispatchEnabled) throw new DiagnosisError(preview.unavailableReason ?? 'EXTERNAL_LIVE_DISPATCH_DISABLED');
    const result = await core.analyze(id);
    const stored = this.records.list(id).find(r => r.id === result.id);
    return { ...this.presentAttempt(core, stored, preview), saved: result.saved };
  }
}
