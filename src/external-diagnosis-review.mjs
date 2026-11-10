import { readFileSync } from 'node:fs';
import { hash } from './diagnosis-contract.mjs';

export const CLAIM_REVIEW_VERSION = 'diagnosis-claim-review-1';
const nonblank = x => typeof x === 'string' && x.trim().length > 0;
// Deliberately enumerated response prose, not a natural-language grader.
export function reviewableClaims(result) {
  const fields = {};
  const add = (path, value) => { if (typeof value === 'string') fields[path] = value; };
  for (const [i, f] of (result?.findings ?? []).entries()) add(`/findings/${i}/explanation`, f.explanation);
  for (const key of ['fixDirection', 'regressionTest']) add(`/${key}/text`, result?.[key]?.text);
  for (const [i, value] of (result?.uncertainties ?? []).entries()) add(`/uncertainties/${i}`, value);
  for (const [i, c] of (result?.regressionControls ?? []).entries()) {
    for (const key of ['purpose', 'preconditions', 'reason', 'evidenceGap']) add(`/regressionControls/${i}/${key}`, c[key]);
    for (const [j, value] of c.actions.entries()) add(`/regressionControls/${i}/actions/${j}`, value);
    for (const [j, a] of c.assertions.entries()) add(`/regressionControls/${i}/assertions/${j}/observation`, a.observation);
  }
  return fields;
}
export function claimReviewBinding(record) {
  return { fingerprint: record.fingerprint, resultSha256: hash(record.result), inputSha256: hash(record.input),
    sourceSetSha256: hash(record.input?.sources ?? []), contractVersion: record.schemaVersion };
}
// Inspect annotation integrity and permission only. The reviewer supplies the substantive judgment.
export function inspectClaimReview(record, review) {
  const binding = claimReviewBinding(record);
  if (Object.entries(binding).some(([key, value]) => review?.[key] !== value)) return null;
  const invalid = reason => ({ format: CLAIM_REVIEW_VERSION, ...binding, outcome: 'INVALID_REVIEW', reuseAllowed: false,
    summary: 'Review metadata is incomplete or inconsistent; semantic approval is not established.', metadataError: reason,
    declaredOutcome: review?.outcome ?? null, claims: [], scope: null });
  if (review.format !== CLAIM_REVIEW_VERSION || !nonblank(review.method) || !nonblank(review.authorship) ||
      !nonblank(review.summary) || !Number.isFinite(Date.parse(review.reviewedAt)) || typeof review.reuseAllowed !== 'boolean' ||
      !['selected_claims', 'whole_response'].includes(review.scope?.kind) || !Array.isArray(review.scope.fields) ||
      !Array.isArray(review.claims) || review.claims.length === 0) return invalid('REVIEW_SHAPE');
  const material = reviewableClaims(record.result), evidence = new Set(record.input.evidence.map(e => e.id));
  const sources = new Map(record.input.sources.map(s => [s.id, s])), seen = new Set();
  for (const c of review.claims) {
    if (!c || !Object.hasOwn(material, c.field) || c.excerpt !== material[c.field] || seen.has(c.field) ||
        !['observation', 'inference', 'proposal', 'verification'].includes(c.classification) ||
        !['SUPPORTED', 'CONTRADICTED', 'UNSUPPORTED', 'UNRESOLVED'].includes(c.disposition) || !nonblank(c.reason) ||
        !Array.isArray(c.contextFields) || c.contextFields.some(p => !Object.hasOwn(material, p)) ||
        !Array.isArray(c.evidenceRefs) || c.evidenceRefs.some(id => !evidence.has(id)) ||
        !Array.isArray(c.codeRefs) || !(c.evidenceGap === null || nonblank(c.evidenceGap)) ||
        (!c.evidenceRefs.length && !nonblank(c.evidenceGap))) return invalid('CLAIM_BINDING_OR_REASON');
    seen.add(c.field);
    for (const ref of c.codeRefs) {
      if (!ref || typeof ref !== 'object') return invalid('REVIEW_SOURCE_BINDING');
      const source = sources.get(ref.sourceRef);
      if (!source || source.sha256 !== ref.sourceSha256 || source.revision !== source.sha256 ||
          !Number.isSafeInteger(ref.startLine) || !Number.isSafeInteger(ref.endLine) || ref.startLine < 1 ||
          ref.endLine < ref.startLine || ref.endLine - ref.startLine + 1 > source.lines.length ||
          !source.lines.some(l => l.line >= ref.startLine && l.line <= ref.endLine && l.text.trim()) ||
          Array.from({ length: ref.endLine - ref.startLine + 1 }, (_, i) => ref.startLine + i).some(n => !source.lines.some(l => l.line === n))) return invalid('REVIEW_SOURCE_BINDING');
    }
  }
  if (review.scope.fields.length !== seen.size || new Set(review.scope.fields).size !== seen.size ||
      review.scope.fields.some(p => !seen.has(p))) return invalid('REVIEW_SCOPE');
  const unreviewedFields = Object.keys(material).filter(p => !seen.has(p));
  if (review.scope.kind === 'whole_response' && unreviewedFields.length) return invalid('INCOMPLETE_WHOLE_REVIEW');
  const scopeOutcome = review.claims.some(c => ['CONTRADICTED', 'UNSUPPORTED'].includes(c.disposition)) ? 'FAIL'
    : review.claims.some(c => c.disposition === 'UNRESOLVED') ? 'INCONCLUSIVE' : 'PASS';
  const outcome = scopeOutcome === 'FAIL' ? 'FAIL' : scopeOutcome === 'INCONCLUSIVE' || review.scope.kind !== 'whole_response' ? 'PARTIAL' : 'PASS';
  if (review.outcome !== outcome || (review.reuseAllowed && (outcome !== 'PASS' || unreviewedFields.length))) return invalid('OUTCOME_PERMISSION_CONFLICT');
  return { ...review, scopeOutcome, unreviewedFields, reviewedClaimCount: seen.size, materialClaimCount: Object.keys(material).length,
    metadataValidation: 'PASS', limitation: 'Metadata consistency is checked automatically. Claim meaning and citation support are judgments recorded by the named reviewer, not an automated semantic proof.' };
}

