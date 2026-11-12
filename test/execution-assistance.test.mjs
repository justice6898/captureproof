import { authoredUsefulDiagnosis } from '../test-support/useful-diagnosis.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExecutionAssistance } from '../src/execution-assistance.mjs';
import { DiagnosisStore } from '../src/diagnosis-store.mjs';
import { OpenAIDiagnosis } from '../src/openai-diagnosis.mjs';
import { EXTERNAL_CONFIG, disabledExternalProvider } from '../src/external-diagnosis-service.mjs';
import { EXTERNAL_CONTRACT } from '../src/external-diagnosis-contract.mjs';
import { EXECUTION_PRICING_REVIEW, executionApproval, responseOnlyTransport } from '../src/execution-assistance-policy.mjs';
import { hash, DiagnosisError } from '../src/diagnosis-contract.mjs';
const html = readFileSync(new URL('../data/portable-reports/upstream-pending-replayed-2026-10-29/report.html', import.meta.url), 'utf8');
const preparation = JSON.parse(html.match(/id="report-data">(.*?)<\/script>/s)[1]).primary.analysis;
preparation.request = disabledExternalProvider().requestBody(preparation.input);
preparation.requestHash = hash(JSON.stringify(preparation.request));
const output = authoredUsefulDiagnosis;
// Offline authorization fixtures have a fixed time inside the recorded pricing window.
// Real production expiry and approval records are not extended.
const fixtureClock = () => Date.parse('2026-11-11T12:00:00.000Z');
async function fixture(t, { rejected = false, fail = false, outcome = null, incompleteReason = undefined, gated = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cp-assistance-'));
  let db = new DatabaseSync(join(dir, 'requests.sqlite')); await DiagnosisStore.open(db);
  const records = new DiagnosisStore(db, { reviewDirectory: join(dir, 'reviews'), sensitiveValues: [] });
  const jobs = { prepareExecution: (jobId, runId) => { assert.equal(jobId, preparation.jobId); assert.equal(runId, preparation.executionId); return structuredClone(preparation); } };
  let calls = 0;
  const provider = new OpenAIDiagnosis({ apiKey: 'offline-test-placeholder', config: EXTERNAL_CONFIG, contract: EXTERNAL_CONTRACT,
    fetchImpl: async (_url, options) => {
      calls++; if (fail) throw Error('injected connection interruption');
      if(outcome === 'timeout') { const error = new DiagnosisError('AI_TIMEOUT'); throw error; }
      if(['auth','rate','model'].includes(outcome)) return new Response('{}', { status: {auth:401,rate:429,model:404}[outcome] });
      if(outcome === 'provider-error') return new Response('{}', { status: 503 });
      const request = JSON.parse(options.body); assert.equal(request.max_output_tokens, 6000);
      assert.doesNotMatch(request.input[0].content, /comparisonStatus|recordedVerdict|expectedAnswer/);
      const input = JSON.parse(request.input[0].content);
      const result = rejected ? {} : output(input);
      if(outcome === 'missing-control') result.regressionControls = result.regressionControls.filter(c => c.kind !== 'unavailable_readback');
      if(outcome === 'invalid-citation') result.findings[0].codeRefs[0].sourceRef = 'absent-source';
      const part = outcome === 'refusal' ? { type: 'refusal', refusal: 'Injected refusal.' }
        : { type: 'output_text', text: outcome === 'malformed' ? '{' : outcome === 'whitespace-incomplete' ? '{"observedFacts":[' + ' \t'.repeat(1000) : JSON.stringify(result) };
      return new Response(JSON.stringify({ id: 'offline_response', model: EXTERNAL_CONFIG.model, status: ['incomplete','whitespace-incomplete'].includes(outcome) ? 'incomplete' : 'completed', incomplete_details: {reason: incompleteReason},
        usage: { input_tokens: 100, output_tokens: 200, output_tokens_details: { reasoning_tokens: 100 } },
        output: [{ type: 'message', content: [part] }] }));
    } });
  let approval = null;
  const approvalReader = () => approval;
  const service = new ExecutionAssistance({ jobs, records, provider, requireAuthorization: gated, approval: approvalReader, now: fixtureClock });
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { service, jobs, records, provider, db, approvalReader, setApproval: value => { approval = value; }, calls: () => calls, reopen: () => { db.close(); db = new DatabaseSync(join(dir, 'requests.sqlite')); return new DiagnosisStore(db, { reviewDirectory: join(dir, 'reviews'), sensitiveValues: [] }); } };
}
const preview = f => f.service.preview(preparation.jobId, preparation.executionId);
const send = (f, p = preview(f)) => f.service.analyze(p.jobId, p.executionId, { confirm: true, requestIdentity: p.requestIdentity });
test('exact preview is read-only, cost-bounded and default live dispatch remains disabled', async t => {
  const f = await fixture(t), p = preview(f);
  assert.equal(f.calls(), 0); assert.equal(f.records.list('execution:' + p.executionId).length, 0);
  assert.ok(p.cost.maximumUsd <= .30); assert.equal(p.config.automaticRetries, 0); assert.equal(p.config.maxAttempts, 1);
  assert.equal(p.requestHash, preparation.requestHash);
  const disabled = new ExecutionAssistance({ jobs: f.jobs, records: f.records });
  const blocked = disabled.preview(p.jobId, p.executionId);
  assert.equal(blocked.dispatchEnabled, false);
  await assert.rejects(disabled.analyze(p.jobId, p.executionId, { confirm: true, requestIdentity: blocked.requestIdentity }), { code: 'EXTERNAL_LIVE_DISPATCH_DISABLED' });
  assert.equal(f.calls(), 0);
});
test('concurrent duplicates and reopened controller retain one durable response and its review boundary', async t => {
  const f = await fixture(t), p = preview(f);
  const [a, b] = await Promise.all([send(f, p), send(f, p)]);
  assert.equal(a.currentValidation, 'ACCEPTED', a.error); assert.equal(a.id, b.id); assert.equal(f.calls(), 1);
  assert.equal(a.semanticReviewStatus, 'NOT_REVIEWED');
  assert.ok(f.records.retainedResponse(a.id)); assert.deepEqual(a.result, output(p.input)); assert.equal(a.regressionGuidance.status, 'COMPLETE_STRUCTURE');
  assert.equal(f.records.list('execution:' + p.executionId)[0].requestContext.requestIdentity, p.requestIdentity);
  const restarted = new ExecutionAssistance({ jobs: f.jobs, records: f.reopen(), provider: f.provider });
  const reused = await restarted.analyze(p.jobId, p.executionId, { confirm: true, requestIdentity: p.requestIdentity });
  assert.equal(reused.id, a.id); assert.equal(reused.saved, true); assert.equal(f.calls(), 1);
});
test('stale input/source/config or mismatched consent is rejected before a reservation', async t => {
  const f = await fixture(t), p = preview(f);
  await assert.rejects(send(f, { ...p, requestIdentity: 'other' }), { code: 'EXECUTION_AI_PREVIEW_CHANGED' });
  const build = f.jobs.prepareExecution;
  f.jobs.prepareExecution = (...args) => { const q = build(...args); q.input.sources[0].sha256 = '0'.repeat(64); return q; };
  await assert.rejects(send(f, p), { code: 'EXECUTION_AI_CONFIG_MISMATCH' });
  assert.equal(f.calls(), 0); assert.equal(f.records.list('execution:' + p.executionId).length, 0);
});
test('rejected response is retained privately and repeat submit never retries it', async t => {
  const f = await fixture(t, { rejected: true }), p = preview(f), first = await send(f, p);
  assert.equal(first.status, 'failed'); assert.equal(first.currentValidation, 'NOT_VALIDATED'); assert.equal(first.error, 'INVALID_STATE_CLAIMS'); assert.equal(first.result, null);
  assert.equal(f.records.list('execution:' + p.executionId)[0].rejectedReview.retained, true);
  assert.ok(f.records.retainedResponse(first.id));
  assert.equal((await send(f, p)).id, first.id); assert.equal(f.calls(), 1);
});
test('unknown usage after interrupted transport consumes the attempt and never assumes free success', async t => {
  const f = await fixture(t, { fail: true }), p = preview(f), first = await send(f, p);
  assert.equal(first.status, 'failed'); assert.equal(first.cost, null);
  assert.equal(first.attemptConsumed, true);
  assert.equal((await send(f, p)).id, first.id); assert.equal(f.calls(), 1);
});

test('interrupted persisted reservation remains consumed without transport after controller restart', async t => {
  const f = await fixture(t), p = preview(f);
  const { core, id } = f.service.prepare(p.jobId, p.executionId);
  const before = { id: '00000000-0000-4000-8000-000000000099', runId: id, fingerprint: p.fingerprint, status: 'running',
    providerAttempt: true, mode: 'mock-transport', config: EXTERNAL_CONFIG, createdAt: 1,
    promptVersion: preparation.contractVersion, schemaVersion: preparation.contractVersion, validatorVersion: preparation.contractVersion, input: p.input, result: null };
  f.records.reserve(before, 1, EXTERNAL_CONFIG.timeoutMs, core.present);
  const restarted = new ExecutionAssistance({ jobs: f.jobs, records: f.reopen(), provider: f.provider });
  const result = await restarted.analyze(p.jobId, p.executionId, { confirm: true, requestIdentity: p.requestIdentity });
  assert.equal(result.id, before.id); assert.equal(result.saved, true); assert.equal(result.attemptConsumed, true);
  assert.equal(result.cost, null); assert.equal(result.error, 'AI_INTERRUPTED'); assert.equal(result.providerOutcome, 'UNKNOWN'); assert.equal(result.costUnresolved, true); assert.equal(f.calls(), 0);
});

test('citation, JSON, refusal, incomplete, timeout and provider failures each stop after one injected attempt', async t => {
  const cases = [ ['invalid-citation', 'SOURCE_REVISION_MISMATCH'], ['malformed', 'AI_INVALID_OUTPUT_JSON'],
    ['refusal', 'AI_REFUSED'], ['incomplete', 'AI_INCOMPLETE_OUTPUT'], ['timeout', 'AI_TIMEOUT'], ['provider-error', 'AI_SERVICE_UNAVAILABLE'] ];
  for (const [outcome, code] of cases) {
    const f = await fixture(t, { outcome }), p = preview(f), result = await send(f, p);
    assert.equal(result.status, 'failed', outcome); assert.equal(result.error, code, outcome);
    assert.equal(result.reusable, false); assert.equal(result.billingConfirmed, false);
    assert.equal((await send(f, p)).id, result.id); assert.equal(f.calls(), 1);
    if (['timeout', 'provider-error'].includes(outcome)) {
      assert.equal(result.providerOutcome, 'UNKNOWN'); assert.equal(result.costUnresolved, true);
      assert.equal(result.unresolvedMaximumEstimateUsd, p.cost.maximumUsd);
      assert.notEqual(result.localCancellation, true); // No real timer/cancellation is claimed by this injected error.
    } else assert.ok(f.records.retainedResponse(result.id));
  }
});

test('a changed source between consent validation and reservation cannot dispatch', async t => {
  const f = await fixture(t), p = preview(f), read = f.jobs.prepareExecution;
  let reads = 0;
  f.jobs.prepareExecution = (...args) => {
    const value = read(...args); if (++reads > 1) value.input.sources[0].sha256 = '0'.repeat(64); return value;
  };
  await assert.rejects(send(f, p), { code: 'EXECUTION_AI_PREVIEW_CHANGED' });
  assert.equal(f.calls(), 0); assert.equal(f.records.list('execution:' + p.executionId).length, 0);
});

test('HTTP preview and explicit request enforce origin and exact consent without dispatch on GET', async t => {
  const { checkoutServer } = await import('../src/checkout-http.mjs');
  const { once } = await import('node:events');
  const f = await fixture(t), checkout = { origin: '' }, server = checkoutServer(checkout, null, null, f.jobs, f.service);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = checkout.origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + `/api/verifications/${preparation.jobId}/assistance/${preparation.executionId}`;
  const p = await (await fetch(url)).json();
  assert.equal(f.calls(), 0); assert.equal(f.records.list('execution:' + p.executionId).length, 0);
  const post = (body, sameOrigin = true) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: sameOrigin ? origin : 'https://invalid.example' }, body: JSON.stringify(body) });
  const consent = { confirm: true, requestIdentity: p.requestIdentity };
  assert.equal((await post(consent, false)).status, 403);
  assert.equal((await post({ ...consent, confirm: false })).status, 409);
  assert.equal(f.calls(), 0);
  const accepted = await post(consent); assert.equal(accepted.status, 200);
  const result = await accepted.json(); assert.equal(result.currentValidation, 'ACCEPTED');
  assert.equal((await (await post(consent)).json()).id, result.id); assert.equal(f.calls(), 1);
});

