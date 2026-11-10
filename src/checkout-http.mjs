import { ExecutionAssistance } from './execution-assistance.mjs';
import {portableReportFiles} from './portable-report.mjs';
import {verifiedExample, bundledExample} from './verified-example.mjs';
import { CORE_CAMPAIGN } from './regression-campaign.mjs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { CheckoutError, PRODUCT } from './checkout-contract.mjs';
import { DiagnosisError } from './diagnosis-contract.mjs';
import { LostResponseRuns } from './lost-response-runs.mjs';
import { VERIFICATION_CHOICES } from './verification-jobs.mjs';
import { REPORT_CATALOG, loadExternalReport, availableReportCatalog } from './external-report.mjs';

export const assets = new Map([
  ['/execution-assistance.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/execution-assistance.js', import.meta.url))]],
  ['/verification-state.mjs', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/verification-state.mjs', import.meta.url))]],
  ['/recorded-evidence.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/recorded-evidence.js', import.meta.url))]],
  ['/external', ['text/html; charset=utf-8', readFileSync(new URL('../public/external.html', import.meta.url))]],
  ['/external-diagnosis.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/external-diagnosis.js', import.meta.url))]],
  ['/repair-review.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/repair-review.js', import.meta.url))]],
  ['/verification.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/verification.js', import.meta.url))]],
  ['/external.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/external.js', import.meta.url))]],
  ['/external.css', ['text/css; charset=utf-8', readFileSync(new URL('../public/external.css', import.meta.url))]],
  ['/', ['text/html; charset=utf-8', readFileSync(new URL('../public/index.html', import.meta.url))]],
  ['/checkout.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/checkout.js', import.meta.url))]],
  ['/diagnosis.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/diagnosis.js', import.meta.url))]],
  ['/runs.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../public/runs.js', import.meta.url))]],
  ['/checkout.css', ['text/css; charset=utf-8', readFileSync(new URL('../public/checkout.css', import.meta.url))]]
]);

async function body(req,limit=2048) {
  if (req.headers['content-type'] !== 'application/json') throw new CheckoutError('JSON_REQUIRED', 415);
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new CheckoutError('BODY_TOO_LARGE', 413);
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new CheckoutError('INVALID_JSON'); }
}

