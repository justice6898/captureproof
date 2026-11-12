import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const files=['result.css','result-view.js','execution-assistance.js','external.html','external.css','external.js','external-diagnosis.js','recorded-evidence.js','verification.js','verification-state.mjs','repair-review.js'];
export function createRecordedServer(bundle){
 if(bundle.portableExample){
  const primary=bundle.portableExample;
  return createServer((req,res)=>{
   const reply=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(text);};
   if(req.headers.host!==`127.0.0.1:${serverPort(req)}`)return reply(403,'INVALID_HOST');
   if(req.method!=='GET')return reply(405,'RECORDED_DEMO_READ_ONLY');
   const url=new URL(req.url,`http://${req.headers.host}`);
   if(url.origin!==`http://${req.headers.host}`||url.search)return reply(400,'INVALID_RECORDED_REQUEST');
   const requested=url.pathname.match(/^\/examples\/(reviewed-v6|reviewed-comparison|upstream-pending)(\/download)?$/);
   if(!['/','/external'].includes(url.pathname)&&!requested)return reply(404,'RECORD_NOT_INCLUDED_IN_DEMO');
   const example=requested?(bundle.portableExamples?.[requested[1]]??(primary.url==='/examples/'+requested[1]?primary:null)):primary;
   if(!example)return reply(404,'RECORD_NOT_INCLUDED_IN_DEMO');
   if(!example.available)return reply(503,example.reason??'Recorded example unavailable; no other run substituted.');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'",...(url.pathname.endsWith('/download')?{'Content-Disposition':'attachment; filename="captureproof-recorded-report.html"'}:{})});
   res.end(example.body);
  });
 }

 const assets=new Map(files.map(file=>[file==='external.html'?'/external':`/${file}`,{body:readFileSync(new URL(`../public/${file}`,import.meta.url)),type:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'}]));
 return createServer((req,res)=>{
  const send=(status,body,type='application/json')=>{res.writeHead(status,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(type==='application/json'?JSON.stringify(body):body);};
  if(req.headers.host!==`127.0.0.1:${serverPort(req)}`)return send(403,{error:'INVALID_HOST'});
  if(req.method!=='GET')return send(405,{error:'RECORDED_DEMO_READ_ONLY'});
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname==='/'){res.writeHead(302,{Location:'/external'});return res.end();}
  const asset=assets.get(url.pathname);if(asset)return send(200,asset.body,asset.type);
  if(Object.hasOwn(bundle.routes,url.pathname))return send(200,bundle.routes[url.pathname]);
  return send(404,{error:'RECORD_NOT_INCLUDED_IN_DEMO'});
 });
}
const serverPort=req=>req.socket.localPort;
