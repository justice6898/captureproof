import{readFileSync}from'node:fs';import{fileURLToPath}from'node:url';import{createHash}from'node:crypto';
const directory=fileURLToPath(new URL('../data/portable-reports/upstream-pending-replayed-2026-10-29/',import.meta.url));
const expected='9c81ed56f2f24bfb2bf7ab7a94734835c15e37fe4ea62e7c9011000e7e5b08a3';
// Fixed selected artifact only. Request paths and IDs never become filesystem paths.
export function verifiedExample({read=readFileSync}={}){
 try{const body=read(directory+'report.html'),manifest=JSON.parse(read(directory+'manifest.json'));const sha=createHash('sha256').update(body).digest('hex');if(sha!==expected||manifest.files.find(f=>f.path==='report.html')?.sha256!==sha)throw Error('EXAMPLE_INTEGRITY');return {available:true,title:'Provider pending. Merchant already paid.',url:'/examples/upstream-pending',download:'/examples/upstream-pending/download',sha256:sha,body};}
 catch(e){return {available:false,reason:e.code==='ENOENT'?'This source workspace has no recorded example. Open a separately supplied portable report, or import a candidate to run your own verification.':'Recorded example failed its integrity check. Preserve it and restore the matching report and manifest; no execution was started.'};}
}

// The reviewed export is a catalog entry, not a UI branch for a particular job.
export function reviewedSelection({read=readFileSync}={}){
 const base=fileURLToPath(new URL('../data/portable-reports/developer-reviewed-2026-11-06/',import.meta.url));
 const bytes=read(base+'evidence.json'),manifest=JSON.parse(read(base+'manifest.json'));
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.files.find(f=>f.path==='evidence.json')?.sha256)throw Error('REVIEW_SELECTION_INTEGRITY');
 const p=JSON.parse(bytes).primary;
 return {jobId:p.jobId,runId:p.execution.runId,caseId:p.caseId,artifactSha256:p.reproducer.origin.artifactSha256};
}
