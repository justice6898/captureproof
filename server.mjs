import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { VerificationJobs } from './src/verification-jobs.mjs';
import { ExternalDiagnosisService } from './src/external-diagnosis-service.mjs';
import { DiagnosisStore } from './src/diagnosis-store.mjs';
import { DiagnosisService } from './src/diagnosis-service.mjs';
import { OpenAIDiagnosis } from './src/openai-diagnosis.mjs';
import { OrderStore } from './src/order-store.mjs';
import { PayPalSandbox } from './src/paypal-sandbox.mjs';
import { CheckoutService } from './src/checkout-service.mjs';
import { checkoutServer } from './src/checkout-http.mjs';
import { resolve, join } from 'node:path';
import { ExecutionAssistance } from './src/execution-assistance.mjs';
import { EXTERNAL_CONFIG } from './src/external-diagnosis-service.mjs';
import { EXTERNAL_CONTRACT } from './src/external-diagnosis-contract.mjs';
import { readExecutionApproval, responseOnlyTransport } from './src/execution-assistance-policy.mjs';
import { fileURLToPath } from 'node:url';

export async function startServer({ responseFetch = null, approvalPath = null, apiKey = undefined, providerMode = 'mock-transport', argv = process.argv.slice(2) } = {}) {
  const verificationMode=argv[0]==='--verification';
  const stateDirectory=verificationMode?resolve(argv[2]??fileURLToPath(new URL('./data/verification-workspace',import.meta.url))):fileURLToPath(new URL('./data',import.meta.url));
  const port = Number(verificationMode?(argv[1]??3200):(process.env.PORT??3000));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
  if (process.env.NODE_ENV === 'production') throw new Error('This checkout server is for local Sandbox development only.');
  process.umask(0o077);
  const origin = `http://127.0.0.1:${port}`;
  const store = new OrderStore(join(stateDirectory,'checkout.sqlite'));
  const provider = new PayPalSandbox({ clientId: verificationMode?undefined:process.env.PAYPAL_CLIENT_ID, clientSecret: verificationMode?undefined:process.env.PAYPAL_CLIENT_SECRET });
  const service = new CheckoutService({ store, provider, origin, enableTestFaults: !verificationMode && process.env.ENABLE_TEST_FAULTS === 'true' });
  const diagnoses = new DiagnosisService({ orders: store, records: await DiagnosisStore.open(store.db),
    provider: new OpenAIDiagnosis({ apiKey: verificationMode?undefined:process.env.OPENAI_API_KEY }) });
  // New verification state does not hide historical examples or import payment rows.
  let externalRecords=diagnoses.records;
  if(verificationMode){
    const historyPath=fileURLToPath(new URL('./data/checkout.sqlite',import.meta.url)),history=new Map();
    if(existsSync(historyPath)){
      const source=new DatabaseSync(historyPath,{readOnly:true});
      try{for(const row of source.prepare("SELECT run_id,record FROM diagnoses WHERE run_id LIKE 'external:%' OR run_id LIKE 'execution:%' ORDER BY rowid DESC").all()){
        if(!history.has(row.run_id))history.set(row.run_id,[]);history.get(row.run_id).push(JSON.parse(row.record));
      }}finally{source.close();}
    }
    externalRecords={list:id=>structuredClone(history.get(id)??[]),retainedResponse:id=>{const db=new DatabaseSync(historyPath,{readOnly:true});try{return new DiagnosisStore(db).retainedResponse(id);}finally{db.close();}}};
  }
  // Current attempts stay in this application's store; historical records remain read-only.
  if (verificationMode) {
    const historical = externalRecords, current = diagnoses.records;
    externalRecords = {
      list: id => [...current.list(id), ...historical.list(id)],
      retainedResponse: id => current.retainedResponse(id) ?? historical.retainedResponse(id)
    };
  }
  const externalDiagnoses = new ExternalDiagnosisService({ records: externalRecords });
  const verificationJobs = new VerificationJobs({...(verificationMode?{directory:join(stateDirectory,'local-verifications')}:{}),diagnosisRecords:externalRecords});
  let assistance;
  if (responseFetch && approvalPath) {
    if (!verificationMode) throw Error('LIVE_ASSISTANCE_REQUIRES_VERIFICATION_MODE');
    const liveProvider = new OpenAIDiagnosis({ apiKey, config: EXTERNAL_CONFIG,
      contract: EXTERNAL_CONTRACT, fetchImpl: responseOnlyTransport(responseFetch) });
    liveProvider.mode = providerMode;
    const current = new DiagnosisStore(store.db, { sensitiveValues: [apiKey] });
    const records = { ...externalRecords, reserve: current.reserve.bind(current), save: current.save.bind(current),
      retainResponse: current.retainResponse.bind(current), retainRejected: current.retainRejected.bind(current) };
    assistance = new ExecutionAssistance({ jobs: verificationJobs, records,
      provider: liveProvider, approval: readExecutionApproval(approvalPath), requireAuthorization: true });
  } else {
    assistance = new ExecutionAssistance({ jobs: verificationJobs, records: externalRecords });
  }
  const server = checkoutServer(service, diagnoses, externalDiagnoses, verificationJobs, assistance);
  server.listen(port, '127.0.0.1', () => {
    if(verificationMode){console.log(`CaptureProof local verification: ${origin}/external`);console.log(`Isolated application state: ${stateDirectory}. Actual Medusa/PostgreSQL; simulated provider only.`);return;}
    console.log(`CaptureProof local Sandbox checkout: ${origin}`);
    console.log(provider.configured ? 'Sandbox credentials configured; a transaction still requires manual buyer approval.' : 'Sandbox credentials missing. Configure the ignored .env file before creating a PayPal order.');
    console.log('LIVE SANDBOX NOT VERIFIED by startup. Inspect bound provider read-back evidence for each transaction.');
  });
  const shutdown = () => server.close();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown);
  server.once('close', () => {
    verificationJobs.close(); store.close();
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, shutdown);
  });

  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startServer();
