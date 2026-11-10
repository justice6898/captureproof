import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,accessSync,constants} from 'node:fs';
import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
// Read-only prerequisites. Does not launch PostgreSQL, install packages or read credentials.
export function verificationReadiness({directory=root,platform=process.platform,arch=process.arch,node=process.versions.node}={}){
 const blocked=(code,message)=>({ready:false,code,message,command:'npm run external:setup',platform:'macOS Apple Silicon',node:'24+'});
 if(platform!=='darwin'||arch!=='arm64'||Number(node.split('.')[0])<24)return blocked('UNSUPPORTED_VERIFICATION_HOST','Use macOS on Apple Silicon with Node.js 24 or newer. Other platforms are not supported.');
 if(!existsSync('/usr/bin/sandbox-exec'))return blocked('SANDBOX_EXEC_REQUIRED','macOS sandbox-exec is required; isolation will not be disabled.');
 const runtime=join(directory,'external/medusa-persistence');
 try{
  const manifest=JSON.parse(readFileSync(join(runtime,'provenance.json')));
  for(const [name,version]of Object.entries(manifest.versions))if(JSON.parse(readFileSync(join(runtime,'node_modules',name,'package.json'))).version!==version)return blocked('PINNED_DEPENDENCY_MISMATCH','Installed package versions differ from the pinned manifest. Run npm run external:setup.');
  for(const [path,expected]of Object.entries(manifest.files))if(createHash('sha256').update(readFileSync(join(runtime,path))).digest('hex')!==expected)return blocked('PINNED_FILE_MISMATCH','A pinned runtime file differs. Restore the declared source/lockfile and run npm run external:setup.');
  for(const name of ['initdb','postgres'])accessSync(join(runtime,'node_modules/@embedded-postgres/darwin-arm64/native/bin',name),constants.X_OK);
  return {ready:true,code:'READY',message:'Pinned dependencies are present. A launch still must pass runtime isolation and independent evidence checks.',platform:'macOS Apple Silicon',node:'24+'};
 }catch{return blocked('DEPENDENCIES_NOT_READY','Pinned Medusa/PostgreSQL dependencies are missing or unreadable. Run npm run external:setup, then npm run verify -- check.');}
}

// This executes only the OS utility `true`, never candidate code or a database.
// A parent sandbox can forbid applying a child sandbox even when every package exists.
export function isolationCapability({run=spawnSync}={}){
 const r=run('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)(deny file-write*)(deny process-fork)','/usr/bin/true'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:2000,maxBuffer:4096});
 if(r.error?.code==='ETIMEDOUT')return {ready:false,code:'ISOLATION_PROBE_TIMEOUT',message:'The bounded isolation check timed out. Recheck capability before launching.'};
 if(r.status!==0)return {ready:false,code:'ISOLATION_UNAVAILABLE',message:'This process cannot start an isolated worker. Launch CaptureProof from a normal Terminal outside a parent sandbox. Candidate isolation will never be disabled.',reason:/sandbox_apply/.test(r.stderr??'')?'SANDBOX_APPLICATION_DENIED':'PROBE_FAILED',command:'npm run start:verification -- 3502 data/verification-repair-workspace'};
 return {ready:true,code:'ISOLATION_READY',message:'Child sandbox creation succeeded; each execution still verifies its isolation boundaries.'};
}
export function createVerificationCapability({dependencies=verificationReadiness,probe=isolationCapability,now=Date.now,ttl=30000}={}){
 let cached;
 return ({force=false}={})=>{
  if(force||!cached||now()-cached.at>=ttl){const dependency=dependencies(),isolation=dependency.ready?probe():{ready:false,code:'NOT_CHECKED',message:'Install required dependencies before checking isolation.'};cached={at:now(),dependency,isolation};}
  const {dependency,isolation}=cached,blocking=dependency.ready?isolation:dependency;
  return {...blocking,ready:dependency.ready&&isolation.ready,code:dependency.ready&&isolation.ready?'READY':blocking.code,dependencies:dependency,isolation,recordedViewing:{ready:true},checkedAt:new Date(cached.at).toISOString(),expiresAt:new Date(cached.at+ttl).toISOString()};
 };
}
