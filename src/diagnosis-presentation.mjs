import {readFileSync} from 'node:fs';
let reviews={};
try{reviews=JSON.parse(readFileSync(new URL('../evaluation/diagnosis-reviews.json',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
import { hash, PROMPT_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION, validateDiagnosis } from './diagnosis-contract.mjs';
import { renderMonetaryClaims } from './diagnosis-money.mjs';

// Read-time metadata only: never migrate or rewrite historical model responses/status.
export function diagnosisPresentation(record, input = record.input) {
  const review = reviews[record.id];
  const semanticReview = review && review.resultSha256 === hash(record.result) ? review : null;
  let currentValidation = 'NOT_VALIDATED', validationError = null;
  if (semanticReview?.reuseAllowed === false) currentValidation = 'REVIEW_REJECTED';
  else if (record.promptVersion !== PROMPT_VERSION || record.schemaVersion !== SCHEMA_VERSION || record.validatorVersion !== VALIDATOR_VERSION) currentValidation = 'HISTORICAL_CONTRACT';
  else if (record.status === 'succeeded') {
    try { validateDiagnosis(record.result, input); currentValidation = 'ACCEPTED'; }
    catch (e) { currentValidation = 'REJECTED'; validationError = e.code ?? 'INVALID_SAVED_DIAGNOSIS'; }
  }
  const reusable = currentValidation === 'ACCEPTED';
  return { ...record, semanticReview, currentValidation, validationError, reusable,
    renderedResult: reusable ? renderMonetaryClaims(record.result) : null };
}
