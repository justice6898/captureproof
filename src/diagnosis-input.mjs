import { readFileSync } from 'node:fs';
import { hash, LIMITS, DiagnosisError } from './diagnosis-contract.mjs';

const ROOT = new URL('../', import.meta.url);
const EVENT_NAMES = ['BOUND_CAPTURE_VERIFIED', 'CAPTURE_REQUESTED', 'CAPTURE_RESPONSE_RECEIVED', 'CAPTURE_RESPONSE_UNRESOLVED',
  'CAPTURE_RESPONSE_LOST_TERMINAL', 'CAPTURE_RETRY_BLOCKED', 'FIXTURE_TERMINAL_FAILURE', 'READ_BACK_INCONCLUSIVE', 'READ_BACK_UNRESOLVED', 'TEST_CAPTURE_RESPONSE_DROPPED'];
const ALIASES = Object.fromEntries(EVENT_NAMES.map((name, i) => [name, `trace_${i + 1}`]));
Object.assign(ALIASES, { 'terminal-failure': 'mode_1', reconcile: 'mode_2' });
const cleanId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;
const bool = v => typeof v === 'boolean' ? v : null;
const integer = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const member = (v, values) => values.includes(v) ? v : null;
function flatten(value, prefix = '', out = {}) {
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${key}` : key, out);
  } else out[prefix] = value;
  return out;
}
function range(lines, start, end) {
  const a = lines.findIndex(l => l.startsWith(start));
  const b = end ? lines.findIndex((l, i) => i > a && l.startsWith(end)) : lines.length;
  if (a < 0 || b < 0) throw new DiagnosisError('SOURCE_MANIFEST_CHANGED');
  return Array.from({ length: b - a }, (_, i) => a + i);
}

// Excerpts retain original line numbers. Only comments and explicitly inactive spans are omitted;
// string literal aliases are disclosed, not presented as executable original source.
export function sourceBundle(run, order, readSource = path => readFileSync(new URL(path, ROOT), 'utf8')) {
  const sources = []; const provenance = []; const mappings = [];
  const manifest = [
    ['src/checkout-service.mjs', [['export class CheckoutService', '  newOrder('], ['  view(id)', '  create('], ['  async #read(', '  reconcile('], ['  capture(', null]]],
    ['src/checkout-contract.mjs', [['export const PRODUCT', 'export function approvalUrl']]],
    ['src/order-store.mjs', [['    this.db.exec(`PRAGMA', '      CREATE TABLE IF NOT EXISTS experiment_runs'], ['  get(id)', '  list()'], ['  save(order)', '  fulfillmentCount(']]]
  ];
  for (const [path, spans] of manifest) {
    const original = readSource(path), fileHash = hash(original), lines = original.split('\n');
    const indices = [...new Set(spans.flatMap(([start, end]) => range(lines, start, end)))];
    const omitted = [];
    // The other policy branch is not an answer key for this run. It is not executed under mode_2.
    if (path.endsWith('checkout-service.mjs') && order.responseLossPolicy === 'reconcile') {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("if (order.experimentRunId && order.responseLossPolicy === 'terminal-failure') {")) {
          let j = i; while (j < lines.length && lines[j].trim() !== '}') omitted.push(j++);
          omitted.push(j);
        } else if (lines[i].includes("if (order.experimentRunId && order.responseLossPolicy === 'terminal-failure' && order.faultInjected)")) omitted.push(i);
      }
    }
    const supplied = indices.filter(i => !omitted.includes(i)).map(i => {
      let text = lines[i].trim().startsWith('//') ? '' : lines[i];
      for (const [from, to] of Object.entries(ALIASES)) text = text.replaceAll(`'${from}'`, `'${to}'`);
      return { line: i + 1, text };
    });
    const id = `source-${sources.length + 1}`;
    const creationHash = path === run.implementation?.reference && /^[a-f0-9]{64}$/.test(run.implementation?.sha256 ?? '') ? run.implementation.sha256 : null;
    const history = creationHash ? (creationHash === fileHash ? 'Current file matches hash recorded at run creation; no historical source snapshot was stored.' : 'Current file differs from run-creation hash; historical implementation unavailable.') : 'Supplied after execution; no historical hash or source snapshot for this helper.';
    const transformedHash = hash(supplied);
    sources.push({ id, lines: supplied, contentHash: transformedHash, provenance: history,
      transformations: 'Whole-line comments blanked; selected string literals consistently aliased. Original line numbers retained. This is a transformed excerpt, not an exact executable file.',
      omittedInactiveLines: omitted.map(i => i + 1) });
    provenance.push({ sourceRef: id, path, originalFileHash: fileHash, suppliedHash: transformedHash,
      runCreationHash: creationHash, capturedDuringExecution: false, history });
    mappings.push({ sourceRef: id, path });
  }
  return { sources, provenance, mappings, aliases: ALIASES };
}

