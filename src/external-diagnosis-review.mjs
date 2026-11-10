import { readFileSync } from 'node:fs';
import { hash } from './diagnosis-contract.mjs';

// Read-time annotation only; generated responses and their original validation never change.
export function externalSemanticReview(record, reviews) {
  if (reviews === undefined) {
    try { reviews = JSON.parse(readFileSync(new URL('../evaluation/external-diagnosis-reviews.json', import.meta.url), 'utf8')); }
    catch { return null; }
  }
  const review = reviews[record.id];
  return review && review.resultSha256 === hash(record.result) && review.fingerprint === record.fingerprint ? review : null;
}

export function externalOfflineRevalidations(record, annotations) {
  if (annotations === undefined) {
    try { annotations = JSON.parse(readFileSync(new URL('../evaluation/external-offline-revalidations.json', import.meta.url), 'utf8')); }
    catch { return []; }
  }
  return (annotations[record.id] ?? []).filter(a => a.historicalRecordSha256 === hash(record) && a.approvedReuse === false);
}
