// Developer-authored control plans for offline contract tests; never generated evidence.
export function authoredRegressionControls(input,assessment='issue_observed') {
 const evidence=input.evidence.find(e=>e.fields.phase==='returned_call')??input.evidence[0];
 const plans={
  normal_completion:['Permit a legitimate completed capture','Begin with a fresh logical payment and matching provider identity, amount and currency.','Return a COMPLETED capture and allow the merchant call to return.',[
   ['bound_completed_can_complete','returned_call','Independent merchant snapshot records completion only for the matching completed capture.'],
   ['one_capture_and_row','returned_call','Inspect distinct provider capture IDs and active committed capture rows; each count is one.']]],
  pending:['Prevent premature completion','Order read-back contains a PENDING capture even if the order status is COMPLETED.','Return the pending read-back, then inspect the completed application call.',[
   ['pending_must_not_complete','returned_call','The persisted merchant payment must not be complete; a provisional row alone is not payment completion.']]],
  unavailable_readback:['Preserve uncertainty','Withhold provider read-back or return an ambiguous response.','Attempt reconciliation without supplying authoritative completion evidence.',[
   ['unknown_stays_unresolved','returned_call','No completed payment or terminal payment failure is inferred from missing read-back.'],
   ['absence_does_not_authorize_retry','returned_call','Observe outgoing capture requests; missing evidence alone must not trigger a new POST.']]],
  conflicting_evidence:['Keep a confirmed violation visible','Supply a read-back with a confirmed order, capture, amount, currency or status mismatch.','Leave recovery unfinished and inspect the mismatch independently of completion.',[
   ['confirmed_violation_remains_visible','unfinished_window','The known binding violation remains reported while recovery progress stays unresolved.'],
   ['conflict_must_not_complete','returned_call','The merchant must not record completed payment using conflicting evidence.']]],
  repetition_restart:['Reconcile across persisted restart','Save the logical operation identity before interrupting; retain its existing records.','Restart, read back the same payment and repeat the returned operation after settlement.',[
   ['preserve_operation_identity','recovery_completed','Persisted business, provider and operation identity remain associated across restart.'],
   ['one_capture_and_row','recovery_completed','Read distinct provider IDs and active committed rows; neither is duplicated.'],
   ['posts_are_not_charges','returned_call','Record POST attempts independently; compare distinct capture IDs rather than deriving charges from requests.']]],
  next_evidence:['Collect the missing boundary','Only the supplied incomplete observations are available.','Collect a returned merchant operation and independent bound provider/merchant snapshots.',[
   ['collect_missing_observations','returned_call','The missing returned-call state and application-visible read-back are recorded with identity.'],
   ['unknown_stays_unresolved','unfinished_window','Before those observations arrive no payment outcome is invented.']]]
 };
 const kinds=assessment==='no_issue_observed'?[]:assessment==='insufficient_evidence'?['next_evidence']:['normal_completion','pending','unavailable_readback','conflicting_evidence','repetition_restart'];
 return kinds.map(kind=>{const[purpose,preconditions,action,assertions]=plans[kind];return {kind,status:'proposed',executionId:input.execution.runId,purpose,preconditions,actions:[action],assertions:assertions.map(([rule,boundary,observation])=>({rule,boundary,observation})),evidenceRefs:[evidence.id],codeRefs:[],evidenceGap:'This control has not been executed by this authored fixture; supplied observations establish scope, not this future outcome.',reason:'Exercise the selected capture evidence and merchant persistence contract.',testsExecuted:false,productionSafetyVerified:false};});
}
