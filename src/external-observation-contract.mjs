import { DiagnosisError } from './diagnosis-contract.mjs';

export const OBSERVATION_VERSION = 'external-observations-2';
export const OBSERVATION_RULE = 'Zero is observed, not unknown. Only declared optional controller counters and an unavailable database use null for unrecorded observations. A recorded null capturedAt means unset, not missing. State fields are required in normalized observations; not-applicable is not supported. Never borrow another checkpoint or visibility scope.';
const fail = () => { throw new DiagnosisError('MALFORMED_STATE_EVIDENCE'); };
export const validCount = value => Number.isSafeInteger(value) && value >= 0;
export function stateFieldMap(fields) {
  const prefix = fields.phase === 'unfinished_interrupt' ? 'provider.' : '';
  return { capturePostAttempts: `${prefix}capturePostAttempts`, distinctProviderCaptures: `${prefix}distinctCaptureCount`,
    databaseCaptureRows: 'database.captureRowCount', merchantCapturedAt: 'database.payment.capturedAt' };
}

export function validateStateObservation(fields) {
  const scopes = { unfinished_interrupt: 'controller_only', before_recovery: 'controller_collected_persisted_merchant_state',
    returned_call: 'controller_only_counters_and_independent_database', unfinished_call: 'controller_only_counters_and_independent_database' };
  if (!fields || !scopes[fields.phase] || fields.visibility !== scopes[fields.phase]) fail();
  const map = stateFieldMap(fields), counterPrefix = fields.phase === 'unfinished_interrupt' ? 'provider.' : '';
  if (!['recorded', 'not_recorded'].includes(fields.counterObservation) || typeof fields['database.available'] !== 'boolean') fail();
  if (fields.phase === 'before_recovery' && fields.counterObservation !== 'not_recorded') fail();
  for (const key of [map.capturePostAttempts, map.distinctProviderCaptures, `${counterPrefix}acceptedOperations`]) {
    if (!Object.hasOwn(fields, key) || (fields.counterObservation === 'recorded' ? !validCount(fields[key]) : fields[key] !== null)) fail();
  }
  for (const key of [map.databaseCaptureRows, map.merchantCapturedAt]) if (!Object.hasOwn(fields, key)) fail();
  const rows = fields[map.databaseCaptureRows], captured = fields[map.merchantCapturedAt];
  if (!fields['database.available']) { if (rows !== null || captured !== null) fail(); }
  else if (!validCount(rows) || !(captured === null || typeof captured === 'string' && Number.isFinite(Date.parse(captured)))) fail();
}

export function validateStateClaims(claims, input) {
  if (input.contract?.observationSemanticsVersion !== OBSERVATION_VERSION) throw new DiagnosisError('OBSERVATION_CONTRACT_MISMATCH');
  if (!Array.isArray(claims) || claims.length > 8) throw new DiagnosisError('INVALID_STATE_CLAIMS');
  const evidence = new Map();
  if (!Array.isArray(input.evidence)) fail();
  for (const entry of input.evidence) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || !entry.fields || typeof entry.fields !== 'object' || Array.isArray(entry.fields)) fail();
    if (evidence.has(entry.id)) fail();
    evidence.set(entry.id, entry.fields);
    if (['unfinished_interrupt', 'before_recovery', 'returned_call', 'unfinished_call'].includes(entry.fields.phase)) validateStateObservation(entry.fields);
  }
  for (const claim of claims) {
    if (!claim || Object.keys(claim).sort().join(',') !== 'capturePostAttempts,databaseCaptureRows,distinctProviderCaptures,evidenceRef,merchantCapturedAt') throw new DiagnosisError('INVALID_STATE_CLAIMS');
    const fields = evidence.get(claim.evidenceRef);
    if (!fields) throw new DiagnosisError('INVALID_STATE_REFERENCE');
    validateStateObservation(fields);
    for (const [key, field] of Object.entries(stateFieldMap(fields))) if (claim[key] !== fields[field]) throw new DiagnosisError('STATE_FACT_MISMATCH');
  }
}
