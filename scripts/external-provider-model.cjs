// Provider scenario state lives on disk, independently of merchant-worker memory.
// No branch inspects the selected implementation. Transitions are explicit actions.
const fs=require('node:fs');
module.exports=(config,record)=>{
  const file=config.providerStatePath;
  const copy=x=>JSON.parse(JSON.stringify(x));
  const initial={order:null,capture:null,capturePostAttempts:0,acceptedOperations:0,requestIds:[],lookupFault:null,hideCapture:false};
  const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):copy(initial);
  const save=s=>{fs.writeFileSync(file+'.tmp',JSON.stringify(s),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  const money={currency_code:'USD',value:'12.00'};
  function action(name){
    const s=read();
    if(name==='authorize'){
      s.order.status='COMPLETED';s.order.purchase_units[0].payments={authorizations:[{id:config.ids.authorization,status:'CREATED',amount:money}]};
    }else if(name==='settle'){
      if(s.capture?.status!=='PENDING')throw new Error('INVALID_SETTLEMENT');
      s.capture.status='COMPLETED';delete s.capture.status_details;s.order.purchase_units[0].payments.captures=[s.capture];
    }else if(name==='lookup-unavailable'||name.startsWith('invalid-'))s.lookupFault=name;
    else if(name==='restore')s.lookupFault=null;
    else if(name==='hide-capture')s.hideCapture=true;
    else if(name==='reveal-capture')s.hideCapture=false;
    else throw new Error('UNKNOWN_PROVIDER_ACTION');
    save(s);record('scenario_action',{action:name,provider:copy(s)});
  }
  function view(s,kind){
    let result=copy(kind==='order'?s.order:s.capture);
    if(kind==='order'&&s.hideCapture)delete result.purchase_units[0].payments.captures;
    const captures=kind==='order'?(result.purchase_units?.[0]?.payments?.captures??[]):[result];
    for(const c of captures){
      if(s.lookupFault==='invalid-amount')c.amount.value='1200.00';
      if(s.lookupFault==='invalid-currency')c.amount.currency_code='EUR';
      if(s.lookupFault==='invalid-id')c.id='DIFFERENTCAPTURE01';
      if(s.lookupFault==='invalid-missing-amount')delete c.amount;
    }
    return result;
  }
  const transport=async request=>{
    const url=new URL(request.url);
    if(url.origin!=='https://api-m.sandbox.paypal.com')throw new Error('UNEXPECTED_PROVIDER_HOST');
    const respond=(status,body)=>({data:JSON.stringify(body),status,headers:{'content-type':'application/json'},config:request});
    if(url.pathname==='/v1/oauth2/token')return respond(200,{access_token:'local-simulator-only',token_type:'Bearer',expires_in:3600});
    const s=read(),method=request.method.toUpperCase(),input=request.data?JSON.parse(request.data):null;
    const requestId=request.headers?.get?.('PayPal-Request-Id')??request.headers?.['PayPal-Request-Id']??null;
    record('provider_request',{method,path:url.pathname,body:input,requestId});
    let status=200,body;
    if(method==='POST'&&url.pathname==='/v2/checkout/orders'){
      if(s.order||input.intent!=='AUTHORIZE'||input.purchase_units[0].amount.value!=='12'||input.purchase_units[0].amount.currency_code!=='USD')throw new Error('CREATE_BINDING_MISMATCH');
      s.order={id:config.ids.order,intent:'AUTHORIZE',status:'CREATED',purchase_units:[{reference_id:'default',amount:money}]};body=s.order;status=201;
    }else if(method==='GET'&&(url.pathname===`/v2/checkout/orders/${config.ids.order}`||url.pathname===`/v2/payments/captures/${s.capture?.id}`)){
      if(s.lookupFault==='lookup-unavailable'){status=500;body={name:'INTERNAL_SERVER_ERROR',message:'Simulated lookup unavailable.'};}
      else body=view(s,url.pathname.includes('/checkout/')?'order':'capture');
    }else if(method==='POST'&&url.pathname===`/v2/payments/authorizations/${config.ids.authorization}/capture`){
      s.capturePostAttempts++;s.requestIds.push(requestId);
      if(input&&(input.amount?.value!=='12.00'||input.amount?.currency_code!=='USD'||input.final_capture!==true))throw new Error('CAPTURE_PARAMETER_MISMATCH');
      if(s.capture&&requestId&&s.requestIds[0]===requestId&&(!config.crashExperiment || Date.now()-Date.parse(s.acceptedAt)<3600000)){body=s.capture;status=config.crashExperiment?200:201;}
      else if(config.mode==='error'||s.capture){status=422;body={name:'UNPROCESSABLE_ENTITY',message:'The requested action could not be completed.',details:[{issue:s.capture?'AUTHORIZATION_ALREADY_CAPTURED':'AUTHORIZATION_EXPIRED',description:s.capture?'Authorization already captured.':'The authorization has expired.'}]};}
      else{
        s.acceptedAt=new Date().toISOString();s.acceptedOperations=(s.acceptedOperations??0)+1;
        s.capture={id:config.ids.capture,status:config.mode==='pending'?'PENDING':'COMPLETED',amount:money,final_capture:true,...(config.mode==='pending'?{status_details:{reason:'OTHER'}}:{})};
        // Supplementary IDs are available on capture detail. Keep the order and
        // POST shape identical to the earlier baseline.
        s.order.purchase_units[0].payments.captures=[s.capture];s.order.purchase_units[0].payments.authorizations[0].status='CAPTURED';body=s.capture;status=201;
        if(config.lostResponse){save(s);record('provider_response_discarded',{path:url.pathname,status,providerCommitted:true});throw new Error('SIMULATED_RESPONSE_LOSS');}
      }
    }else {status=404;body={name:'RESOURCE_NOT_FOUND',message:'Resource not found.'};}
    save(s);
    if(method==='GET'&&url.pathname.includes('/payments/captures/')&&status===200){body.supplementary_data={related_ids:{order_id:config.ids.order,authorization_id:config.ids.authorization}};if(s.lookupFault==='invalid-related-order')body.supplementary_data.related_ids.order_id='OTHERORDER00000001';}
    record('provider_response',{status,path:url.pathname,body});return respond(status,body);
  };
  return {transport,action,snapshot:read};
};
