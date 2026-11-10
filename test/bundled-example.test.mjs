import test from 'node:test';
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
  assert.match(path, /data\/portable-reports\/(developer-reviewed-2026-11-06|upstream-pending-replayed-2026-10-29)\/(report.html|manifest.json)$/);
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
  ]) assert.equal(bundledExample('reviewed-comparison', { read }).available, false);
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
