import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { usdMinor, PRODUCT } from './checkout-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const EXTERNAL_RULES = JSON.parse(readFileSync(new URL('../external/rules.json', import.meta.url), 'utf8'));
const modes = ['normal', 'pending', 'lost-response', 'read-unavailable'];
export function validateSequence(sequence, providerMode = 'normal') {
  if (!modes.includes(providerMode) || !Array.isArray(sequence) || sequence.length < 1 || sequence.length > 8) throw new Error('UNSUPPORTED_SEQUENCE');
  let stage = 0, captured = false, settled = false;
  for (const action of sequence) {
    if (action === 'initiate' && stage === 0) stage = 1;
    else if (action === 'approve' && stage === 1) stage = 2;
    else if (action === 'authorize' && stage === 2) stage = 3;
    else if (action === 'capture' && stage === 3) captured = true;
    else if (['status', 'retrieve'].includes(action) && stage > 0) { /* Read-only observations. */ }
    else if (action === 'settle' && captured && providerMode === 'pending' && !settled) settled = true;
    else throw new Error('INVALID_ACTION_ORDER');
  }
}

export function explorationPlan(depth = 2) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 2) throw new Error('EXPLORATION_BOUND_EXCEEDED');
  const prefix = ['initiate', 'approve', 'authorize', 'capture'];
  let level = [[]], suffixes = [[]];
  for (let i = 0; i < depth; i++) { level = level.flatMap(s => ['status', 'capture'].map(a => [...s, a])); suffixes.push(...level); }
  return [
    { name: 'approval-control', sequence: ['initiate', 'approve', 'status'], providerMode: 'normal' },
    { name: 'authorization-control', sequence: ['initiate', 'approve', 'authorize', 'status'], providerMode: 'normal' },
    ...suffixes.map((s, i) => ({ name: `capture-sequence-${i}`, sequence: [...prefix, ...s], providerMode: 'normal' })),
    { name: 'pending-unfinished', sequence: [...prefix, 'status'], providerMode: 'pending' },
    { name: 'pending-settled', sequence: [...prefix, 'status', 'settle', 'retrieve', 'status'], providerMode: 'pending' },
    { name: 'lost-response-read-back', sequence: [...prefix, 'status', 'retrieve'], providerMode: 'lost-response' },
    { name: 'unavailable-read-then-observe', sequence: [...prefix, 'retrieve', 'status'], providerMode: 'read-unavailable' }
  ];
}

export function evaluateExternal(trace, contract) {
  const inconclusive = reason => ({ status: 'INCONCLUSIVE', findings: [{ code: 'MORE_EVIDENCE_REQUIRED', reason }], scope: EXTERNAL_RULES.scope });
  if (!contract?.orderId || contract.currency !== 'USD' || !Number.isSafeInteger(contract.amountMinor) || contract.amountMinor <= 0) return inconclusive('A valid exact order contract is required.');
  if (!trace?.actions?.length || trace.actions.length !== trace.sequence?.length || !Array.isArray(trace.events) || !trace.providerFinal ||
      !trace.isolation || !['environmentScrubbed', 'fileReadBlocked', 'subprocessBlocked', 'networkBlocked'].every(k => trace.isolation[k] === true)) return inconclusive('Complete isolated execution observations are required.');
  const findings = [], checked = new Set();
  const fail = (code, reason, row) => findings.push({ code, reason, evidenceRefs: row.evidenceRefs });
  for (const row of trace.actions) {
    if (!row.before || !row.after || !row.returned || !row.evidenceRefs?.length || !Array.isArray(row.before.captures) || !Array.isArray(row.after.captures)) return inconclusive('An action observation is missing.');
    const events = trace.events.filter(e => row.evidenceRefs.includes(e.id));
    if (events.length !== row.evidenceRefs.length || events[0].kind !== 'action_start' || events.at(-1).kind !== 'action_end') return inconclusive('Action evidence references are incomplete.');
    if (row.before.order?.status === 'APPROVED' && ['status', 'retrieve'].includes(row.action)) {
      checked.add('APPROVAL_IS_NOT_AUTHORIZATION');
      if (['authorized', 'captured'].includes(row.returned.sessionStatus) || row.after.captures.length) fail('APPROVAL_IS_NOT_AUTHORIZATION', 'Buyer approval was treated as authorization or caused capture.', row);
    }
    if (['status', 'retrieve'].includes(row.action)) {
      checked.add('READS_HAVE_NO_FINANCIAL_EFFECT');
      if (JSON.stringify(row.before) !== JSON.stringify(row.after) || events.some(e => e.kind === 'sdk_request' && e.method !== 'getOrder')) fail('READS_HAVE_NO_FINANCIAL_EFFECT', 'A query changed simulated financial state or issued a write.', row);
    }
    const returned = row.returned.order;
    if (returned) {
      checked.add('RETURNED_ORDER_BINDING');
      const unit = returned.purchaseUnits?.[0];
      if (returned.id !== contract.orderId || row.returned.providerOrderId !== contract.orderId || returned.purchaseUnits?.length !== 1 ||
          unit?.amount?.currencyCode !== contract.currency || usdMinor(unit?.amount?.value) !== contract.amountMinor) fail('RETURNED_ORDER_BINDING', 'Returned order identity or exact money differs from the declared order.', row);
      const response = events.findLast(e => e.kind === 'sdk_response' && ['createOrder', 'getOrder'].includes(e.method));
      if (!response) return inconclusive('Returned snapshot lacks an independent SDK response observation.');
      if (JSON.stringify(response.result) !== JSON.stringify(returned)) fail('RETURNED_ORDER_BINDING', 'Target return differs from the observed SDK snapshot.', row);
      for (const c of unit?.payments?.captures ?? []) {
        const observed = row.after.captures.find(x => x.id === c.id);
        if (!observed || JSON.stringify(c) !== JSON.stringify(observed) || c.amount?.currencyCode !== contract.currency || usdMinor(c.amount?.value) !== contract.amountMinor) fail('RETURNED_ORDER_BINDING', 'Capture identity/status/money is not supported by provider observation.', row);
      }
    }
    checked.add('ONE_FULL_CAPTURE');
    const captures = row.after.captures;
    if (!Array.isArray(captures)) return inconclusive('Capture evidence missing.');
    const completed = captures.filter(c => c.status === 'COMPLETED');
    const amounts = completed.map(c => usdMinor(c.amount?.value));
    if (amounts.some(a => a === null) || completed.some(c => c.amount.currencyCode !== contract.currency)) return inconclusive('Malformed capture money.');
    if (new Set(completed.map(c => c.id)).size > 1 || amounts.reduce((s, a) => s + BigInt(a), 0n) > BigInt(contract.amountMinor)) fail('ONE_FULL_CAPTURE', 'More than one completed full capture is observed; request count alone is not used.', row);
  }
  if (!Array.isArray(trace.providerFinal.captures)) return inconclusive('Final capture observation is missing.');
  const pending = trace.providerFinal.captures.some(c => c.status === 'PENDING');
  if (!findings.length && pending) return { ...inconclusive('Simulated capture is still pending; the completion window is unfinished.'), checkedRules: [...checked] };
  return { status: findings.length ? 'FAIL' : 'PASS', scope: EXTERNAL_RULES.scope, checkedRules: [...checked], findings,
    limitations: EXTERNAL_RULES.unobserved, duplicateAttemptInterpretation: 'The simulator rejects a second full capture; this does not prove target idempotency.' };
}