const authorize = (f, p = preview(f)) => {
  const approval = { authorized: true, jobId: p.jobId, executionId: p.executionId,
    requestIdentity: p.requestIdentity, requestHash: p.requestHash, costHash: hash(p.cost),
    pricingReviewHash: hash(EXECUTION_PRICING_REVIEW), maximumUsd: p.cost.maximumUsd,
    maxAttempts: 1, expiresAt: EXECUTION_PRICING_REVIEW.expiresAt };
  f.setApproval(approval); return approval;
};

test('production authorization gate binds request and cost, sends nothing for preview and persists one approved attempt', async t => {
  const f = await fixture(t, { gated: true }), p = preview(f);
  assert.equal(p.dispatchEnabled, false);
  await assert.rejects(send(f, p), {code:'EXECUTION_AI_NOT_AUTHORIZED'});
  assert.equal(f.records.list('execution:'+p.executionId).length,0);
  const approval=authorize(f,p);
  assert.equal(preview(f).dispatchEnabled,true);assert.equal(f.calls(),0);
  const a=await send(f,p);assert.equal(a.currentValidation,'ACCEPTED');assert.equal(f.calls(),1);
  const saved=f.records.list('execution:'+p.executionId)[0];
  assert.equal(saved.requestContext.authorization.approvalHash,hash(approval));
  assert.equal(saved.dispatchPhase,'TRANSMISSION_POSSIBLE');
  const view=preview(f);assert.equal(view.dispatchEnabled,false);assert.equal(view.records[0].id,a.id);
  f.setApproval(null); // Revocation still permits read-only retrieval of a prior attempt.
  assert.equal(preview(f).records[0].id,a.id);assert.equal((await send(f,p)).id,a.id);assert.equal(f.calls(),1);
});

