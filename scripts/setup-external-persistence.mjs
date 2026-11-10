import {fileURLToPath} from 'node:url';
// Public-package setup only; install scripts and inherited npm configuration are disabled.
import { readFileSync, writeFileSync, mkdtempSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const runtime = join(root,'external/medusa-persistence');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('REQUIRES_MACOS_ARM64');
if (process.argv.includes('--install')) {
  const temp = mkdtempSync(join(tmpdir(),'cp-npm-'));
  try {
    writeFileSync(join(temp,'globalrc'),'');
    const child = spawnSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund','--userconfig=/dev/null',`--globalconfig=${temp}/globalrc`,'--cache=/tmp/captureproof-npm-cache'], {cwd:runtime,env:{PATH:process.env.PATH,LANG:'C',TZ:'UTC'},stdio:'inherit'});
    if(child.status !== 0) throw new Error('DEPENDENCY_SETUP_FAILED');
  } finally { rmSync(temp,{recursive:true,force:true}); }
}
if(!existsSync(join(runtime,'node_modules/typescript/package.json')))throw new Error('DEPENDENCIES_NOT_READY: run npm run external:setup to install the pinned dependencies.');
const nativeRoot=join(runtime,'node_modules/@embedded-postgres/darwin-arm64');
for(const {source,target} of JSON.parse(readFileSync(join(nativeRoot,'native/pg-symlinks.json')))) {
  if (![source,target].every(x=>x.startsWith('native/')&&!x.split('/').includes('..'))) throw new Error('UNSAFE_SYMLINK');
  const a=join(nativeRoot,source),b=join(nativeRoot,target);
  if(!existsSync(b))symlinkSync(relative(dirname(b),a),b);
}
const require=createRequire(join(runtime,'package.json')), ts=require('typescript');
const output=ts.transpileModule(readFileSync(join(root,'external/rsc-paypal/service.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText;
const printer=ts.createPrinter({removeComments:true});
const normalize=s=>printer.printFile(ts.createSourceFile('service.js',s,ts.ScriptTarget.ES2021,true,ts.ScriptKind.JS));
if(normalize(output)!==normalize(readFileSync(join(runtime,'target-service.cjs'),'utf8')))throw new Error('PUBLISHED_SOURCE_MISMATCH');
const manifest=JSON.parse(readFileSync(join(runtime,'provenance.json')));
for(const [name,version] of Object.entries(manifest.versions)) {
  if(JSON.parse(readFileSync(join(runtime,'node_modules',name,'package.json'))).version!==version)throw new Error('VERSION_MISMATCH '+name);
}
for(const [path,expected] of Object.entries(manifest.files))if(createHash('sha256').update(readFileSync(join(runtime,path))).digest('hex')!==expected)throw new Error('PINNED_FILE_MISMATCH '+path);
console.log(JSON.stringify({publishedSourceParity:true,versions:manifest.versions,ready:true}));