export function checkoutServer(service, diagnoses = null, externalDiagnoses = null, verificationJobs = null, assistance = null) {
  assistance ??= verificationJobs ? new ExecutionAssistance({ jobs: verificationJobs, records: verificationJobs.diagnosisRecords ?? { list: () => [] } }) : null;
  const runs = new LostResponseRuns(service);
  return createServer(async (req, res) => {
    const send = (status, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    try {
      const origin = new URL(service.origin);
      if (req.headers.host !== origin.host) throw new CheckoutError('INVALID_HOST', 403);
      const url = new URL(req.url, service.origin);
      if (url.origin !== service.origin) throw new CheckoutError('INVALID_ORIGIN', 403);
      if(req.method==='GET'&&/^\/examples\/(upstream-pending|reviewed-comparison)(\/download)?$/.test(url.pathname)){
        const example=bundledExample(url.pathname.split('/')[2]);
        if(!example.available)return send(503, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recorded comparison unavailable</title><link rel="stylesheet" href="/external.css"></head><body><main><h1>Recorded comparison unavailable</h1><p>${example.reason}</p><p>Your workspace is separate. No execution was started and no other report was substituted.</p><a href="/external">Return to saved evidence</a></main></body></html>`, 'text/html; charset=utf-8');
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'",...(url.pathname.endsWith('/download')?{'Content-Disposition':'attachment; filename="captureproof-recorded-comparison.html"'}:{})});
        return res.end(example.body); // Hash-verified HTML carries its own restrictive script/style CSP.
      }
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [type, contents] = assets.get(url.pathname); return send(200, contents, type);
      }
      if (req.method === 'GET' && url.pathname === '/api/external-reports') return send(200, availableReportCatalog());
      const reportMatch = /^\/api\/external-reports\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && reportMatch) {
        const report = loadExternalReport(reportMatch[1]);
        if (!report) throw new CheckoutError('NOT_FOUND', 404);
        return send(report.availability === 'UNAVAILABLE' ? 503 : 200, report);
      }
      if (req.method === 'GET' && url.pathname === '/api/verifications') {
        if (!verificationJobs) throw new CheckoutError('VERIFICATION_UNAVAILABLE',503);
        const {body:exampleBody,...example}=verifiedExample();
        const {body:bundledBody,...bundled}=bundledExample();
        return send(200,{example,bundledExample:bundled,resultExample:verificationJobs.example?.()??null,choices:VERIFICATION_CHOICES,jobs:verificationJobs.summaries?.()??verificationJobs.list(),campaign:CORE_CAMPAIGN,setup:verificationJobs.readiness?.()??null,candidates:verificationJobs.candidates?.()??[]});
      }
      const portable=/^\/api\/verifications\/([0-9a-f-]{36})\/portable\/([0-9a-f-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&portable){
        if(!verificationJobs?.db)throw new CheckoutError('VERIFICATION_UNAVAILABLE',503);
        if(url.search)throw new CheckoutError('REPORT_INVALID_SELECTION');
        const {files}=portableReportFiles({jobId:portable[1],runId:portable[2]},{store:verificationJobs,includeReduced:false});
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'",'Content-Disposition':`attachment; filename="captureproof-report-${portable[2]}.html"`});
        return res.end(files.get('report.html'));
      }
      const assistanceMatch = /^\/api\/verifications\/([0-9a-f-]{36})\/assistance\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && assistanceMatch) {
        if (!assistance) throw new DiagnosisError('VERIFICATION_UNAVAILABLE');
        return send(200, assistance.preview(assistanceMatch[1], assistanceMatch[2]));
      }
      const executionAnalysis=/^\/api\/verifications\/([0-9a-f-]{36})\/analysis\/([0-9a-f-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&executionAnalysis){if(!verificationJobs)throw new CheckoutError('VERIFICATION_UNAVAILABLE',503);return send(200,verificationJobs.executionDiagnosis(executionAnalysis[1],executionAnalysis[2]));}
      const executionDiagnosis=/^\/api\/verifications\/([0-9a-f-]{36})\/diagnosis\/([0-9a-f-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&executionDiagnosis)return send(200,verificationJobs.prepareExecution(executionDiagnosis[1],executionDiagnosis[2]));
      const replayEvidence=/^\/api\/verifications\/([0-9a-f-]{36})\/(replay-evidence|repair-reproducer)\/([0-9a-f-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&replayEvidence)return send(200,replayEvidence[2]==='replay-evidence'?verificationJobs.replayEvidence(replayEvidence[1],replayEvidence[3]):verificationJobs.repairReproducer(replayEvidence[1],replayEvidence[3]));
      const failureMatch=/^\/api\/verifications\/([0-9a-f-]{36})\/reproducer\/([0-9a-f-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&failureMatch)return send(200,verificationJobs.reproduce(failureMatch[1],failureMatch[2]));
      const verificationMatch=/^\/api\/verifications\/([0-9a-f-]{36})(?:\/(export|repair-review|diagnosis-preparation))?$/.exec(url.pathname);
      if(req.method==='GET' && verificationMatch){
        if(!verificationJobs) throw new CheckoutError('VERIFICATION_UNAVAILABLE',503);
        return send(200,verificationMatch[2]==='diagnosis-preparation'?verificationJobs.prepareDiagnosis(verificationMatch[1]):verificationMatch[2]==='repair-review'?verificationJobs.repair(verificationMatch[1]):verificationJobs.view(verificationMatch[1]));
      }
      const externalDiagnosisMatch = /^\/api\/external-diagnoses\/([a-z0-9-]{1,40})$/.exec(url.pathname);
      if (req.method === 'GET' && externalDiagnosisMatch) {
        if (!externalDiagnoses) throw new DiagnosisError('EXTERNAL_DIAGNOSIS_UNAVAILABLE');
        return send(200, externalDiagnoses.view(externalDiagnosisMatch[1]));
      }
      if (req.method === 'GET' && url.pathname === '/api/config') return send(200, { product: PRODUCT,
        configured: service.provider.configured, testFaultsEnabled: service.enableTestFaults, evidenceMode: service.provider.evidenceMode });
      if (req.method === 'GET' && url.pathname === '/api/orders') return send(200, service.store.list().map(o => service.view(o.id)));
      if (req.method === 'GET' && url.pathname === '/api/runs') return send(200, service.store.listRuns().map(r => runs.view(r.id)));
      const diagnosisMatch = /^\/api\/runs\/([0-9a-f-]{36})\/diagnoses$/.exec(url.pathname);
      if (req.method === 'GET' && diagnosisMatch) {
        if (!diagnoses) throw new DiagnosisError('AI_UNAVAILABLE');
        return send(200, diagnoses.view(diagnosisMatch[1]));
      }
      const runMatch = /^\/api\/runs\/([0-9a-f-]{36})(?:\/(prepare|execute|audit|recover))?$/.exec(url.pathname);
      if (req.method === 'GET' && runMatch && !runMatch[2]) return send(200, runs.view(runMatch[1]));
      const match = /^\/api\/orders\/([0-9a-f-]{36})(?:\/(create|capture|reconcile))?$/.exec(url.pathname);
      if (req.method === 'GET' && match && !match[2]) return send(200, service.view(match[1]));
      if (req.method !== 'POST') throw new CheckoutError('NOT_FOUND', 404);
      // This unauthenticated development server is loopback-only; reject browser cross-origin writes.
      if (req.headers.origin !== service.origin || req.headers['sec-fetch-site'] === 'cross-site') throw new CheckoutError('INVALID_ORIGIN', 403);
      const data = await body(req,url.pathname==='/api/reproductions'?400000:2048);
      if (assistanceMatch) {
        if (!assistance) throw new DiagnosisError('VERIFICATION_UNAVAILABLE');
        return send(200, await assistance.analyze(assistanceMatch[1], assistanceMatch[2], data));
      }
      if(url.pathname==='/api/candidates'){
        if(Object.keys(data).join(',')!=='directory')throw new CheckoutError('CANDIDATE_DIRECTORY_REQUIRED');
        try{return send(201,verificationJobs.importCandidate(data.directory));}catch(e){return send(400,{error:e.code==='INVALID_LOCAL_CANDIDATE'?e.message:'Place a valid candidate.json and listed .cjs files in candidates/<name>/; symlinks and traversal are unsupported.'});}
      }
      if(url.pathname==='/api/verification-plan')return send(200,verificationJobs.previewPlan(data));
      if(url.pathname==='/api/verification-capability'){if(Object.keys(data).length)throw new CheckoutError('EMPTY_BODY_REQUIRED');return send(200,verificationJobs.readiness({force:true}));}
      if(url.pathname==='/api/reproductions')return send(202,verificationJobs.admitReproduction(data));
      if(url.pathname==='/api/verifications'){
        if(!verificationJobs) throw new CheckoutError('VERIFICATION_UNAVAILABLE',503);
        if (Object.hasOwn(data, 'planFingerprint')) {
          const { planFingerprint, launchKey, ...selection } = data;
          if (verificationJobs.previewPlan(selection).fingerprint !== planFingerprint) throw new CheckoutError('VERIFICATION_PLAN_CHANGED', 409);
          return send(202, verificationJobs.admit({ ...selection, launchKey }));
        }
        return send(202,verificationJobs.admit(data));
      }
      if (externalDiagnosisMatch) {
        if (Object.keys(data).length) throw new CheckoutError('EMPTY_BODY_REQUIRED');
        if (!externalDiagnoses) throw new DiagnosisError('EXTERNAL_DIAGNOSIS_UNAVAILABLE');
        return send(200, await externalDiagnoses.analyze(externalDiagnosisMatch[1]));
      }
      if (diagnosisMatch) {
        if (Object.keys(data).length) throw new CheckoutError('EMPTY_BODY_REQUIRED');
        if (!diagnoses) throw new DiagnosisError('AI_UNAVAILABLE');
        return send(200, await diagnoses.analyze(diagnosisMatch[1]));
      }
      if (url.pathname === '/api/runs') {
        if (Object.keys(data).length !== 1 || typeof data.implementation !== 'string') throw new CheckoutError('INVALID_RUN_INPUT');
        return send(201, runs.newRun(data.implementation));
      }
      if (runMatch?.[2]) {
        if (Object.keys(data).length) throw new CheckoutError('EMPTY_BODY_REQUIRED');
        return send(200, await runs[runMatch[2]](runMatch[1]));
      }
      if (url.pathname === '/api/orders') {
        if (Object.keys(data).some(k => k !== 'dropCaptureResponse') ||
            (data.dropCaptureResponse !== undefined && typeof data.dropCaptureResponse !== 'boolean')) throw new CheckoutError('INVALID_ORDER_INPUT');
        return send(201, service.newOrder(data));
      }
      if (!match?.[2]) throw new CheckoutError('NOT_FOUND', 404);
      if (Object.keys(data).length) throw new CheckoutError('EMPTY_BODY_REQUIRED');
      if (service.store.get(match[1]).experimentRunId) throw new CheckoutError('EXPERIMENT_ORDER_USE_RUN_ACTIONS', 409);
      return send(200, await service[match[2]](match[1]));
    } catch (error) {
      send(error instanceof CheckoutError ? error.status : error instanceof DiagnosisError ? (['EXECUTION_AI_PREVIEW_CHANGED','EXECUTION_DIAGNOSIS_IDENTITY_MISMATCH','EXECUTION_AI_CONFIG_MISMATCH'].includes(error.code) ? 409 : 503) : 500,
        { error: error instanceof CheckoutError || error instanceof DiagnosisError ? error.code : 'INTERNAL_ERROR' });
    }
  });
}
