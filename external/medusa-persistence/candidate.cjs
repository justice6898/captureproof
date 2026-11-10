// Authored repair overlay. The published provider remains byte-for-byte intact.
const { createHash } = require('node:crypto');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const minor = value => {
  const s = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const [a,b=''] = s.split('.');
  return (BigInt(a)*100n+BigInt(b.padEnd(2,'0'))).toString();
};
module.exports = (Original, sdk, operations) => class CompletionGatedPaypal extends Original {
  async initiatePayment(input) {
    const output = await super.initiatePayment(input);
    const amountMinor = minor(input.amount);
    if (!amountMinor || BigInt(amountMinor)<=0n || input.currency_code!=='USD' || !input.context?.idempotency_key) fail('BINDING_REQUIRED');
    output.data.captureBinding = { sessionId:input.context.idempotency_key, orderId:output.id, amountMinor, currency:'USD' };
    return output;
  }
  async authorizePayment(input) {
    const output = await super.authorizePayment(input);
    const binding = input.data.captureBinding;
    const order = output.data.paypalOrder;
    const auth = order?.purchaseUnits?.[0]?.payments?.authorizations;
    if (!binding || auth?.length!==1 || !auth[0].id) fail('AUTHORIZATION_BINDING_REQUIRED');
    const bound = { ...binding, authorizationId:auth[0].id };
    this.validateOrder(order,bound);
    output.data.captureBinding = bound;
    return output;
  }
  validateOrder(order,binding) {
    const units=order?.purchaseUnits, auth=units?.[0]?.payments?.authorizations;
    if(order?.id!==binding.orderId || order.intent!=='AUTHORIZE' || units?.length!==1 ||
       minor(units[0].amount?.value)!==binding.amountMinor || units[0].amount?.currencyCode!==binding.currency ||
       auth?.length!==1 || auth[0].id!==binding.authorizationId || minor(auth[0].amount?.value)!==binding.amountMinor || auth[0].amount?.currencyCode!==binding.currency) fail('ORDER_BINDING_MISMATCH');
  }
  validateCapture(capture,binding,id) {
    if(!capture?.id || (id && capture.id!==id) || minor(capture.amount?.value)!==binding.amountMinor ||
       capture.amount?.currencyCode!==binding.currency || capture.finalCapture!==true) fail('CAPTURE_BINDING_MISMATCH');
  }
  async capturePayment(input) {
    const binding=input.data.captureBinding;
    if(!binding?.sessionId || !binding.authorizationId || !binding.orderId || binding.currency!=='USD') fail('DURABLE_BINDING_REQUIRED');
    // Independent of the tentative Medusa capture-row ID, which cleanup deletes.
    const operationId='cp_'+createHash('sha256').update(JSON.stringify(['full-capture',binding.sessionId,binding.orderId,binding.authorizationId])).digest('hex').slice(0,32);
    const payments=new sdk.PaymentsController(this.paypal_);
    const lookup=async()=>{
      try { const result=(await new sdk.OrdersController(this.paypal_).getOrder({id:binding.orderId})).result;this.validateOrder(result,binding);return result; }
      catch(e) { if(e.code)throw e;fail('LOOKUP_UNAVAILABLE'); }
    };
    let order=await lookup();
    let operation=await operations.read(operationId,binding);
    let captures=order.purchaseUnits[0].payments.captures??[];
    if(captures.length>1)fail('MULTIPLE_CAPTURES_UNRESOLVED');
    if(!captures.length) {
      // A durable send barrier is committed BEFORE the SDK call. Even after a
      // crash, absent read-back cannot silently cause a second POST. This favors
      // safety: crash-before-send needs explicit investigation, not auto retry.
      if(operation)fail(operation.state==='definitive_rejection'?'CAPTURE_DEFINITIVELY_REJECTED':'CAPTURE_OUTCOME_UNRESOLVED');
      const auth=order.purchaseUnits[0].payments.authorizations[0];
      if(auth.status!=='CREATED')fail('AUTHORIZATION_NOT_CAPTURABLE');
      if(!await operations.reserve(operationId,binding))fail('CAPTURE_OUTCOME_UNRESOLVED');
      const value=BigInt(binding.amountMinor);
      const body={amount:{currencyCode:binding.currency,value:`${value/100n}.${String(value%100n).padStart(2,'0')}`},finalCapture:true};
      let result;
      try { result=(await payments.captureAuthorizedPayment({authorizationId:binding.authorizationId,paypalRequestId:operationId,prefer:'return=representation',body})).result; }
      catch(e) {
        // Only this documented business rejection is considered definitive.
        const issue=e.result?.details?.[0]?.issue;
        await operations.update(operationId,{state:e.statusCode===422&&issue==='AUTHORIZATION_EXPIRED'?'definitive_rejection':'ambiguous'});
        fail(e.statusCode===422&&issue==='AUTHORIZATION_EXPIRED'?'CAPTURE_DEFINITIVELY_REJECTED':'CAPTURE_OUTCOME_UNRESOLVED');
      }
      this.validateCapture(result,binding);
      await operations.update(operationId,{captureId:result.id,state:'observed'});
      order=await lookup();
      captures=order.purchaseUnits[0].payments.captures??[];
      operation=await operations.read(operationId,binding);
      if(captures.length!==1)fail('CAPTURE_READBACK_REQUIRED');
    }
    const capture=captures[0];
    this.validateCapture(capture,binding,operation?.capture_id);
    let detail;
    try { detail=(await payments.getCapturedPayment({captureId:capture.id})).result; }
    catch { fail('CAPTURE_LOOKUP_UNAVAILABLE'); }
    this.validateCapture(detail,binding,capture.id);
    const related=detail.supplementaryData?.relatedIds;
    if(related?.orderId!==binding.orderId || related?.authorizationId!==binding.authorizationId || detail.status!==capture.status)fail('CAPTURE_EVIDENCE_CONFLICT');
    await operations.observe(operationId,binding,capture.id,capture.status);
    if(capture.status!=='COMPLETED')fail(capture.status==='PENDING'?'CAPTURE_PENDING':'CAPTURE_NOT_COMPLETED');
    return {data:{...input.data,paypalOrderId:binding.orderId,paypalOrder:order}};
  }
};