export function buildDiagnosisInput(store, runId, options = {}) {
  const run = store.getRun(runId), order = store.get(run.businessOrderId);
  const bundle = sourceBundle(run, order, options.readSource);
  const evidence = [];
  const add = (id, fields) => evidence.push({ id, fields: flatten(fields) });
  const configId = `config-${run.id}`;
  add(configId, { amountMinor: integer(run.contract.amountMinor), currency: member(run.contract.currency, ['USD']),
    responseLossPolicy: ALIASES[order.responseLossPolicy] ?? null, experimentBound: order.experimentRunId === run.id, dropCaptureResponse: bool(order.dropCaptureResponse),
    createRequestId: cleanId(run.createRequestId), captureRequestId: cleanId(run.captureRequestId) });
  const audits = run.timeline.filter(e => e.type === 'AUDIT_READ_ONLY');
  const selected = audits.length > 12 ? [audits[0], ...audits.slice(-11)] : audits;
  for (const audit of selected) {
    const o = audit.observation, p = o.provider, m = o.merchant;
    add(audit.id, { at: integer(audit.at), startedAt: integer(audit.startedAt), settled: bool(o.settled), faultObserved: bool(o.faultObserved),
      providerRef: cleanId(p.evidenceId), merchantRef: cleanId(m.evidenceId) });
    add(p.evidenceId, { businessOrderId: cleanId(p.businessOrderId), orderId: cleanId(p.orderId), complete: bool(p.complete),
      orderStatus: member(p.orderStatus, ['CREATED', 'APPROVED', 'PAYER_ACTION_REQUIRED', 'COMPLETED', 'VOIDED', 'SAVED']),
      readUnavailableOrInvalid: !!p.error, captureCount: p.captures.length,
      captures: p.captures.slice(0, 4).map(c => ({ id: cleanId(c.id), orderId: cleanId(c.orderId),
        status: member(c.status, ['COMPLETED', 'PENDING', 'FAILED', 'DECLINED']), amountMinor: integer(c.amountMinor), currency: member(c.currency, ['USD']), finalCapture: bool(c.finalCapture) })) });
    add(m.evidenceId, { businessOrderId: cleanId(m.businessOrderId), orderId: cleanId(m.orderId), state: member(m.state, ['NEW', 'CREATING', 'AWAITING_APPROVAL', 'AWAITING_CAPTURE', 'CAPTURING', 'PENDING', 'INCONCLUSIVE', 'PAID', 'FAILED']),
      paid: bool(m.paid), captureId: cleanId(m.captureId), fulfillmentCount: integer(m.fulfillmentCount),
      fulfillmentCaptureIds: m.fulfillmentCaptureIds.map(cleanId), coherent: bool(m.coherent), faultInjected: bool(m.faultInjected) });
  }
  for (const event of order.events.filter(e => Object.hasOwn(ALIASES, e.type)).slice(-20)) add(event.id, { at: integer(event.at), event: ALIASES[event.type] });
  const input = { scenario: 'capture_response_lost', evidenceMode: member(run.evidenceMode, ['paypal-sandbox', 'local-simulation']),
    contract: { amountMinor: integer(run.contract.amountMinor), currency: 'USD', fulfillment: 'Exactly one persisted entitlement after verified capture and the completion boundary.',
      boundary: 'Observation window ends after the capture handler returns terminal failure or merchant read-back verifies payment. Unresolved recovery is unfinished.',
      fault: 'Application-layer discard of a validated successful capture response before the merchant applies its result. Not a real network outage.' },
    selection: { auditCount: audits.length, suppliedAuditCount: selected.length, omittedAuditCount: audits.length - selected.length,
      scope: 'Persisted observations only. No new provider reads. Execution configuration is from the saved merchant record; not an execution-time source snapshot.' },
    evidence, sources: bundle.sources };
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) throw new DiagnosisError('DUPLICATE_EVIDENCE_REFERENCE');
  if (Buffer.byteLength(JSON.stringify(input)) > LIMITS.inputBytes) throw new DiagnosisError('INPUT_TOO_LARGE');
  return { input, provenance: bundle.provenance, mappings: bundle.mappings, aliases: bundle.aliases };
}
