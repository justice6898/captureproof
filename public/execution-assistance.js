// Exact-run preview and durable attempt viewing share the normal diagnosis renderer.
export function mountExecutionAssistance(container, { jobId, executionId, request }) {
  const section = document.createElement('section');
  const previewButton = document.createElement('button');
  previewButton.type = 'button';
  previewButton.textContent = 'Review AI input & cost for this execution';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  section.append(previewButton, status);
  container.append(section);
  let content;
  const renderResult = (preview, result) => {
    const outcome = result.status === 'running' ? 'Attempt pending; outcome and cost are not yet known'
      : result.error ? 'Request stopped: ' + result.error : 'Request finished';
    status.textContent = `${outcome}. Validation: ${result.currentValidation}. Semantic review: ${result.semanticReviewStatus ?? 'NOT_REVIEWED'}. Repair testing is separate. ${result.saved ? 'Existing attempt retained; no new request.' : 'One attempt recorded.'}${result.costUnresolved ? ' Provider outcome or usage remains unknown; cost is unresolved. No retry.' : result.providerOutcome === 'NOT_SENT' ? ' Dispatch was blocked before transmission; no provider request was sent.' : ' Calculated cost is not confirmed billing.'}`;
    window.mountExactExecutionDiagnosis?.(content,
      { ...preview, records: [result], repairComparison: null }, { instance: 'request-' + result.id });
    const receipt = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Request receipt and usage details';
    const data = document.createElement('pre');
    data.textContent = JSON.stringify(result, null, 2);
    receipt.append(summary, data); content.append(receipt);
  };
  previewButton.onclick = async () => {
    previewButton.disabled = true;
    content?.remove();
    try {
      const path = `/api/verifications/${jobId}/assistance/${executionId}`;
      const preview = await request(path);
      if (preview.jobId !== jobId || preview.executionId !== executionId) throw Error('Selected execution changed.');
      content = document.createElement('div');
      const heading = document.createElement('h4');
      heading.textContent = 'Review before requesting an explanation'; heading.tabIndex = -1;
      const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
      summary.textContent = 'Exact input, source citations, request identity and cost assumptions';
      pre.textContent = JSON.stringify(preview, null, 2); details.append(summary, pre);
      const run = document.createElement('button'); run.type = 'button';
      run.textContent = preview.records?.length ? 'Attempt already recorded · no retry' : preview.dispatchEnabled
        ? (preview.transport === 'INJECTED_TEST_TRANSPORT' ? 'Request explanation once · test transport' : 'Confirm one paid explanation')
        : 'Live diagnosis requires separate authorization';
      run.disabled = !preview.dispatchEnabled;
      status.textContent = `Estimated upper cost: ${preview.cost.maximumUsd === undefined ? 'unavailable' : '$' + preview.cost.maximumUsd.toFixed(6)}. ${preview.config.model} / ${preview.config.reasoning} / standard. This preview sends no request and reserves no budget. ${preview.limits}${preview.unavailableReason ? ' Unavailable: ' + preview.unavailableReason + '.' : ''}`;
      content.append(heading, details, run); section.append(content); heading.focus();
      for (const result of preview.records ?? []) renderResult(preview, result);
      run.onclick = async () => {
        run.disabled = true; previewButton.disabled = true;
        status.textContent = 'Request pending. Do not retry. Refreshing can inspect the persisted attempt; closing this page does not establish cancellation.';
        try {
          const result = await request(path, { confirm: true, requestIdentity: preview.requestIdentity });
          renderResult(preview, result);
        } catch (error) {
          status.textContent = `${error.message}. No automatic retry. Review the saved attempt before any further action; a disconnect does not establish that transmission failed.`;
        } finally { previewButton.disabled = false; }
      };
    } catch (error) { status.textContent = `Input preparation unavailable: ${error.message}. No request sent.`; }
    finally { previewButton.disabled = false; }
  };
}