test('wrong cost, request, expired pricing, or unapproved server state cannot reserve', async t => {
  const f=await fixture(t,{gated:true}),p=preview(f),valid=authorize(f,p);
  for(const change of [{costHash:'wrong'},{requestHash:'wrong'},{requestIdentity:'wrong'},{maximumUsd:.01},{maximumUsd:.31},{maxAttempts:2},{authorized:false},{expiresAt:'2020-01-01'}]) {
    f.setApproval({...valid,...change});await assert.rejects(send(f,p),{code:'EXECUTION_AI_NOT_AUTHORIZED'});
  }
  assert.throws(()=>executionApproval(p,valid,Date.parse(EXECUTION_PRICING_REVIEW.expiresAt)),{code:'AI_PRICING_REVIEW_EXPIRED'});
  f.setApproval(valid);
  for(const offset of [0,1]) { f.service.now=()=>Date.parse(EXECUTION_PRICING_REVIEW.expiresAt)+offset;await assert.rejects(send(f,p),{code:'AI_PRICING_REVIEW_EXPIRED'}); }
  assert.equal(f.records.list('execution:'+p.executionId).length,0);assert.equal(f.calls(),0);
});

test('authorization revoked after reservation blocks transmission and preserves a consumed NOT_SENT attempt',async t=>{
  const f=await fixture(t,{gated:true}),p=preview(f);authorize(f,p);
  const prior=f.provider.beforeRequest;f.provider.beforeRequest=async body=>{await prior(body);f.setApproval(null);};
  const r=await send(f,p);assert.equal(r.error,'EXECUTION_AI_NOT_AUTHORIZED');assert.equal(r.providerOutcome,'NOT_SENT');
  assert.equal(r.costUnresolved,false);assert.equal(r.transportAttempts,0);assert.equal(f.calls(),0);
  authorize(f,p);assert.equal((await send(f,p)).id,r.id);assert.equal(f.calls(),0);
});

