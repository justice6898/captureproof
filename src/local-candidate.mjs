import {readFileSync,lstatSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {Script} from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
export const candidateHash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const CANDIDATE_TARGET='@rsc-labs/medusa-paypal-payment@0.0.2';
export const CANDIDATE_BASE='a59c2e7ba870bcf29794d2aab547a14f373fa42179dbaef793e4b8b356b1ea0a';
const fail=message=>{throw Object.assign(new Error(message),{code:'INVALID_LOCAL_CANDIDATE'});};
export function validateCandidate(bundle){
 if(!bundle||bundle.format!=='captureproof-medusa-candidate-1'||bundle.target!==CANDIDATE_TARGET||bundle.baseSha256!==CANDIDATE_BASE||bundle.integration!=='captureproof-v3')fail('Use captureproof-medusa-candidate-1 with the pinned 0.0.2 base and captureproof-v3 host/operation integration.');
 if(typeof bundle.name!=='string'||! /^[\w .()-]{1,80}$/.test(bundle.name)||bundle.entry!=='provider.cjs'||!Array.isArray(bundle.files)||!bundle.files.length||bundle.files.length>8)fail('Provide a name, provider.cjs entry and 1–8 CommonJS files.');
 const names=new Set();let bytes=0;
 for(const f of bundle.files){if(!f||Object.keys(f).sort().join(',')!=='content,path'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.cjs$/.test(f.path)||names.has(f.path)||['worker.cjs','target.cjs','provider-model.cjs'].includes(f.path)||typeof f.content!=='string'||Buffer.byteLength(f.content)>40000)fail('Only unique flat .cjs filenames up to 40 KB are accepted; no traversal or directories.');names.add(f.path);bytes+=Buffer.byteLength(f.content);try{new Script(f.content,{filename:f.path});}catch{fail(`Invalid JavaScript syntax in ${f.path}.`);}}
 for(const f of bundle.files)for(const match of f.content.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g))if(!names.has(match[1]))fail(`Missing local dependency ${match[1]} required by ${f.path}; list it in candidate.json.`);
 if(!names.has(bundle.entry)||bytes>120000)fail('Missing provider.cjs or total source exceeds 120 KB.');
 // Syntax validation never executes developer code or promises hostile-code security.
 const result={format:bundle.format,target:bundle.target,baseSha256:bundle.baseSha256,integration:bundle.integration,name:bundle.name,entry:bundle.entry,files:[...bundle.files].sort((a,b)=>a.path.localeCompare(b.path))};
 const id=candidateHash(result);if(bundle.id&&bundle.id!==id)fail('Candidate content does not match its saved digest.');return {...result,id};
}
export function builtinCandidate(){const base=join(root,'external/medusa-persistence');return validateCandidate({format:'captureproof-medusa-candidate-1',target:CANDIDATE_TARGET,baseSha256:CANDIDATE_BASE,integration:'captureproof-v3',name:'Existing revision 3',entry:'provider.cjs',files:[['provider.cjs','candidate-v3.cjs'],['capture-recovery-v3.cjs','capture-recovery-v3.cjs'],['capture-recovery.cjs','capture-recovery.cjs'],['capture-contract.cjs','capture-contract.cjs']].map(([path,file])=>({path,content:readFileSync(join(base,file),'utf8')}))});}
export function readLocalCandidate(slug){
 if(typeof slug!=='string'||! /^[a-z0-9][a-z0-9_-]{0,60}$/.test(slug))fail('Place the candidate in candidates/<simple-name>/ and supply only that name.');
 const base=join(root,'candidates'),dir=join(base,slug);
 for(const path of [base,dir])if(lstatSync(path).isSymbolicLink()||realpathSync(path)!==resolve(path))fail('Candidate directory and ancestors must not be symbolic links.');
 const read=name=>{const path=join(dir,name);const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>40000)fail('Candidate files must be regular files up to 40 KB.');return readFileSync(path,'utf8');};
 const manifest=JSON.parse(read('candidate.json'));
 if(!Array.isArray(manifest.files)||manifest.files.some(name=>typeof name!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.cjs$/.test(name)))fail('List flat .cjs filenames in candidate.json.');
 return validateCandidate({...manifest,files:manifest.files.map(path=>({path,content:read(path)}))});
}
export function scaffoldCandidate(slug){
 if(! /^[a-z0-9][a-z0-9_-]{0,60}$/.test(slug))fail('Use a simple candidate directory name.');
 const base=join(root,'candidates');mkdirSync(base,{recursive:true});if(lstatSync(base).isSymbolicLink()||realpathSync(base)!==resolve(base))fail('Candidate root must not be a symlink.');const dir=join(base,slug);mkdirSync(dir);const b=builtinCandidate();
 for(const f of b.files)writeFileSync(join(dir,f.path),f.content,{flag:'wx',mode:0o600});
 writeFileSync(join(dir,'candidate.json'),JSON.stringify({...b,name:slug,files:b.files.map(f=>f.path),id:undefined},null,2),{flag:'wx',mode:0o600});return dir;
}
