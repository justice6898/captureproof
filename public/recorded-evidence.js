// Presentation only: observations are independent of generated findings and semantic scores.
export const RECORDED_EXAMPLES = Object.freeze([
  {key:'defect',selection:'prior',id:'0eb907bf-df47-4bd4-9314-8f44e4f6ad76',runId:'071f6e4b-6675-41eb-8c1c-e606886f1606',fingerprint:'ed28f100f18d89932e192d4cd0667fcd52e722c97ab5792a3db7561a69e6b6bf',label:'Recovery blocked · earlier CaptureProof candidate',description:'A provisional capture row blocks provider dispatch after restart. This is not the upstream PENDING-completion defect.'},
  {key:'healthy',selection:'v3-reservation',id:'fc43d802-b4b8-4a19-9704-b8aee6d2f691',runId:'a05a368f-8b0e-49e3-8e83-a63b01ae7b33',fingerprint:'bce3ed4315fdbe8f02b669cd21f83d32b5f38aa5e70eb08293727f3d09442de7',label:'Recovery succeeds · CaptureProof revision 3',description:'Separate execution of the same reservation-interruption scenario. Observed recovery succeeds; AI review remains PARTIAL because its counter explanation is incomplete.'},
  {key:'insufficient',selection:'v3-reservation',id:'98fd21ae-2bb3-4ad7-b5ed-3c1f17b2aabd',runId:'a05a368f-8b0e-49e3-8e83-a63b01ae7b33',fingerprint:'7d61596bb03792f67875e62b5628d6d158b729902686952001e1e1dedd5deeea',label:'Outcome unknown · limited restart evidence',description:'Only the crash/restart prefix of revision 3 was supplied to this analysis. Later recovery observations must not be borrowed.'}
]);
export function matchingExample(record, key) {
  const example=RECORDED_EXAMPLES.find(e=>e.key===key);
  if(!example||record?.id!==example.id||record.fingerprint!==example.fingerprint||record.input?.execution?.runId!==example.runId)return null;
  const prefix=record.input.observationScope?.kind==='DERIVED_RESTART_PREFIX';
  return prefix===(key==='insufficient')?example:null;
}
const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
export function independentCounters(input) {
  return (input?.evidence??[]).filter(e=>Object.hasOwn(e.fields,'counterObservation')).map(({id,fields:f})=>{
    const prefix=id==='crash'?'provider.':'';
    const recorded=f.counterObservation==='recorded';
    const rows=Object.keys(f).filter(k=>/^database\.captureRows\.\d+\.id$/.test(k)).map(k=>f[k]);
    const rowCount=count(f['database.captureRowCount']);
    const rowEvidence=f['database.available']===true&&rowCount===rows.length&&new Set(rows).size===rows.length;
    return {checkpoint:id,phase:f.phase,visibility:f.visibility,at:f.at??null,
      posts:recorded?count(f[prefix+'capturePostAttempts']):null,
      accepted:recorded?count(f[prefix+'acceptedOperations']):null,
      captures:recorded?count(f[prefix+'distinctCaptureCount']):null,
      rows:rowEvidence?rowCount:null,rowIds:rowEvidence?rows:[],
      completion:rowEvidence?f['database.collection.status']??'Unknown':'Unknown',capturedAt:rowEvidence?f['database.payment.capturedAt']:undefined,
      operations:Object.keys(f).filter(k=>/^database\.operations\.\d+\.id$/.test(k)).map(k=>f[k]),
      providerOrder:f['provider.orderId']??f['database.operations.0.binding.orderId']??null,captureId:f['provider.capture.id']??null};
  });
}