test('two controllers and a reopened store share the same approved attempt without redispatch',async t=>{
  const f=await fixture(t,{gated:true}),p=preview(f);authorize(f,p);
  const second=new ExecutionAssistance({jobs:f.jobs,records:f.records,provider:f.provider,requireAuthorization:true,approval:f.approvalReader,now:fixtureClock});
  const results=await Promise.allSettled([send(f,p),second.analyze(p.jobId,p.executionId,{confirm:true,requestIdentity:p.requestIdentity})]);
  assert.equal(f.calls(),1);assert.ok(results.some(r=>r.status==='fulfilled'));
  for(const r of results.filter(r=>r.status==='rejected'))assert.equal(r.reason.code,'AI_BUSY');
  const id=f.records.list('execution:'+p.executionId)[0].id;
  const reopened=new ExecutionAssistance({jobs:f.jobs,records:f.reopen(),provider:f.provider,requireAuthorization:true,approval:f.approvalReader,now:fixtureClock});
  assert.equal(reopened.preview(p.jobId,p.executionId).records[0].id,id);
  assert.equal((await reopened.analyze(p.jobId,p.executionId,{confirm:true,requestIdentity:p.requestIdentity})).id,id);assert.equal(f.calls(),1);
});

test('saved authorization cannot outlive a changed input immediately before transmission',async t=>{
  const f=await fixture(t,{gated:true}),p=preview(f);authorize(f,p);
  const build=f.jobs.prepareExecution,prior=f.provider.beforeRequest;
  f.provider.beforeRequest=async body=>{await prior(body);f.jobs.prepareExecution=(...args)=>{const b=build(...args);b.input.sources[0].sha256='0'.repeat(64);return b;};};
  const result=await send(f,p);assert.equal(result.error,'EXECUTION_AI_PREVIEW_CHANGED');assert.equal(f.calls(),0);
  assert.equal(f.records.list('execution:'+p.executionId)[0].dispatchPhase,'NOT_SENT');
});

