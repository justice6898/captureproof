import { readFileSync } from 'node:fs';
import { hash, DiagnosisError } from './diagnosis-contract.mjs';
import { PRICING } from './diagnosis-cost.mjs';

// Manual official-document review, not an online pricing probe or a billing guarantee.
export const EXECUTION_PRICING_REVIEW = Object.freeze({
  checked: '2026-11-10', expiresAt: '2026-11-12T00:00:00.000Z',
  source: 'https://developers.openai.com/api/docs/pricing',
  modelSource: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
  ratesHash: hash(PRICING)
});
export const readExecutionApproval = path => () => {
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; } // Missing or corrupt approval fails closed; never print its contents.
};
export function executionApproval(preview, approval, now = Date.now()) {
  const pricing = EXECUTION_PRICING_REVIEW;
  if (now < Date.parse(pricing.checked) || now >= Date.parse(pricing.expiresAt) || pricing.ratesHash !== hash(PRICING)) {
    throw new DiagnosisError('AI_PRICING_REVIEW_EXPIRED');
  }
  if (!approval || approval.authorized !== true || approval.maxAttempts !== 1 ||
      approval.jobId !== preview.jobId || approval.executionId !== preview.executionId ||
      approval.requestIdentity !== preview.requestIdentity || approval.requestHash !== preview.requestHash ||
      approval.costHash !== hash(preview.cost) || approval.pricingReviewHash !== hash(pricing) ||
      !Number.isFinite(approval.maximumUsd) || approval.maximumUsd < preview.cost.maximumUsd || approval.maximumUsd > .30 ||
      !Number.isFinite(Date.parse(approval.expiresAt)) || now >= Date.parse(approval.expiresAt) ||
      Date.parse(approval.expiresAt) > Date.parse(pricing.expiresAt)) {
    throw new DiagnosisError('EXECUTION_AI_NOT_AUTHORIZED');
  }
  return { approvalHash: hash(approval), maximumUsd: preview.cost.maximumUsd,
    expiresAt: approval.expiresAt, maxAttempts: 1, pricingReview: pricing };
}
// A private capability captured by the trusted launcher before the offline guard loads.
// It is never assigned to global fetch or passed to candidate workers.
export function responseOnlyTransport(transport) {
  return (url, options) => {
    if (url !== 'https://api.openai.com/v1/responses' || options?.method !== 'POST' || options.redirect !== 'error') {
      throw new DiagnosisError('AI_TRANSPORT_SCOPE_REJECTED');
    }
    return transport(url, options);
  };
}
