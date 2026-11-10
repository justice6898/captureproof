// Historical estimate policy, extracted unchanged for credential-free runtime imports.
// Not current pricing authorization; recheck official prices before any paid request.
import {DiagnosisError} from './diagnosis-contract.mjs';
export const PRICING = Object.freeze({ checked: '2026-10-19', source: 'https://developers.openai.com/api/docs/pricing',
  inputPerMillion: 2, cacheWritePerMillion: 2.5, outputPerMillion: 10, regionalReserve: 1.1, shortContextLimit: 272000 });
const roundUp = dollars => Math.ceil(dollars * 1e6) / 1e6;
export function costPreflight(body) {
  if (body.model !== 'gpt-6.1-sol' || body.reasoning?.effort !== 'medium' || body.service_tier !== 'default' || body.tools ||
      body.max_output_tokens !== 6000 || !body.instructions || !body.text?.format?.schema || !Array.isArray(body.input)) throw new DiagnosisError('SINGLE_EVALUATION_CONFIG_MISMATCH');
  const requestBytes = Buffer.byteLength(JSON.stringify(body));
  // Conservative byte-level allowance, not a four-characters/token heuristic. Count the
  // ENTIRE serialized request (including schema/instructions/escaping) plus framing reserve.
  const framingTokenReserve = 8192;
  const inputTokenUpperEstimate = requestBytes + framingTokenReserve;
  if (inputTokenUpperEstimate > PRICING.shortContextLimit) throw new DiagnosisError('COST_BOUND_UNAVAILABLE');
  const maximumUsd = roundUp((inputTokenUpperEstimate * PRICING.cacheWritePerMillion + body.max_output_tokens * PRICING.outputPerMillion) / 1e6 * PRICING.regionalReserve);
  if (maximumUsd > 0.30) throw new DiagnosisError('COST_LIMIT_EXCEEDED');
  return { requestBytes, framingTokenReserve, inputTokenUpperEstimate, maxOutputTokens: body.max_output_tokens,
    maximumUsd, pricing: PRICING, assumptions: 'All input charged at cache-write rate; no cache discount; additional 10% regional reserve. Full JSON byte allowance plus 8192 framing tokens. Output cap includes reasoning and visible tokens. No tools or premium tier.' };
}
export function usageCost(usage) {
  if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens)) return null;
  const writeTokens = usage.input_tokens_details?.cache_write_tokens;
  const knownWrites = Number.isSafeInteger(writeTokens) && writeTokens >= 0 && writeTokens <= usage.input_tokens;
  const usageBasedEstimateUsd = knownWrites ? roundUp(((usage.input_tokens - writeTokens) * PRICING.inputPerMillion + writeTokens * PRICING.cacheWritePerMillion + usage.output_tokens * PRICING.outputPerMillion) / 1e6) : null;
  return { usageBasedEstimateUsd, reportedCacheWriteTokens: knownWrites ? writeTokens : null,
    standardNoDiscountEstimateUsd: roundUp((usage.input_tokens * PRICING.inputPerMillion + usage.output_tokens * PRICING.outputPerMillion) / 1e6),
    conservativePremiumEstimateUsd: roundUp((usage.input_tokens * PRICING.cacheWritePerMillion + usage.output_tokens * PRICING.outputPerMillion) / 1e6 * PRICING.regionalReserve),
    confirmedBilling: false, note: 'Usage-based estimates, not a billing receipt. standardNoDiscountEstimateUsd is the base-rate subtotal before cache-write uplift; usageBasedEstimateUsd includes reported writes. No regional surcharge is asserted for the global endpoint; the premium estimate retains a 10% reserve. Reasoning is included in output_tokens, not charged twice.' };
}
// A separately authorized contract verification gets one durable slot; prior history is never reset.

// Read-only accounting projection shared by the live view and portable reports.
// Missing usage is unknown; a known pre-dispatch failure is not a billed attempt.
export function diagnosisCostReceipt(record) {
  const cost = usageCost(record.usage), notSent = record.dispatchPhase === 'NOT_SENT';
  return { requestIdentity: record.requestContext?.requestIdentity ?? null,
    requestHash: record.requestContext?.requestHash ?? null,
    preflightCost: record.requestContext?.cost ?? null, cost,
    costUnresolved: !notSent && cost === null,
    unresolvedMaximumEstimateUsd: !notSent && cost === null ? record.requestContext?.cost?.maximumUsd ?? null : null,
    billingConfirmed: false };
}