test('provider errors through the authorized path persist one stopped attempt and remain readable',async t=>{
  for(const [outcome,code] of [['auth','AI_AUTHENTICATION_FAILED'],['rate','AI_RATE_LIMITED'],['model','AI_MODEL_UNAVAILABLE'],['invalid-citation','SOURCE_REVISION_MISMATCH'],['refusal','AI_REFUSED'],['incomplete','AI_INCOMPLETE_OUTPUT'],['timeout','AI_TIMEOUT']]){
    const f=await fixture(t,{gated:true,outcome}),p=preview(f);authorize(f,p);
    const r=await send(f,p);assert.equal(r.error,code);assert.equal(r.reusable,false);assert.equal(preview(f).records[0].id,r.id);
    assert.equal((await send(f,p)).id,r.id);assert.equal(f.calls(),1);
    if(outcome==='timeout')assert.equal(r.costUnresolved,true);
  }
});

test('response retention and final persistence failures cannot cause automatic resend',async t=>{
  for(const failure of ['retention','final-save','pre-send-save']){
    const f=await fixture(t,{gated:true}),p=preview(f);authorize(f,p);
    if(failure==='retention')f.records.retainResponse=()=>{throw new DiagnosisError('PRIVATE_RESPONSE_STORAGE_FAILED');};
    else{const save=f.records.save.bind(f.records);f.records.save=r=>{
      if((failure==='final-save'&&r.status==='succeeded')||(failure==='pre-send-save'&&r.dispatchPhase==='TRANSMISSION_POSSIBLE'))throw Error('injected persistence failure');
      return save(r);
    };}
    if(failure==='final-save')await assert.rejects(send(f,p),/injected persistence failure/);else await send(f,p);
    const view=preview(f);assert.equal(view.records.length,1);assert.equal(view.dispatchEnabled,false);
    assert.equal(f.calls(),failure==='pre-send-save'?0:1);
    if(failure==='final-save')assert.equal(view.records[0].costUnresolved,true);
    await send(f,p);assert.equal(f.calls(),failure==='pre-send-save'?0:1);
  }
});

