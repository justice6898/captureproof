// Developer-authored feasibility example over the supplied pending/repetition trace.
// Never a model answer, expected-answer prompt, or executed repair/control result.
import { authoredRegressionControls } from './regression-controls.mjs';

export function authoredUsefulDiagnosis(input) {
  const source = role => input.sources.find(s => s.role === role);
  const cite = (role, startLine, endLine) => ({ sourceRef: source(role).id, sourceSha256: source(role).sha256, startLine, endLine });
  const fact = (evidenceRef, field) => ({ evidenceRef, field, value: input.evidence.find(e => e.id === evidenceRef).fields[field] });
  const regressionControls = authoredRegressionControls(input);
  for (const plan of regressionControls) {
    plan.evidenceRefs = plan.kind === 'repetition_restart' ? ['checkpoint-2', 'checkpoint-3', 'restart'] : ['checkpoint-1'];
    plan.evidenceGap = 'Proposed control; not executed in this response.';
    plan.reason = plan.kind === 'repetition_restart' ? 'Repeated calls and a restart snapshot are supplied.' : 'The returned PENDING checkpoint records merchant completion.';
  }
  return {
    assessment: 'issue_observed', moneyClaims: [],
    observedFacts: [fact('checkpoint-1', 'provider.capture.status'), fact('checkpoint-1', 'database.payment.capturedAt'), fact('checkpoint-3', 'capturePostAttempts')],
    findings: [
      { kind: 'supported', explanation: 'The first returned call records merchant completion although the capture is PENDING. The provider captures and retrieves an order, then accepts an order ID without checking capture completion. The host subsequently sets captured_at. An order ID is insufficient payment evidence.', evidenceRefs: ['checkpoint-1'], codeRefs: [cite('upstream_provider', 46, 65), cite('upstream_provider', 214, 240), cite('merchant_host', 319, 330)] },
      { kind: 'supported', explanation: 'Sequential repeated calls reach three capture POST attempts while the supplied snapshots retain one provider capture and one database capture row. The host helper can report an already-captured payment, but its caller still invokes capture. More POSTs do not establish more charges.', evidenceRefs: ['checkpoint-3'], codeRefs: [cite('merchant_host', 260, 294)] }
    ],
    fixDirection: { text: 'Before persisting completion, reconcile merchant-visible capture evidence bound to this payment, provider order/capture, expected amount and currency. Keep PENDING or unavailable results unresolved. Short-circuit already-completed operations before another capture POST; preserve the same operation identity and existing rows across restart. Do not substitute simulator counters for merchant-visible read-back.', evidenceRefs: ['checkpoint-1', 'checkpoint-3', 'restart'], codeRefs: [cite('upstream_provider', 214, 240), cite('merchant_host', 260, 294), cite('merchant_host', 319, 330)] },
    regressionTest: { text: 'Propose the five controls below against a candidate correction. Inspect independent provider and persisted merchant snapshots after returned calls and restart; instrument POST attempts separately. These checks are not executed repair evidence.', evidenceRefs: ['checkpoint-1', 'checkpoint-3', 'restart'], codeRefs: [] },
    regressionControls,
    stateClaims: ['checkpoint-1', 'checkpoint-3', 'restart'].map(evidenceRef => {
      const f = input.evidence.find(e => e.id === evidenceRef).fields;
      return { evidenceRef, capturePostAttempts: f.capturePostAttempts, distinctProviderCaptures: f.distinctCaptureCount, databaseCaptureRows: f['database.captureRowCount'], merchantCapturedAt: f['database.payment.capturedAt'] };
    }),
    uncertainties: ['This saved sequential Medusa/PostgreSQL execution used simulated PayPal. Restart counters were not recorded; null does not mean zero. No actual network outage, live PayPal, concurrency, fulfillment or repair safety is demonstrated. The proposed unavailable-read-back and conflicting-evidence controls need separate observations.'],
    claims: { realNetworkOutageObserved: false, duplicateChargeObserved: false, repairVerified: false, livePayPalVerified: false, concurrencyVerified: false, fulfillmentVerified: false }
  };
}
