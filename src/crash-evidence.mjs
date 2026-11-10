// Presentation/evaluation of saved crash observations; no execution dependencies.
export function crashProgress(trace) {
  const last=trace.checkpoints.at(-1), rows=last?.afterShutdown?.rows;
  if (!trace.crash || !last || !rows) return {status:'NOT_APPLICABLE',reason:'No crash boundary in this execution.'};
  if(last.verdict.status==='PASS' && last.providerFinal.capture?.status==='COMPLETED' && rows.capture.filter(c=>!c.deleted_at).length===1 && rows.payment[0].captured_at && rows.payment_collection[0].status==='completed')
    return {status:'RECOVERED',reason:'Bound completed provider evidence and one committed merchant capture converge at the observed recovery boundary.'};
  const noProgress=trace.checkpoints.length>=2 && trace.checkpoints.every(c=>c.returned.kind==='rejected' && c.providerCounters.capturePostAttempts===trace.crash.afterTermination.provider.capturePostAttempts && !c.afterShutdown.rows.payment[0].captured_at);
  return noProgress ? {status:'STALLED',reason:'Repeated explicit recovery calls rejected without transmission or completed merchant state. This is an observed liveness failure; the existing financial oracle does not grade eventual progress.'} : {status:'UNRESOLVED',reason:'The observed recovery sequence does not establish completed convergence.'};
}
