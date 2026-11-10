import { DiagnosisService } from './diagnosis-service.mjs';
import { OpenAIDiagnosis, diagnosisConfig } from './openai-diagnosis.mjs';
import { EXTERNAL_CONTRACT, EXTERNAL_VERSION } from './external-diagnosis-contract.mjs';
import { buildExternalDiagnosisInput, EXTERNAL_DIAGNOSIS_SELECTIONS } from './external-diagnosis-input.mjs';
import { costPreflight } from './diagnosis-cost.mjs';
import { hash, DiagnosisError } from './diagnosis-contract.mjs';
export const EXTERNAL_CONFIG=Object.freeze({...diagnosisConfig({}),maxAttempts:1});
const disabled=()=>{throw new DiagnosisError('EXTERNAL_LIVE_DISPATCH_DISABLED');};
// No environment credentials, enabling flag, or live authorization in this milestone.
export function disabledExternalProvider(){
  const provider=new OpenAIDiagnosis({config:EXTERNAL_CONFIG,contract:EXTERNAL_CONTRACT,beforeRequest:disabled});
  Object.defineProperty(provider,'unavailableReason',{value:'EXTERNAL_LIVE_DISPATCH_DISABLED'});
  return provider;
}
export class ExternalDiagnosisService {
  constructor({records,provider=disabledExternalProvider(),buildInput=buildExternalDiagnosisInput}={}){
    this.provider=provider;
    const originalPreflight=provider.beforeRequest;
    provider.beforeRequest=async body=>{costPreflight(JSON.parse(body));if(provider.mode!=='mock-transport')disabled();if(originalPreflight)await originalPreflight(body);};
    this.core=new DiagnosisService({records,provider,buildInput,contract:EXTERNAL_CONTRACT});
  }
  selection(key){const s=EXTERNAL_DIAGNOSIS_SELECTIONS.find(s=>s.key===key);if(!s)throw new DiagnosisError('EXTERNAL_SELECTION_UNAVAILABLE');return s;}
  prepare(key){
    const selection=this.selection(key),id=`external:${key}`;
    const {bundle,fingerprint}=this.core.prepare(id),request=this.provider.requestBody(bundle.input);
    let preflight;try{preflight={status:'CALCULATED_NOT_AUTHORIZED',...costPreflight(request),pricingRechecked:'2026-10-22',pricingUncertainty:'Official pricing and prompt-caching docs rechecked: default 30m writes at 1.25x input, no 12h override in this request. Full input charged at write rate plus 10% regional reserve; no cache-read savings. Recheck before transmission; estimate, not billing.'};}catch(e){preflight={status:'BLOCKED',reason:e.code??'COST_BOUND_UNAVAILABLE'};}
    return {selection,availability:'PREPARED',dispatchEnabled:false,contractVersion:EXTERNAL_VERSION,fingerprint,evidenceDigest:hash(bundle.input),requestHash:hash(JSON.stringify(request)),config:this.provider.config,preflight,
      provenance:bundle.provenance,input:bundle.input,request};
  }
  view(key){const prepared=this.prepare(key);const view=this.core.view(`external:${key}`);
    // Isolated test transports must never be displayed as genuine saved generations.
    return {...prepared,running:view.running,records:view.records.filter(r=>r.mode==='openai-live').map(r=>({...r,reusable:r.reusable&&r.matchesCurrentInputs})),unavailableReason:'EXTERNAL_LIVE_DISPATCH_DISABLED'};
  }
  analyze(key){
    this.selection(key);
    if(this.provider.mode!=='mock-transport'){
      const saved=this.view(key).records.find(r=>r.matchesCurrentInputs&&r.reusable);
      if(saved)return Promise.resolve({...saved,saved:true});
      return Promise.reject(new DiagnosisError('EXTERNAL_LIVE_DISPATCH_DISABLED'));
    }
    const prepared=this.prepare(key);
    if(prepared.preflight.status==='BLOCKED')return Promise.reject(new DiagnosisError(prepared.preflight.reason));
    return this.core.analyze(`external:${key}`);
  }
}
