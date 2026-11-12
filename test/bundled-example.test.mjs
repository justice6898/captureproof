import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { bundledExample, reviewedSelection } from '../src/verified-example.mjs';
import { VerificationJobs } from '../src/verification-jobs.mjs';
import { checkoutServer } from '../src/checkout-http.mjs';
import { fixture } from '../test-support/checkout-fixture.mjs';

const distributedRead = path => {
  assert.match(path, /data\/portable-reports\/(reviewed-v6-journey-2026-11-12|developer-reviewed-2026-11-06|upstream-pending-replayed-2026-10-29)\/(report.html|manifest.json)$/);
  return readFileSync(path);
};
test('bundled comparison needs only distributed HTML/manifest, with no private DB or evidence sidecar', () => {
  const current = bundledExample('reviewed-comparison', { read: distributedRead });
  assert.equal(current.available, true);
  assert.equal(current.origin, 'BUNDLED_RECORDED_EVIDENCE');
  assert.equal(current.baseline.providerCapture.status, 'PENDING');
  assert.equal(current.baseline.afterShutdown.captures.length, 1);
  assert.equal(current.candidate.afterShutdown.captures.length, 0);
  assert.equal(current.final.afterShutdown.captures.length, 1);
  assert.equal(current.analysisStatus, 'NO_MATCHING_ANALYSIS');
  assert.equal(reviewedSelection({ read: distributedRead }).runId, current.runId);
  assert.notEqual(bundledExample('upstream-pending').runId, current.runId);
});
test('missing, altered HTML or altered manifest cannot silently select another example', () => {
  for (const read of [
    () => { throw Object.assign(Error(), { code: 'ENOENT' }); },
    path => path.endsWith('report.html') ? Buffer.from('<h1>substituted</h1>') : readFileSync(path),
    path => path.endsWith('manifest.json') ? Buffer.from('{"files":[]}') : readFileSync(path)
  ]) for(const id of ['reviewed-v6','reviewed-comparison','upstream-pending']) assert.equal(bundledExample(id, { read }).available, false);
  assert.equal(bundledExample('../outside').available, false);
});
test('empty state and unsupported execution host still expose verified bundled viewing/downloads', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cp-empty-example-'));
  const jobs = new VerificationJobs({ directory, launch: () => assert.fail('No execution'), readiness: () => ({ ready: false, code: 'UNSUPPORTED_VERIFICATION_HOST' }) });
  const f = fixture(t), server = checkoutServer(f.service, null, null, jobs);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); jobs.close(); rmSync(directory, { recursive: true, force: true }); });
  const origin = f.service.origin = `http://127.0.0.1:${server.address().port}`;
  const list = await (await fetch(origin + '/api/verifications')).json();
  assert.equal(list.jobs.length, 0);
  assert.equal(list.resultExample.available, false);
  assert.equal(list.bundledExample.available, true);
  assert.equal(list.setup.ready, false);
  assert.equal(Object.hasOwn(list.bundledExample, 'body'), false);
  for (const path of [list.bundledExample.url, list.bundledExample.download]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), bundledExample().body.toString());
  }
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  const selection = { campaign: 'core-1', candidateId: 'builtin-v3' };
  const planResponse = await post('/api/verification-plan', selection);
  assert.equal(planResponse.status, 200);
  const plan = await planResponse.json(); assert.equal(plan.plan.maxExecutions, 8);
  assert.equal(plan.capability.ready, false);
  const key = '00000000-0000-4000-8000-000000000010';
  const stale = await post('/api/verifications', { ...selection, launchKey: key, planFingerprint: 'stale' });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'VERIFICATION_PLAN_CHANGED');
  const blocked = await post('/api/verifications', { ...selection, launchKey: key, planFingerprint: plan.fingerprint });
  assert.equal(blocked.status, 503);
  assert.equal(jobs.list().length, 0);
  assert.equal(f.provider.createCalls.length, 0);
});

test('primary recorded example explicitly selects the exact reviewed v6 and preserves paired evidence', () => {
 const e=bundledExample(undefined,{read:distributedRead});assert.equal(e.available,true);assert.equal(e.url,'/examples/reviewed-v6');assert.equal(e.analysisStatus,'MATCHED_REVIEWED_DIAGNOSIS');
 const d=JSON.parse(e.body.toString().match(/id="report-data">(.*?)<\/script>/s)[1]),a=d.primary.analysis,r=a.records[0];
 assert.equal(a.records.length,1);assert.equal(a.selectedAttemptId,'3dcbf49c-439b-441a-9b69-3e8acd643054');assert.equal(r.id,a.selectedAttemptId);assert.equal(a.input.execution.runId,e.runId);assert.equal(e.runId,'f111b657-0de7-4b05-91d0-9cafcaf3449b');
 assert.equal(r.schemaVersion,'external-diagnosis-6');assert.equal(r.currentValidation,'ACCEPTED');assert.equal(r.semanticReview.outcome,'PASS');assert.equal(r.semanticReview.reviewedClaimCount,46);assert.equal(r.semanticReview.metadataValidation,'PASS');assert.equal(r.regressionGuidance.status,'COMPLETE_STRUCTURE');
 assert.equal(d.primary.repairExecution.runId,'c9ef1c64-ea0d-4377-9e5c-6c501025826a');assert.equal(d.replayVerification.upstream.execution.runId,'384faf14-c67f-4a1f-9491-08397b7c696d');assert.equal(d.replayVerification.repair.execution.runId,'0565dcf6-1b77-409d-a129-dc102ed620a0');
 assert.equal(e.baseline.afterShutdown.collection.status,'completed');assert.equal(e.baseline.afterShutdown.captures.length,1);assert.equal(e.candidate.afterShutdown.collection.status,'authorized');assert.equal(e.candidate.afterShutdown.captures.length,0);assert.equal(e.final.afterShutdown.captures.length,1);
 for(const key of ['clientRequestId','providerRequestId','responseId','offlineRevalidations'])assert.equal(Object.hasOwn(r,key),false);
});

test('current portable report embeds the shared renderer/styles with exact CSP hashes and no remote assets',()=>{
 const text=bundledExample().body.toString();
 const renderer=readFileSync(new URL('../public/result-view.js',import.meta.url),'utf8');assert.ok(text.includes(`<script>${renderer}</script>`));
 assert.ok(text.includes(readFileSync(new URL('../public/result.css',import.meta.url),'utf8')));
 for(const match of text.matchAll(/<(script|style)>([\s\S]*?)<\/\1>/g)){const digest=createHash('sha256').update(match[2]).digest('base64');assert.ok(text.includes("'sha256-"+digest+"'"));}
 assert.match(text,/connect-src 'none'/);assert.doesNotMatch(text,/<script[^>]+src=|<link[^>]+href=/);assert.ok(text.includes(readFileSync(new URL('../public/portable-report.js',import.meta.url),'utf8')), 'The frozen report contains the current complete presentation, not a stale renderer');
});