test('trusted response capability permits only fixed Responses POST and never replaces global fetch',async()=>{
  const original=globalThis.fetch;let calls=0;
  const transport=responseOnlyTransport(async()=>{calls++;return new Response('{}');});
  await transport('https://api.openai.com/v1/responses',{method:'POST',redirect:'error'});
  assert.throws(()=>transport('https://example.com/',{method:'POST',redirect:'error'}),{code:'AI_TRANSPORT_SCOPE_REJECTED'});
  assert.throws(()=>transport('https://api.openai.com/v1/responses',{method:'GET',redirect:'error'}),{code:'AI_TRANSPORT_SCOPE_REJECTED'});
  assert.equal(calls,1);assert.equal(globalThis.fetch,original);
});

test('trusted server startup with injected transport creates no attempt and never enables unapproved generation', async t => {
  const { startServer } = await import('../server.mjs');
  const { createServer } = await import('node:net');
  const { once } = await import('node:events');
  const dir=mkdtempSync(join(tmpdir(),'cp-live-server-'));
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));let calls=0;
  const server=await startServer({argv:['--verification',String(port),dir],responseFetch:async()=>{calls++;throw Error('No startup transport allowed');},approvalPath:join(dir,'absent-approval.json'),apiKey:'offline-test-placeholder'});
  if(!server.listening)await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const response=await fetch(`http://127.0.0.1:${port}/api/verifications`);assert.equal(response.status,200);
  assert.equal(calls,0);
  const db=new DatabaseSync(join(dir,'checkout.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM diagnoses').get().n,0);db.close();
});

test('read-only cost receipts distinguish absent usage, NOT_SENT and observed zero without inventing billing', async()=>{
 const {diagnosisCostReceipt}=await import('../src/diagnosis-cost.mjs');
 const missing=diagnosisCostReceipt({dispatchPhase:'TRANSMISSION_POSSIBLE',requestContext:{cost:{maximumUsd:.23}}});
 assert.equal(missing.cost,null);assert.equal(missing.costUnresolved,true);assert.equal(missing.unresolvedMaximumEstimateUsd,.23);assert.equal(missing.billingConfirmed,false);
 const notSent=diagnosisCostReceipt({dispatchPhase:'NOT_SENT'});assert.equal(notSent.cost,null);assert.equal(notSent.costUnresolved,false);
 const zero=diagnosisCostReceipt({usage:{input_tokens:0,output_tokens:0,input_tokens_details:{cache_write_tokens:0}}});
 assert.equal(zero.cost.usageBasedEstimateUsd,0);assert.equal(zero.costUnresolved,false);assert.equal(zero.billingConfirmed,false);
});

