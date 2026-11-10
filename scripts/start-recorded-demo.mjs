import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { verifiedExample } from '../src/verified-example.mjs';
const portable=process.argv[2]==='--portable';
const port=Number(process.argv[portable?3:2]??3100);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_DEMO_PORT');
if(process.platform!=='darwin')throw Error('RECORDED_DEMO_REQUIRES_VERIFIED_MACOS_SANDBOX');
const root=fileURLToPath(new URL('../',import.meta.url)),node=realpathSync(process.execPath);
let snapshot,canary;
if(portable){
 const example=verifiedExample();if(!example.available)throw Error('RECORDED_EXAMPLE_UNAVAILABLE: '+example.reason);
 snapshot='--portable';console.log(`Verified portable example: SHA-256 ${example.sha256}; no database or credentials required.`);
}else{
 const {prepareRecordedDemo}=await import('./prepare-recorded-demo.mjs');
 const prepared=prepareRecordedDemo();snapshot=realpathSync(prepared.path);
 canary=join(dirname(snapshot),'not-exported-canary');writeFileSync(canary,'nonsecret isolation probe',{flag:'wx',mode:0o600});
 console.log(`Selected recorded artifacts: ${prepared.path} (${prepared.bytes} bytes; SHA-256 ${prepared.sha256})`);
}
const entry=join(root,'scripts/serve-recorded-demo.mjs'),guard=join(root,'test-support/offline-network.mjs');
const q=JSON.stringify;
// Reuse the local worker's macOS sandbox approach: only selected evidence/public code is readable.
const exampleDirectory=join(root,'data/portable-reports/upstream-pending-replayed-2026-10-29');
const paths=[node,...(portable?[join(exampleDirectory,'report.html'),join(exampleDirectory,'manifest.json')]:[snapshot]),entry,guard,join(root,'src/verified-example.mjs'),join(root,'package.json'),join(root,'src/recorded-demo-server.mjs')];
const profile=`(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var") (subpath "/private/tmp"))(allow file-read-metadata)(allow file-read* ${paths.map(p=>`(literal ${q(p)})`).join(' ')} (subpath ${q(join(root,'public'))}))(allow network-bind (local ip "localhost:${port}"))(allow network-inbound (local ip "localhost:${port}"))`;
const child=spawn('/usr/bin/sandbox-exec',['-p',profile,node,'--import',guard,entry,snapshot,String(port),...(canary?[canary]:[])],{cwd:portable?root:dirname(snapshot),env:{PATH:'/usr/bin:/bin'},stdio:'inherit'});
child.on('error',()=>{console.error('Recorded demo sandbox could not start. No fallback server was started.');process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
