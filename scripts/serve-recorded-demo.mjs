import { readFileSync } from 'node:fs';
import {verifiedExample} from '../src/verified-example.mjs';
import { createRecordedServer } from '../src/recorded-demo-server.mjs';
if(process.argv[4]){
 let denied=false;try{readFileSync(process.argv[4]);}catch(e){denied=['EPERM','EACCES'].includes(e.code);}
 if(!denied)throw Error('DEMO_FILE_ISOLATION_NOT_ESTABLISHED');
 console.log('File isolation probe PASS; unselected data is inaccessible.');
}
const portable=process.argv[2]==='--portable';
const bundle=portable?{portableExample:verifiedExample()}:JSON.parse(readFileSync(process.argv[2],'utf8'));
if(portable?!bundle.portableExample.available:bundle.version!=='recorded-demo-1')throw Error('INVALID_DEMO_SNAPSHOT');
const port=Number(process.argv[3]);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_DEMO_PORT');
const server=createRecordedServer(bundle);
server.listen(port,'127.0.0.1',()=>console.log(`CaptureProof recorded review: http://127.0.0.1:${port}/external — credentials absent; all writes disabled.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