test('prior-contract response stays visible without consuming the new exact request; new attempt still deduplicates', async t => {
  const f = await fixture(t), p = preview(f);
  const old = { ...structuredClone(preparation.records[0]), id: 'prior-contract-fixture', runId: 'execution:' + p.executionId,
    fingerprint: 'prior-contract-fingerprint', schemaVersion: 'external-diagnosis-4', promptVersion: 'external-diagnosis-4', validatorVersion: 'external-diagnosis-4',
    input: p.input, sourceProvenance: p.provenance, providerAttempt: true, status: 'succeeded', createdAt: 1,
    requestContext: { requestIdentity: 'prior-contract-identity' } };
  f.records.save(old);
  const failed = {...old,id:'prior-v5-failure',fingerprint:'prior-v5-fingerprint',schemaVersion:'external-diagnosis-5',promptVersion:'external-diagnosis-5',validatorVersion:'external-diagnosis-5',status:'failed',result:null,error:'AI_INCOMPLETE_OUTPUT',responseStatus:'incomplete',usage:{input_tokens:100,output_tokens:6000},createdAt:2}; f.records.save(failed);
  const before = preview(f);
  assert.equal(before.records.length, 2); assert.ok(before.records.some(r=>r.id===old.id)); assert.equal(before.records.find(r=>r.id===failed.id).regressionGuidance.status,'UNAVAILABLE_UNVALIDATED_RESPONSE');
  assert.notEqual(before.records[0].fingerprint, before.fingerprint); assert.equal(before.dispatchEnabled, true); assert.equal(f.calls(), 0);
  const current = await send(f, before);
  assert.equal(current.status, 'succeeded'); assert.equal(f.calls(), 1);
  const after = preview(f); assert.equal(after.records.length, 3); assert.equal(after.dispatchEnabled, false);
  assert.equal((await send(f, after)).id, current.id); assert.equal(f.calls(), 1);
  assert.deepEqual(f.records.list(old.runId).find(r => r.id === old.id), old);assert.deepEqual(f.records.list(old.runId).find(r => r.id === failed.id), failed);
});


test('incomplete reason is allowlisted and retention survives restart without accepting parsable or whitespace output', async t => {
  for (const reason of ['max_output_tokens', 'content_filter', 'unrecognized-private-detail', undefined]) {
    for (const outcome of ['incomplete', 'whitespace-incomplete']) {
      const f = await fixture(t, {outcome, incompleteReason: reason}), p = preview(f), r = await send(f,p);
      const expected = ['max_output_tokens','content_filter'].includes(reason) ? reason : null;
      assert.equal(r.error,'AI_INCOMPLETE_OUTPUT'); assert.equal(r.result,null); assert.equal(r.incompleteReason,expected);
      const retained=f.records.retainedResponse(r.id);
      assert.equal(retained.metadata.incompleteReason,expected); assert.ok(retained.preservationComparison.every(c=>c.contentEqual));
      assert.doesNotMatch(JSON.stringify(retained),/unrecognized-private-detail/);
      if(outcome==='whitespace-incomplete')assert.equal(retained.messages[0].fields.text,'{"observedFacts":['+' \t'.repeat(1000));
      const store=f.reopen(), restarted=new ExecutionAssistance({jobs:f.jobs,records:store,provider:f.provider});
      const again=await restarted.analyze(p.jobId,p.executionId,{confirm:true,requestIdentity:p.requestIdentity});
      assert.equal(again.id,r.id);assert.equal(again.error,r.error);assert.equal(again.incompleteReason,expected);assert.deepEqual(again.usage,r.usage);assert.equal(f.calls(),1);
    }
  }
});
test('useful authored response missing a required control is rejected through the normal application path', async t => {
  const f=await fixture(t,{outcome:'missing-control'}),p=preview(f),r=await send(f,p);
  assert.equal(r.status,'failed');assert.equal(r.result,null);assert.equal(r.reusable,false);assert.ok(f.records.retainedResponse(r.id));
  assert.equal((await send(f,p)).id,r.id);assert.equal(f.calls(),1);
});
