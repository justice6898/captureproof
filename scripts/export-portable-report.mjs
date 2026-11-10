import {exportPortableReport,PRIMARY}from '../src/portable-report.mjs';
import {join}from 'node:path';
const [destination,...args]=process.argv.slice(2);
try{
 let selection=PRIMARY;
 if(args.length){
  if(args.length!==6||args[0]!=='--job'||args[2]!=='--run'||args[4]!=='--state')throw Error('INVALID_ARGUMENTS');
  selection={jobId:args[1],runId:args[3],directory:join(args[5],'local-verifications')};
 }
 if(!destination)throw Error('DESTINATION_REQUIRED');
 console.log(JSON.stringify(exportPortableReport(destination,selection),null,2));
}catch(e){console.error(e.code??e.message);console.error('Usage: npm run report:export -- <new-directory> [--job <id> --run <id> --state <originating-state-directory>]');process.exitCode=1;}
