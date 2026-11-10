// Retain the tested host row-reuse path; tighten only replay eligibility.
const previous = require('./capture-recovery.cjs');
const { APPLICATION_REPLAY_WINDOW_MS } = require('./capture-contract.cjs');
function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function canReplay(operation, policy = {}) {
  if (!operation) return false;
  const now = (policy.now ?? Date.now)();
  const created = timestamp(operation.created_at), updated = timestamp(operation.updated_at);
  const window = policy.replayWindowMs;
  return ['documented-endpoint','simulator'].includes(policy.retentionBasis) &&
    Number.isSafeInteger(policy.providerRetentionMs) && policy.providerRetentionMs >= window &&
    Number.isSafeInteger(window) && window > 0 && window <= APPLICATION_REPLAY_WINDOW_MS &&
    Number.isSafeInteger(now) && Number.isFinite(created) && Number.isFinite(updated) &&
    created <= updated && updated <= now && now - created >= 0 && now - created < window &&
    ['submitted','reserved','ambiguous'].includes(operation.state) && operation.capture_id === null;
}
module.exports = { ...previous, canReplay };
