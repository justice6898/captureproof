import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,lstatSync,mkdtempSync,rmSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {RELEASE_FILES,RELEASE_TESTS,prepareFirstUse} from '../scripts/prepare-first-use.mjs';
import {verifiedExample} from '../src/verified-example.mjs';
import {createRecordedServer} from '../src/recorded-demo-server.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
test('release allowlist is explicit, contains no private state, and closes relative JS import dependencies',()=>{
 assert.equal(new Set(RELEASE_FILES).size,RELEASE_FILES.length);
 for(const path of RELEASE_FILES){assert.ok(!path.includes('..'));assert.ok(!/(^|\/)(node_modules|evaluation|\.env|\.env\.local)(\/|$)|\.sqlite|\.log$/.test(path),path);assert.ok(lstatSync(join(root,path)).isFile());
  if(!/\.(mjs|cjs|js)$/.test(path))continue;
  const source=readFileSync(join(root,path),'utf8');
  for(const m of source.matchAll(/(?:\bfrom\s*['"](\.[^'"]+)['"]|\b(?:import|require)\s*\(\s*['"](\.[^'"]+)['"]\s*\))/g)){
   const imported=m[1]??m[2];
   if(path==='scripts/external-persistence-worker.cjs'&&imported==='./provider-model.cjs'){
    assert.ok(RELEASE_FILES.includes('scripts/external-provider-model.cjs'));
    assert.ok(readFileSync(join(root,'src/external-persistence.mjs'),'utf8').includes("writeFileSync(join(workspace,'provider-model.cjs'),readFileSync(join(root,'scripts/external-provider-model.cjs')))"));continue;
   }
   const target=relative(root,resolve(root,dirname(path),imported));assert.ok(RELEASE_FILES.includes(target),`${path} requires omitted ${target}`);
  }
 }
 assert.deepEqual(RELEASE_FILES.filter(p=>p.startsWith('data/')),['data/portable-reports/developer-reviewed-2026-11-06/report.html','data/portable-reports/developer-reviewed-2026-11-06/manifest.json','data/portable-reports/upstream-pending-replayed-2026-10-29/report.html','data/portable-reports/upstream-pending-replayed-2026-10-29/manifest.json']);
 for(const p of RELEASE_TESTS)assert.ok(RELEASE_FILES.includes(p));
});
test('selected example remains exact, includes verified downloads and no machine paths',()=>{
 const example=verifiedExample();assert.equal(example.available,true);const text=example.body.toString('utf8');assert.equal(/\/Users\/|\/home\/|\/private\/tmp\//.test(text),false);
 const data=JSON.parse(text.match(/<script type="application\/json" id="report-data">(.*?)<\/script>/s)[1]);
 assert.equal(data.primary.analysis.records[0].semanticReviewStatus,'PARTIAL');assert.equal(data.primary.analysis.records[0].reusable,false);
 for(const file of data.exportFiles){const m=data.manifest.files.find(f=>f.path===file.path);assert.equal(sha(file.content),m.sha256);assert.equal(Buffer.byteLength(file.content),m.bytes);}
 assert.equal(data.replayVerification.upstream.status,'REPRODUCED');assert.equal(data.replayVerification.repair.status,'NOT_REPRODUCED');
});
test('recorded portable server only serves fixed hash-verified HTML and refuses writes or arbitrary files',async t=>{
 const example=verifiedExample(),server=createRecordedServer({portableExample:example});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const origin=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/external','/examples/upstream-pending/download']){const r=await fetch(origin+path);assert.equal(r.status,200);assert.equal(sha(Buffer.from(await r.arrayBuffer())),example.sha256);}
 assert.equal((await fetch(origin+'/external',{method:'POST'})).status,405);
 for(const path of ['/api/verifications','/.env','/data/checkout.sqlite'])assert.equal((await fetch(origin+path)).status,404);
 assert.equal((await fetch(origin+'/external?path=../.env')).status,400);
});
test('staged manifest hashes match all selected files and adopted MIT license retains exact attribution',()=>{
 const license=readFileSync(join(root,'LICENSE'),'utf8');
 assert.match(license,/^MIT License\n\nCopyright \(c\) 2026 Jeongui Hong\n/);
 assert.match(license,/Permission is hereby granted, free of charge/);assert.match(license,/THE SOFTWARE IS PROVIDED "AS IS"/);
 assert.equal(JSON.parse(readFileSync(join(root,'package.json'))).license,'MIT');
 assert.ok(RELEASE_FILES.includes('LICENSE'));assert.ok(!RELEASE_FILES.includes('LICENSE-PROPOSED.txt'));
 for(const path of ['external/rsc-paypal/LICENSE','external/medusa-persistence/LICENSE.medusa']){assert.ok(RELEASE_FILES.includes(path));assert.match(readFileSync(join(root,path),'utf8'),/Copyright/);}
 if(existsSync(join(root,'LICENSE-PROPOSED.txt'))){const proposal=readFileSync(join(root,'LICENSE-PROPOSED.txt'),'utf8');assert.match(proposal,/PROPOSAL ONLY — NOT AN ADOPTED LICENSE/);assert.equal(license.split('Permission is hereby granted')[1],proposal.split('Permission is hereby granted')[1]);}
 const path=join(root,'source-bundle.json');if(!existsSync(path))return;
 const manifest=JSON.parse(readFileSync(path));if(manifest.kind!=='RELEASE_CANDIDATE')return;
 assert.deepEqual(manifest.files.map(f=>f.path),RELEASE_FILES);
 for(const f of manifest.files){const b=readFileSync(join(root,f.path));assert.equal(sha(b),f.sha256,f.path);assert.equal(b.length,f.bytes);}
 const pkg=JSON.parse(readFileSync(join(root,'package.json')));assert.equal(pkg.scripts.test,'node --import ./test-support/offline-network.mjs --test '+RELEASE_TESTS.join(' '));assert.equal(pkg.scripts['start:demo'],pkg.scripts['start:example']);
 assert.equal(existsSync(join(root,'.env')),false);assert.equal(existsSync(join(root,'external/medusa-persistence/node_modules')),false);
});

test('CLI preflight creates no job database when prerequisites are missing or present',t=>{
 const cwd=mkdtempSync(join(tmpdir(),'cp-release-preflight-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,['--import',join(root,'test-support/offline-network.mjs'),join(root,'scripts/verify-local.mjs'),'check'],{cwd,env:{PATH:process.env.PATH},encoding:'utf8'});
 assert.ok([0,1].includes(result.status));assert.ok(JSON.parse(result.stdout).code);assert.equal(existsSync(join(cwd,'data')),false);
});


test('manifest-only release lists exact publishable bytes without copying packages or state',t=>{
 const dir=mkdtempSync(join(tmpdir(),'cp-publication-manifest-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'publication.json'),result=prepareFirstUse(path,{release:true,manifestOnly:true});
 assert.equal(result.assembled,false);assert.deepEqual(readdirSync(dir),['publication.json']);
 const bytes=readFileSync(path),manifest=JSON.parse(bytes);
 assert.match(manifest.assembly,/MANIFEST_ONLY/);assert.equal(manifest.licenseStatus,'MIT; Copyright (c) 2026 Jeongui Hong; third-party notices retained');
 assert.deepEqual(manifest.files.map(f=>f.path),RELEASE_FILES);
 for(const f of manifest.files){
  const original=readFileSync(join(root,f.path));let intended=original;
  if(f.path==='README.md'&&original.includes('<!-- release:start -->'))intended=Buffer.from(original.toString().split('<!-- release:start -->')[1].split('<!-- release:end -->')[0].trim()+'\n');
  if(f.path==='package.json'){const p=JSON.parse(original);p.scripts.test='node --import ./test-support/offline-network.mjs --test '+RELEASE_TESTS.join(' ');p.scripts['start:demo']=p.scripts['start:example'];delete p.scripts['test:external'];delete p.scripts['external:explore'];intended=Buffer.from(JSON.stringify(p,null,2)+'\n');}
  assert.equal(sha(intended),f.sha256,f.path);assert.equal(intended.length,f.bytes);
  if(f.derivedFrom)assert.equal(f.derivedFrom.sha256,sha(original));
 }
 assert.throws(()=>prepareFirstUse(path,{release:true,manifestOnly:true}),{code:'EEXIST'});assert.deepEqual(readFileSync(path),bytes);
 assert.throws(()=>prepareFirstUse(join(dir,'invalid'),{manifestOnly:true}),/requires a release/);
 assert.deepEqual(readdirSync(dir),['publication.json']);
});

test('public evidence remains addable while private data, secrets and nested releases stay ignored',t=>{
 const dir=mkdtempSync(join(tmpdir(),'cp-public-ignore-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const env={PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 const init=spawnSync('git',['-c','init.defaultBranch=main','init','--quiet','--template=',dir],{env,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
 // Only a disposable test repository; no remote, original Git state or user configuration.
 const ignore=readFileSync(join(root,'.gitignore'));
 writeFileSync(join(dir,'.gitignore'),ignore);
 const publicPaths=['LICENSE','.env.example',...RELEASE_FILES.filter(p=>p.startsWith('data/'))];
 const privatePaths=['.env','.env.local','data/checkout.sqlite','data/private-diagnosis-reviews/response.json','data/portable-reports/other/report.html','data/portable-reports/developer-reviewed-2026-11-06/evidence.json','node_modules/example/index.js','staging/old/source-bundle.json','releases/old/source-bundle.json'];
 const result=spawnSync('git',['-C',dir,'-c','core.excludesfile=/dev/null','check-ignore','--no-index','--stdin'],{env,input:[...publicPaths,...privatePaths].join('\n')+'\n',encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.trim().split('\n').sort(),privatePaths.sort());
});