export function runExternal(sequence, providerMode = 'normal') {
  validateSequence(sequence, providerMode);
  if (process.platform !== 'darwin' || Number(process.versions.node.split('.')[0]) < 24) throw new Error('ISOLATION_REQUIRES_MACOS_NODE24');
  const manifest = JSON.parse(readFileSync(join(root, 'external/rsc-paypal/manifest.json'), 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files)) if (digest(readFileSync(join(root, 'external/rsc-paypal', file))) !== expected) throw new Error('EXTERNAL_SOURCE_CHANGED');
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'captureproof-external-')));
  const canaryDir = realpathSync(mkdtempSync(join(tmpdir(), 'captureproof-canary-'))), canaryPath = join(canaryDir, 'canary');
  writeFileSync(canaryPath, 'nonsecret isolation probe');
  const runId = randomUUID(), stem = runId.replaceAll('-', '').toUpperCase();
  const amount = BigInt(PRODUCT.amountMinor), major = `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
  const config = { sequence, providerMode, runId, ids: { order: `O${stem}`, authorization: `A${stem}`, capture: `C${stem}` },
    amountMinor: PRODUCT.amountMinor, currency: PRODUCT.currency, major, canaryPath, sourceHash: manifest.files['service.ts'],
    sourceUrl: `${manifest.repository}/blob/${manifest.revision}/${manifest.upstreamPath}` };
  const startedAt = new Date().toISOString();
  try {
    writeFileSync(join(workspace, 'input.json'), JSON.stringify(config), { mode: 0o600 });
    writeFileSync(join(workspace, 'service.ts'), readFileSync(join(root, 'external/rsc-paypal/service.ts')), { mode: 0o600 });
    writeFileSync(join(workspace, 'worker.mjs'), readFileSync(join(root, 'scripts/external-worker.mjs')), { mode: 0o600 });
    // OS denial is essential; no fallback to unsandboxed execution. Node permissions
    // and the allowlisted module linker are additional controls, not a universal sandbox.
    const quote = value => JSON.stringify(value);
    const profile = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${quote(workspace)}) (literal "/dev/null"))(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var") (subpath "/private/tmp"))(allow file-read* (subpath ${quote(workspace)}) (literal ${quote(realpathSync(process.execPath))}))(allow file-read-metadata)(deny process-fork)`;
    const child = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, realpathSync(process.execPath), '--permission', `--allow-fs-read=${workspace}`, `--allow-fs-write=${workspace}`, '--experimental-vm-modules', 'worker.mjs'],
      { cwd: workspace, env: { LANG: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    if (child.error || child.status !== 0) throw Object.assign(new Error('EXTERNAL_EXECUTION_BLOCKED'), { detail: child.error?.code ?? child.stderr.slice(0, 800) });
    const trace = JSON.parse(child.stdout);
    if (trace.runId !== runId || trace.sourceHash !== config.sourceHash || JSON.stringify(trace.sequence) !== JSON.stringify(sequence)) throw new Error('EXECUTION_BINDING_MISMATCH');
    const contract = { orderId: config.ids.order, amountMinor: config.amountMinor, currency: config.currency };
    return { ...trace, startedAt, finishedAt: new Date().toISOString(), target: manifest, contract, rules: EXTERNAL_RULES,
      harnessHashes: Object.fromEntries(['src/external-execution.mjs', 'scripts/external-worker.mjs', 'src/checkout-contract.mjs', 'external/rules.json'].map(f => [f, digest(readFileSync(join(root, f)))])),
      verdict: evaluateExternal(trace, contract), simulatedCaptureAttempts: trace.events.filter(e => e.kind === 'sdk_request' && e.method === 'captureAuthorizedPayment').length,
      independentlyObservedCaptureCount: trace.providerFinal.captures.length };
  } finally { rmSync(workspace, { recursive: true, force: true }); rmSync(canaryDir, { recursive: true, force: true }); }
}