// Read-time annotation only; generated responses and their original validation never change.
export function externalSemanticReview(record, reviews) {
  if (reviews === undefined) {
    try { reviews = JSON.parse(readFileSync(new URL('../evaluation/external-diagnosis-reviews.json', import.meta.url), 'utf8')); }
    catch { return null; }
  }
  const review = reviews?.[record.id];
  if (!review || review.resultSha256 !== hash(record.result) || review.fingerprint !== record.fingerprint) return null;
  if (review.format === CLAIM_REVIEW_VERSION || ['external-diagnosis-5', 'external-diagnosis-6'].includes(record.schemaVersion)) return inspectClaimReview(record, review);
  return review; // Historical outcome and original annotation remain readable, never silently rewritten.
}
export function semanticReuseAllowed(record, review) {
  return ['external-diagnosis-5', 'external-diagnosis-6'].includes(record.schemaVersion) && review?.format === CLAIM_REVIEW_VERSION &&
    review.metadataValidation === 'PASS' && review.outcome === 'PASS' && review.scope?.kind === 'whole_response' &&
    review.unreviewedFields?.length === 0 && review.reuseAllowed === true;
}
export function externalOfflineRevalidations(record, annotations) {
  if (annotations === undefined) {
    try { annotations = JSON.parse(readFileSync(new URL('../evaluation/external-offline-revalidations.json', import.meta.url), 'utf8')); }
    catch { return []; }
  }
  return (annotations[record.id] ?? []).filter(a => a.historicalRecordSha256 === hash(record) && a.approvedReuse === false);
}

// A review of rejected text must detach when that separately retained artifact changes.
export function withRetainedResponse(record, retainedResponse) {
  const offlineRevalidations = (record.offlineRevalidations ?? []).filter(a => {
    if (a.type !== 'retained-output-review-1') return true;
    const text = retainedResponse?.messages?.[0]?.fields?.text;
    if (a.approvedReuse !== false || !retainedResponse || typeof text !== 'string' ||
        a.retainedArtifactSha256 !== hash(retainedResponse) || a.retainedTextSha256 !== hash(text) ||
        a.inputSha256 !== hash(record.input) || a.sourceSetSha256 !== hash(record.input?.sources ?? []) ||
        a.fingerprint !== record.fingerprint || a.resultSha256 !== hash(record.result) || !Array.isArray(a.claims)) return false;
    return a.claims.every(c => c && Number.isSafeInteger(c.startOffset) && Number.isSafeInteger(c.endOffset) &&
      c.startOffset >= 0 && c.endOffset > c.startOffset && c.endOffset <= text.length &&
      c.excerpt === text.slice(c.startOffset,c.endOffset));
  });
  return { ...record, retainedResponse, offlineRevalidations };
}
