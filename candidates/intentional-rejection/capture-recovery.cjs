// Narrow host-side extension for the pinned Medusa full-capture contract.
// No controller evidence or crash flag enters these decisions.
const { createHash } = require('node:crypto');
const operationId = binding => 'cp_'+createHash('sha256').update(JSON.stringify(['full-capture',binding.sessionId,binding.orderId,binding.authorizationId])).digest('hex').slice(0,32);
function canReplay(operation, policy) {
  const now = (policy.now ?? Date.now)();
  const age = now - new Date(operation.created_at).getTime();
  return policy.retentionVerified === true && Number.isSafeInteger(policy.replayWindowMs) && policy.replayWindowMs > 0 &&
    policy.replayWindowMs <= 3600000 && Number.isFinite(age) && age >= 0 && age < policy.replayWindowMs &&
    ['submitted','reserved','ambiguous'].includes(operation.state) && operation.capture_id === null;
}
function installCaptureRecovery(service, operations, math) {
  const normal = service.capturePayment_.bind(service);
  service.capturePayment_ = async (data, payment, context) => {
    const binding = payment.data?.captureBinding;
    if (payment.captured_at || !payment.captures.length) return normal(data,payment,context);
    // A committed tentative row is not completed payment. Reuse it only for
    // this single, exact full capture; the normal provider gate still runs.
    if (payment.canceled_at || !binding || binding.currency !== 'USD' || !binding.sessionId || !binding.orderId || !binding.authorizationId ||
        payment.captures.length !== 1 || !math.eq(data.amount ?? payment.amount,payment.raw_amount) ||
        !math.eq(payment.captures[0].raw_amount,payment.raw_amount) || !math.eq(math.mult(payment.raw_amount,100),binding.amountMinor)) throw new Error('CAPTURE_ATTEMPT_RECOVERY_UNSUPPORTED');
    const operation = await operations.read(operationId(binding), binding);
    if (!operation) throw new Error('CAPTURE_OPERATION_REQUIRED');
    return {isFullyCaptured:true,capture:payment.captures[0]};
  };
}
module.exports = { canReplay, installCaptureRecovery, operationId };
