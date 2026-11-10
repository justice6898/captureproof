import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {createVerificationCapability} from '../src/verification-setup.mjs';
import {VerificationJobs} from '../src/verification-jobs.mjs';import {scaffoldCandidate} from '../src/local-candidate.mjs';
const args=process.argv.slice(2),index=args.indexOf('--state');let state='data/verification-workspace';if(index>=0){state=args[index+1];if(!state)throw Error('STATE_DIRECTORY_REQUIRED');args.splice(index,2);}
const [action,arg,extra,output]=args;
if(action==='check'){const result=createVerificationCapability()({force:true});console.log(JSON.stringify(result,null,2));process.exit(result.ready?0:1);}
if(action==='init'){console.log(scaffoldCandidate(arg));process.exit(0);}
const jobs=new VerificationJobs({directory:join(state,'local-verifications')});
try{
 let result;
 if(action==='import')result=jobs.importCandidate(arg);
 else if(action==='run')result=jobs.admit({campaign:'core-1',candidateId:arg,launchKey:randomUUID()});
 else if(action==='resume')result=jobs.retryFailed(arg);
 else if(action==='show'){const view=jobs.view(arg);result={id:view.id,state:view.state,summary:view.summary,reduction:view.reduction,reproduction:view.reproduction,error:view.error,errorDetail:view.errorDetail};}
 else if(action==='export'){if(!output)throw Error('EXPORT_FILE_REQUIRED');writeFileSync(output,JSON.stringify(jobs.reproduce(arg,extra),null,2)+'\n',{flag:'wx',mode:0o600});result={saved:output};}
 else if(['replay','reduce'].includes(action)){const artifactText=readFileSync(arg,'utf8');result=jobs.admitReproduction({action,reproducer:JSON.parse(artifactText),artifactText,launchKey:randomUUID()});}
 else throw Error('Use check, init <name>, import <name>, run <candidate-id|builtin-v3>, show <job>, export <job> <run> <file>, replay <file>, reduce <file>; optional --state <directory>.');
 console.log(JSON.stringify(result?.sources?{id:result.id,state:result.state,maxExecutions:result.plan.maxExecutions}:result,null,2));
}finally{jobs.close();}
