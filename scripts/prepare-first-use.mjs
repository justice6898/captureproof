// Explicit source allowlist for the same-host clean first-use verification. No private history.
import {mkdirSync,readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
export const SOURCE_FILES=Object.freeze([
  "README.md",
  "docs/DEMO.md",
  "docs/SUBMISSION.md",
  "src/portable-report.mjs",
  "src/execution-assistance.mjs",
  "src/execution-assistance-policy.mjs",
  "scripts/start-execution-assistance.mjs",
  "public/execution-assistance.js",
  "src/verified-example.mjs",
  "src/replay-verification.mjs",
  "public/portable-report.js",
  "public/portable-report.css",
  "scripts/export-portable-report.mjs",
  "external/medusa-persistence/LICENSE.medusa",
  "LICENSES.md",
  "LICENSE",
  "src/verification-setup.mjs",
  "test/first-use.test.mjs",
  "candidates/intentional-rejection/base.cjs",
  "candidates/intentional-rejection/candidate.json",
  "candidates/intentional-rejection/capture-contract.cjs",
  "candidates/intentional-rejection/capture-recovery-v3.cjs",
  "candidates/intentional-rejection/capture-recovery.cjs",
  "candidates/intentional-rejection/provider.cjs",
  "demo.mjs",
  "external/diagnosis-catalog.json",
  "external/medusa-persistence/candidate-overlay.patch",
  "external/medusa-persistence/candidate-v2.cjs",
  "external/medusa-persistence/candidate-v3.cjs",
  "external/medusa-persistence/candidate.cjs",
  "external/medusa-persistence/capture-contract.cjs",
  "external/medusa-persistence/capture-recovery-v3.cjs",
  "external/medusa-persistence/capture-recovery.cjs",
  "external/medusa-persistence/operations.cjs",
  "external/medusa-persistence/package-lock.json",
  "external/medusa-persistence/package.json",
  "external/medusa-persistence/provenance.json",
  "external/medusa-persistence/published-plugin.json",
  "external/medusa-persistence/repair-reference.json",
  "external/medusa-persistence/repair-scenarios.json",
  "external/medusa-persistence/rules.json",
  "external/medusa-persistence/target-service.cjs",
  "external/rsc-paypal/LICENSE",
  "external/rsc-paypal/README.upstream.md",
  "external/rsc-paypal/manifest.json",
  "external/rsc-paypal/package.json",
  "external/rsc-paypal/service.ts",
  "external/rules.json",
  "package.json",
  "public/checkout.css",
  "public/checkout.js",
  "public/diagnosis.js",
  "public/external-diagnosis.js",
  "public/external.css",
  "public/external.html",
  "public/external.js",
  "public/index.html",
  "public/recorded-evidence.js",
  "public/repair-review.js",
  "public/runs.js",
  "public/verification.js",
  "public/verification-state.mjs",
  "scripts/external-persistence-worker.cjs",
  "scripts/external-provider-model.cjs",
  "scripts/external-worker.mjs",
  "scripts/prepare-first-use.mjs",
  "scripts/prepare-recorded-demo.mjs",
  "scripts/serve-recorded-demo.mjs",
  "scripts/setup-external-persistence.mjs",
  "scripts/start-recorded-demo.mjs",
  "scripts/verification-worker.mjs",
  "scripts/verify-local.mjs",
  "server.mjs",
  "src/checkout-contract.mjs",
  "src/checkout-http.mjs",
  "src/checkout-service.mjs",
  "src/crash-evidence.mjs",
  "src/diagnosis-contract.mjs",
  "src/diagnosis-cost.mjs",
  "src/diagnosis-input.mjs",
  "src/diagnosis-money.mjs",
  "src/diagnosis-presentation.mjs",
  "src/diagnosis-review.mjs",
  "src/diagnosis-service.mjs",
  "src/diagnosis-store.mjs",
  "src/execution-diagnosis.mjs",
  "src/experiment.mjs",
  "src/external-diagnosis-contract.mjs",
  "src/regression-guidance.mjs",
  "src/external-diagnosis-input.mjs",
  "src/external-diagnosis-review.mjs",
  "src/external-diagnosis-service.mjs",
  "src/external-execution.mjs",
  "src/external-observation-contract.mjs",
  "src/external-persistence.mjs",
  "src/external-report.mjs",
  "src/local-candidate.mjs",
  "src/lost-response-runs.mjs",
  "src/openai-diagnosis.mjs",
  "src/order-store.mjs",
  "src/paypal-sandbox.mjs",
  "src/plan-contract.mjs",
  "src/recorded-demo-server.mjs",
  "src/regression-campaign.mjs",
  "src/repair-review.mjs",
  "src/run-auditor.mjs",
  "src/upstream-diagnosis.mjs",
  "src/verdict.mjs",
  "src/verification-jobs.mjs",
  "test-support/offline-network.mjs",
  "test/core.test.mjs"
]);
// Release additions are intentional, fixed files, not a recursive data/workspace copy.
export const RELEASE_ADDITIONS=Object.freeze([
 '.env.example','.gitignore',
 'test/regression-guidance.test.mjs','test-support/regression-controls.mjs',
 'test/bundled-example.test.mjs','test/persistence-uncertainty.test.mjs','test/execution-assistance.test.mjs','test-support/persistence-observations.mjs',
 'test/developer-meaning.test.mjs','test-support/developer-meaning-fixtures.mjs',
 'test/release.test.mjs','test/verification-capability.test.mjs','test/verification-readiness.test.mjs','test/checkout.test.mjs','test/checkout-http.test.mjs',
 'test/paypal-sandbox.test.mjs','test-support/checkout-fixture.mjs',
 'data/portable-reports/developer-reviewed-2026-11-06/report.html',
 'data/portable-reports/developer-reviewed-2026-11-06/manifest.json',
 'data/portable-reports/upstream-pending-replayed-2026-10-29/report.html',
 'data/portable-reports/upstream-pending-replayed-2026-10-29/manifest.json'
]);
export const RELEASE_FILES=Object.freeze([...SOURCE_FILES,...RELEASE_ADDITIONS]);
export const RELEASE_TESTS=Object.freeze(['test/regression-guidance.test.mjs','test/bundled-example.test.mjs','test/persistence-uncertainty.test.mjs','test/execution-assistance.test.mjs','test/core.test.mjs','test/first-use.test.mjs','test/checkout.test.mjs','test/checkout-http.test.mjs','test/paypal-sandbox.test.mjs','test/release.test.mjs','test/verification-readiness.test.mjs','test/developer-meaning.test.mjs']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function releaseContents(path,bytes){
 if(path==='README.md'){
  const text=bytes.toString('utf8'),a=text.indexOf('<!-- release:start -->'),b=text.indexOf('<!-- release:end -->');
  if(a<0&&text.startsWith('# CaptureProof — release candidate'))return bytes;
  if(a<0||b<=a)throw Error('RELEASE_README_BOUNDARY_MISSING');
  return Buffer.from(text.slice(a+'<!-- release:start -->'.length,b).trim()+'\n');
 }
 if(path==='package.json'){
  const pkg=JSON.parse(bytes);
  pkg.scripts.test='node --import ./test-support/offline-network.mjs --test '+RELEASE_TESTS.join(' ');
  pkg.scripts['start:demo']=pkg.scripts['start:example'];
  delete pkg.scripts['test:external'];delete pkg.scripts['external:explore'];
  return Buffer.from(JSON.stringify(pkg,null,2)+'\n');
 }
 return bytes;
}
export function prepareFirstUse(destination,{release=false,manifestOnly=false}={}){
 if(manifestOnly&&!release)throw Error('Manifest-only mode requires a release file set.');
 if(!destination)throw Error('Provide a new, empty destination path. Existing directories are never overwritten.');
 const target=resolve(destination);realpathSync(dirname(target));
 if(target===resolve(root)||resolve(root).startsWith(target+'/'))throw Error('Destination cannot contain the original workspace.');
 const entries=(release?RELEASE_FILES:SOURCE_FILES).map(path=>{
  const source=join(root,path);if(!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw Error('Only declared regular source files may be copied: '+path);
  const original=readFileSync(source),contents=release?releaseContents(path,original):original;
  return {path,contents,sha256:sha(contents),bytes:contents.length,...(release&&sha(contents)!==sha(original)?{derivedFrom:{path,sha256:sha(original),transformation:path==='README.md'?'Release entry section only; workspace history omitted.':'Offline test selection; recorded demo alias; omitted commands requiring excluded historical tests.'}}:{})};
 });
 if(release){
  const env=entries.find(e=>e.path==='.env.example').contents.toString('utf8');
  const values=new Map(env.split('\n').filter(l=>l.trim()&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
  for(const key of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','OPENAI_API_KEY'])if(!/^(?:|your[-_][a-z_-]+|replace[-_][a-z_-]+)$/.test(values.get(key)??'MISSING'))throw Error('ENV_EXAMPLE_NOT_PLACEHOLDER: '+key);
  const report=entries.find(e=>e.path==='data/portable-reports/upstream-pending-replayed-2026-10-29/report.html'),manifest=JSON.parse(entries.find(e=>e.path==='data/portable-reports/upstream-pending-replayed-2026-10-29/manifest.json').contents);
  for(const r of entries.filter(e=>e.path.endsWith('/report.html'))){const manifestPath=r.path.replace(/report\.html$/,'manifest.json'),m=JSON.parse(entries.find(e=>e.path===manifestPath).contents);if(m.files.find(f=>f.path==='report.html')?.sha256!==r.sha256)throw Error('RELEASE_REPORT_MANIFEST_MISMATCH');}
  if(report.sha256!=='9c81ed56f2f24bfb2bf7ab7a94734835c15e37fe4ea62e7c9011000e7e5b08a3'||manifest.files.find(f=>f.path==='report.html')?.sha256!==report.sha256)throw Error('RELEASE_EXAMPLE_IDENTITY_MISMATCH');
 }
 const files=entries.map(({contents,...entry})=>entry);
 const manifest={format:'captureproof-source-bundle-1',kind:release?'RELEASE_CANDIDATE':'SOURCE_ONLY',files,scope:'macOS Apple Silicon, Node 24+, pinned Medusa 2.7.0/PayPal SDK 1.0.0; simulated provider',excluded:['credentials and actual environment files','node_modules','private databases','private responses and cost ledgers','unselected historical execution artifacts'],recordedAiIncluded:release,...(release?{example:{path:'data/portable-reports/upstream-pending-replayed-2026-10-29/report.html',representation:'Unchanged self-contained selected export; historical semantic PARTIAL retained; no database bundled.'},licenseStatus:'MIT; Copyright (c) 2026 Jeongui Hong; third-party notices retained',testCommand:'npm test'}:{})};
 if(manifestOnly){
  manifest.assembly='MANIFEST_ONLY; files have not been staged, installed or executed as this candidate';
  writeFileSync(target,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {manifest:target,fileCount:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),assembled:false};
 }
 mkdirSync(target,{mode:0o700});
 for(const {contents,...entry} of entries){const out=join(target,entry.path);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,contents,{flag:'wx',mode:0o600});}
 writeFileSync(join(target,'source-bundle.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return {directory:target,fileCount:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),recordedAiIncluded:release};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const release=process.argv[2]==='--release',manifestOnly=release&&process.argv[3]==='--manifest';console.log(JSON.stringify(prepareFirstUse(process.argv[manifestOnly?4:release?3:2],{release,manifestOnly})));}catch(e){console.error(e.code??e.message);process.exitCode=1;}}
