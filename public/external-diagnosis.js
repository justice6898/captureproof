(() => {
  const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const detail=(label,value)=>{const d=node('details');d.append(node('summary',label),node('pre',JSON.stringify(value,null,2)));return d;};
  const downloadJSON=(label,value,filename)=>{const button=node('button',label);button.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};return button;};
  // A coverage receipt is not a semantic verdict or an executed test result.
  const guidance=(parent,r,cite)=>{
    const g=r.regressionGuidance;if(!g)return;
    parent.append(node('h4','Regression guidance'),node('p',`${g.status.replaceAll('_',' ')} · ${g.version}. ${g.note}`),node('p',`Validation uses ${r.validationVersion??r.schemaVersion}; semantic review: ${r.semanticReviewStatus}. Structure: ${r.validationChecks?.structure??'see original record'}; structured evidence/reference integrity: ${r.validationChecks?.evidenceIntegrity??'see original record'}. These checks do not prove every sentence.`));
    if(g.missing?.length)parent.append(node('p','Missing controls (recorded review): '+g.missing.join(', ')));
    if(g.present?.length)parent.append(node('p','Present controls: '+g.present.join(', ')));
    for(const c of r.renderedResult?.regressionControls??[]){
      const d=node('details'),summary=node('summary',`${c.kind.replaceAll('_',' ')} · ${c.status.replaceAll('_',' ')} — ${c.purpose}`);d.append(summary,node('p','Preconditions: '+c.preconditions));
      const actions=node('ol');for(const a of c.actions)actions.append(node('li',a));d.append(actions);
      for(const a of c.assertions)d.append(node('p',`${a.boundary}: ${a.observation}`));
      d.append(node('p','Applicability: '+c.reason));if(c.evidenceGap)d.append(node('p','Evidence gap: '+c.evidenceGap));
      if(cite)d.append(cite(c));d.append(node('p','Proposed only; no test or repair was executed.'));parent.append(d);
    }
  };
  const semanticReview=(parent,r,cite)=>{
    const review=r.semanticReview;if(!review)return;
    parent.append(node('h4','Development-session review — not model output'),node('p',review.summary));
    if(review.sanitizedExcerpt)parent.append(node('blockquote',review.sanitizedExcerpt));
    if(review.format==='diagnosis-claim-review-1'){
      parent.append(node('p',`Scope: ${review.scope?.kind?.replaceAll('_',' ')??'not established'} · ${review.reviewedClaimCount??0} of ${review.materialClaimCount??'unknown'} prose fields reviewed. Reuse: ${r.reusable?'allowed for this exact response':'not approved'}.`));
      if(review.unreviewedFields?.length)parent.append(node('p','Other claims remain unreviewed; this assessment does not cover them.'));
      for(const c of review.claims??[]){const d=node('details');d.append(node('summary',`${c.disposition} · ${c.field}`),node('blockquote',c.excerpt),node('p',`${c.classification}: ${c.reason}`));
        if(c.evidenceGap)d.append(node('p','Missing premise: '+c.evidenceGap));
        if(cite)d.append(cite(c));else d.append(node('p','Evidence: '+c.evidenceRefs.join(', ')));
        if(c.contextFields.length)d.append(node('p','Context checked: '+c.contextFields.join(', ')));
        parent.append(d);
      }
      parent.append(node('p',`${review.authorship??'Review metadata invalid'}. ${review.method??'No method established'}.`));
    }
    parent.append(detail('Review scope, bindings and detail',review));
  };
  const selections=[['prior','Initial diagnosis · pre-recovery revision'],['repaired','Observation review · recorded revision 2 reservation crash'],['accepted','Observation review · recorded revision 2 accepted interruption'],['completed','Observation review · recorded revision 2 completed'],['pending','Observation review · recorded revision 2 pending'],['invalid','Observation review · recorded revision 2 conflicting amount'],['v3-reservation','Separate revision 3 evidence · reservation interruption'],['v3-acceptance','Separate revision 3 evidence · accepted interruption']];
  // Same stored diagnosis representation, scoped to one verification execution.
  window.mountExactExecutionDiagnosis = (parent, data, { repairHref, instance } = {}) => {
    const section = node('section');
    section.className = 'summary-callout exact-analysis';
    section.id = (instance ? instance + '-' : 'exact-diagnosis-') + data.executionId;
    const prefix = (instance ? instance + '-' : '') + 'analysis-' + data.executionId + '-';
    const input = data.input;
    const matched = input?.execution?.runId === data.executionId;
    const link = (label, id, identity) => {
      const a = node('a', label); a.href = '#' + id;
      if (identity) a.title = identity;
      a.onclick = event => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) window.revealCaptureTarget?.(id);
      };
      return a;
    };
    const sourceLabel = source => {
      if (!source) return 'Unavailable source';
      const name = source.path.split('/').at(-1);
      const peers = input.sources.filter(s => s.path.split('/').at(-1) === name);
      if (peers.length === 1) return name;
      const parts = source.path.split('/');
      for (let count = 2; count <= parts.length; count++) {
        const suffix = parts.slice(-count).join('/');
        if (peers.filter(s => s.path.split('/').slice(-count).join('/') === suffix).length === 1) return suffix;
      }
      return source.path + ' (' + source.id + ')';
    };
    const evidenceLabel = id => id.startsWith('checkpoint-') ? 'Checkpoint ' + id.slice(11)
      : id.startsWith('event-') ? 'Event ' + id.slice(6) : id === 'restart' ? 'Before recovery' : id;
    const citations = item => {
      const links = node('div'); links.className = 'citation-links';
      for (const id of item.evidenceRefs ?? []) links.append(link(evidenceLabel(id), prefix + 'evidence-' + id, id));
      for (const c of item.codeRefs ?? []) {
        const source = input?.sources?.find(s => s.id === c.sourceRef);
        links.append(link(`${sourceLabel(source)}:${c.startLine}–${c.endLine}`, prefix + 'source-' + c.sourceRef + '-' + c.startLine, `${c.sourceRef} · ${source?.path ?? 'Unknown'} · ${c.sourceSha256 ?? ''}`));
      }
      return links;
    };
    // Prefer two contiguous sentences explicitly introduced as a causal path.
    // Otherwise retain the first sentence; never invent or splice an explanation.
    const excerpt = (text, causal = false) => {
      const sentences = text?.match(/[\s\S]+?(?:[.!?](?=\s|$)|$)/g) ?? [];
      const index = causal ? sentences.findIndex(sentence => /\bcausal path\b/i.test(sentence)) : -1;
      return (index < 0 ? sentences[0] : sentences.slice(index, index + 2).join(''))?.trim() ?? text ?? '';
    };
    if (!matched) section.append(node('p', 'Analysis unavailable: input does not match this execution. No other response was substituted.'));
    if (matched && !data.records.length) section.append(node('p', data.status === 'UNAVAILABLE' ? 'Stored analysis unavailable. No generation or substitution was attempted.' : 'No matching stored AI response. This read generates none.'));
    for (const r of matched ? data.records : []) {
      const record = node('article'); record.className = 'analysis-record';
      const accepted = r.currentValidation === 'ACCEPTED' && r.matchesCurrentInputs !== false && r.renderedResult;
      if (accepted) {
        record.append(node('p', 'Deterministic rules establish the mismatch; the stored explanation connects observations to source.'), node('p', r.mode === 'authored-offline' ? 'Authored fixture excerpt — not model output' : 'Exact excerpts from the selected stored response', ''));
        const finding = r.result?.findings?.[0];
        if (finding) record.append(node('blockquote', excerpt(finding.explanation, Boolean(finding.codeRefs?.length))), citations(finding));
        if (r.renderedResult.fixDirection) {
          record.append(node('h4', 'Proposed direction · not applied'), node('blockquote', excerpt(r.result.fixDirection.text)), citations(r.renderedResult.fixDirection));
        }
      } else {
        record.append(node('p', `No accepted explanation: ${r.matchesCurrentInputs === false ? 'Stored input binding conflicts with this execution' : r.error ?? r.currentValidation ?? 'Unavailable'}. No retry or substitute response.`));
        if (r.responseStatus === 'incomplete') record.append(node('p', `Incomplete output; reason: ${r.incompleteReason ?? 'not retained or unavailable'}.`));
      }
      const statuses = node('dl'); statuses.className = 'analysis-status';
      for (const [label, value] of [['Response completion', r.responseStatus ?? 'Unknown'], ['Structure / references', r.currentValidation ?? 'Unknown'], ['Development-session semantic review', r.semanticReviewStatus ?? 'NOT_REVIEWED']]) statuses.append(node('dt', label), node('dd', value));
      record.append(statuses, node('p', 'Acceptance is not proof of production safety. The developer repair was tested separately; AI proposals were not executed.'));
      const full = node('details'); full.className = 'complete-response'; full.append(node('summary', accepted ? 'Read the complete response' : 'Inspect stored response and retention'));
      if (!accepted && r.retainedResponse) full.append(node('p', 'Unvalidated content is not an accepted diagnosis. Private text may be omitted from this export; inspect the preservation receipt.')); 
      if (accepted) {
        const d = r.renderedResult;
        for (const f of d.findings) full.append(node('p', `${f.kind}: ${f.explanation}`), citations(f));
        for (const [label, value] of [['Proposed correction · not applied', d.fixDirection], ['Proposed regression test · not executed', d.regressionTest]]) if (value) full.append(node('h4', label), node('p', value.text), citations(value));
        for (const text of [...(d.monetaryMetadata ?? []), ...d.uncertainties]) full.append(node('p', text));
      }
      full.append(detail('Unchanged structured response', r.result));
      record.append(full);
      if (r.regressionGuidance) {
        const controls = node('details'); controls.className = 'proposed-controls';
        controls.append(node('summary', `Proposed controls (${r.renderedResult?.regressionControls?.length ?? 0}) · not executed`));
        guidance(controls, r, citations); record.append(controls);
      }
      const review = node('details'); review.append(node('summary', 'Review, preservation and usage'));
      semanticReview(review, r, citations);
      review.append(detail('Preservation receipt', r.retainedResponse), detail('Usage and cost estimates — confirmed billing unknown', { usage: r.usage, cost: r.cost, preflightCost: r.preflightCost, costUnresolved: r.costUnresolved }));
      if (r.offlineRevalidations?.length) review.append(detail('Historical annotations — original interpretations retained', r.offlineRevalidations));
      review.append(detail('Complete stored record and contract metadata', r));
      record.append(review); section.append(record);
    }
    const evidence = node('details'); evidence.append(node('summary', 'Observations and source supplied to the model'));
    for (const e of input?.evidence ?? []) { const d = detail(evidenceLabel(e.id), e.fields); d.id = prefix + 'evidence-' + e.id; evidence.append(d); }
    for (const source of input?.sources ?? []) {
      const d = node('details'); d.append(node('summary', sourceLabel(source)), node('p', `${source.id} · ${source.path} · SHA-256 ${source.sha256}`));
      const code = node('pre');
      for (const line of source.lines) { const span = node('span', `${line.line}: ${line.text}\n`); span.id = prefix + 'source-' + source.id + '-' + line.line; code.append(span); }
      d.append(code); evidence.append(d);
    }
    evidence.append(detail('Execution and contract identity', { executionId: data.executionId, contractVersion: data.contractVersion }));
    section.append(evidence);
    const actions = node('div'); actions.className = 'result-actions';
    if (data.repairComparison) { const a = node('a', 'View tested repair'); a.href = repairHref ?? `/external?job=${data.repairComparison.jobId}#execution-${data.repairComparison.runId}`; actions.append(a); }
    actions.append(downloadJSON('Download AI review', data, `captureproof-analysis-${data.executionId}.json`));
    section.append(actions); parent.append(section);
    if(window.captureFragment().startsWith(prefix))window.revealCaptureFragment();
  };
  window.mountExternalDiagnosis=(parent,key)=>{
    const exampleKey=new URL(location.href).searchParams.get('example');
    const section=node('section');section.id='external-diagnosis';section.className='summary-callout';
    section.append(node('h3','External code diagnosis'),node('p','Prepare a bounded request from this execution’s recorded evidence and source hashes. Live model dispatch is disabled. No AI diagnosis is invented for this report.'));
    const select=node('select');select.id='external-diagnosis-selection';for(const[k,label]of selections){const option=node('option',label);option.value=k;select.append(option);}select.value=key;
    const label=node('label','Evidence selection');label.htmlFor=select.id;
    const prepare=node('button','Prepare evidence (no model call)');prepare.id='external-diagnosis-prepare';
    const analyze=node('button','Analyze · live calls disabled');analyze.disabled=true;analyze.id='external-diagnosis-analyze';
    const status=node('p','Not prepared. Choosing or viewing a case makes no model request.');status.id='external-diagnosis-status';status.setAttribute('aria-live','polite');
    const content=node('div');let generation=0,state=null;
    select.onchange=()=>{generation++;state=null;content.replaceChildren();status.textContent='Not prepared for the new selection.';prepare.disabled=false;analyze.disabled=true;};
    const renderRecord=r=>{
      content.append(node('h3','Recorded AI response — unchanged'));
      content.append(node('p',`Saved response ${r.id} · Execution ${r.input?.execution?.runId??'unavailable'} · Evidence scope: ${r.input?.observationScope?.kind??'complete supplied execution'}.`));
      content.append(node('p',`${r.matchesCurrentInputs?'Current':'Stale — not reused'} · ${r.schemaVersion} · structural: ${r.currentValidation} · semantic review: ${r.semanticReviewStatus??'NOT_REVIEWED'}`));
      if(r.status==='failed')content.append(node('p',`Saved attempt rejected: ${r.error}. No automatic retry. Rejected content is retained privately.`));
      semanticReview(content,r);
      for(const review of r.offlineRevalidations??[]){
        if(review.kind==='ENGINEERING_RECOVERY_PLAN'){
          const plan=node('section');plan.id='external-recovery-plan';
          plan.append(node('h4','Separate engineering recovery verification plan'),node('p',review.attribution),
            node('p','Structural validation: passed. Response preservation: passed. Core cause: supported. Recovery guidance: conditions required. Approved reuse: no.'),
            node('p',review.summary),node('p',review.reviewClarification));
          for(const item of review.invariants){const d=node('details');d.append(node('summary',`${item.id} · ${item.status}`),node('p',item.assertion),node('p',`Contract: ${item.contractSource.join('; ')}`),node('p',`Evidence: ${item.evidence.join('; ')}`),node('p',`Limits: ${item.limits}`));plan.append(d);}
          plan.append(detail('Input-versus-output omission audit',review.audit),detail('Engineering plan, evidence and unsent preparations',review));
          const download=downloadJSON('Download engineering verification plan',review,'captureproof-engineering-recovery-plan.json');download.id='external-recovery-plan-download';plan.append(download);content.append(plan);continue;
        }
        content.append(node('h4',`Separate offline revalidation · ${review.contractVersion}`),node('p',review.summary),
          node('p',`Replay material: ${review.material}. Complete response validation: ${review.completeValidation}. Approved reuse: no. Original live rejection unchanged.`),
          detail('Offline component checks and preservation limits',review));
        if(review.monetaryMetadata?.length){content.append(node('h4','Offline grounded monetary facts — not a new model response'));
          for(const value of review.monetaryMetadata)content.append(node('p',value));}
      }
      guidance(content,r);
      if(r.renderedResult){const d=r.renderedResult;
        if(!r.matchesCurrentInputs)content.append(node('p','Validated against its own saved input, not the current selection. Inspect the saved input and review below; this does not grant reuse for the current selection.'));
        content.append(node('h4',d.assessment.replaceAll('_',' ')));
        if(d.monetaryMetadata?.length){content.append(node('h4','Grounded monetary claims — not payment completion proof'));
          for(const value of d.monetaryMetadata)content.append(node('p',value));}
        for(const c of d.stateClaims)content.append(node('p',`[${c.evidenceRef}] Capture POSTs: ${c.capturePostAttempts??'unknown'}; provider captures: ${c.distinctProviderCaptures??'unknown'}; DB rows: ${c.databaseCaptureRows??'unknown'}; captured_at: ${c.merchantCapturedAt??'null'}.`));
        for(const f of d.observedFacts)content.append(node('p',`[${f.evidenceRef}] ${f.field}: ${JSON.stringify(f.value)}`));
        const cite=item=>node('p',`Evidence: ${item.evidenceRefs.join(', ')} · Code: ${item.codeRefs.map(c=>`${c.sourceRef}:${c.startLine}–${c.endLine} @ ${c.sourceSha256.slice(0,12)}`).join(', ')}`);
        for(const f of d.findings)content.append(node('p',`${f.kind}: ${f.explanation}`),cite(f));
        for(const[label,p]of[['Proposed correction — not applied',d.fixDirection],[d.assessment==='insufficient_evidence'?'Next evidence collection — not executed':'Proposed regression test — not executed',d.regressionTest]])if(p)content.append(node('h4',label),node('p',p.text),cite(p));
        for(const u of d.uncertainties)content.append(node('p',u));
      }
      content.append(detail('Saved diagnosis and validation detail',r));
    };
    prepare.onclick=async()=>{
      const token=++generation;prepare.disabled=true;status.textContent='Preparing saved evidence and validating source bindings…';
      try{const response=await fetch(`/api/external-diagnoses/${encodeURIComponent(select.value)}`);const data=await response.json();if(token!==generation||!section.isConnected)return;
        if(!response.ok)throw Error(data.error??'EVIDENCE_UNAVAILABLE');state=data;content.replaceChildren();
        status.textContent=`Prepared · ${data.contractVersion}. Live dispatch disabled. ${data.records.length?'Saved records available below.':'No genuine model result is saved for this selection.'}`;
        content.append(node('p',`Report ${data.selection.reportId} · Evidence collection ${data.selection.campaignId} · Execution ${data.selection.runId} · ${data.selection.implementation}`),node('p',`Mode: ${data.selection.mode}. Model: ${data.config.model}, ${data.config.reasoning}, ${data.config.serviceTier}; output cap ${data.config.maxOutputTokens}; timeout ${data.config.timeoutMs/1000}s; automatic retries ${data.config.automaticRetries}.`));
        content.append(node('p',data.preflight.maximumUsd!==undefined?`Estimated request maximum: $${data.preflight.maximumUsd.toFixed(6)}. Not authorized, not confirmed billing.`:`Cost preflight blocked: ${data.preflight.reason}. No evidence was removed to force the budget.`));
        content.append(node('p','Reference, exact scalar, row/capture count and typed-money validation cannot prove every explanation correct. Proposed fixes are not applied.'));
        const sources=node('details');sources.append(node('summary',`Executed source excerpts (${data.input.sources.length})`));
        for(const s of data.input.sources)sources.append(node('h4',`${s.role} · ${s.path}`),node('p',`${s.sha256} · ${s.provenance}`),node('pre',s.lines.map(l=>`${l.line}: ${l.text}`).join('\n')));content.append(sources);
        content.append(detail('Ordered normalized evidence',data.input.evidence),detail('Request, digest and cost provenance',data));
        content.append(downloadJSON('Download prepared request JSON',{selection:data.selection,fingerprint:data.fingerprint,requestHash:data.requestHash,request:data.request,preflight:data.preflight},`captureproof-external-${select.value}-prepared.json`));
        const {RECORDED_EXAMPLES,matchingExample,independentCounters}=await import('/recorded-evidence.js');
        if(token!==generation||!section.isConnected)return;
        const example=RECORDED_EXAMPLES.find(e=>e.key===exampleKey);
        if(exampleKey&&!example)throw Error('UNKNOWN_RECORDED_EXAMPLE');
        const selected=example?data.records.filter(r=>matchingExample(r,exampleKey)):data.records;
        if(example){
          content.replaceChildren();
          if(selected.length!==1)throw Error('MATCHED_SAVED_RESULT_UNAVAILABLE');
          const r=selected[0];
          content.append(node('h3',example.label),node('p',example.description),node('p',`Recorded execution ${example.runId} · response ${r.id} · ${r.schemaVersion}`),node('p',`Executed candidate source SHA-256: ${r.input.target.executedSourceSha256}`));
          const evidence=node('section');evidence.id='independent-counters';
          evidence.append(node('h4','Independent recorded counters — not AI prose'),node('p','Simulated provider instrumentation and independent PostgreSQL snapshots. POSTs count dispatched requests; accepted operations count simulator acceptances, so repeated requests may reuse one operation and capture. Counts are cumulative within this execution at each named boundary. DB rows are rows present in that supplied SQL snapshot, not all rows ever created. Completion is shown separately.'),node('p','Unknown means uncollected or unavailable, never zero. These controller observations are not automatically merchant knowledge. No fulfillment was observed.'));
          for(const p of independentCounters(r.input)){
            const card=node('article');card.className='execution';card.append(node('h4',`${p.checkpoint} · ${p.phase}`));
            const counts=node('div');counts.className='counters';
            for(const [value,label]of [[p.posts,'Capture POST attempts'],[p.accepted,'Unique accepted provider operations'],[p.captures,'Unique provider captures'],[p.rows,'DB capture rows in snapshot']]){const cell=node('div');cell.append(node('strong',value??'Unknown'),node('span',label));counts.append(cell);}card.append(counts,node('p',`Merchant: ${p.completion} · captured_at: ${p.capturedAt===undefined?'Unknown':p.capturedAt??'unset'}`),node('p',`Operation: ${p.operations.join(', ')||'Unknown'} · provider order: ${p.providerOrder??'Unknown'} · capture: ${p.captureId??'not observed at this boundary'}`),node('p',`Evidence: ${p.checkpoint} · ${p.visibility}`));evidence.append(card);
          }
          if(exampleKey==='healthy')evidence.append(node('p','These deterministic counts cover the AI answer’s omission without editing it. Its semantic review remains PARTIAL and approved reuse remains blocked.'));
          content.append(evidence,detail('Exact analyzed evidence and source excerpts',r.input),downloadJSON('Download this recorded analysis and evidence',r,`captureproof-${exampleKey}-saved.json`));
        }
        for(const r of selected)renderRecord(r);
      }catch(error){if(token===generation)status.textContent=`Preparation unavailable: ${error.message}. No model request made.`;}
      finally{if(token===generation)prepare.disabled=false;}
    };
    // The server enforces the gate independently; no page-load or selection dispatch.
    analyze.onclick=async()=>{if(!state?.dispatchEnabled)return;const response=await fetch(`/api/external-diagnoses/${encodeURIComponent(select.value)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const r=await response.json();if(response.ok)renderRecord({...r,matchesCurrentInputs:true});else status.textContent=`Analysis unavailable: ${r.error}`;};
    section.append(label,select,prepare,analyze,status,content);parent.append(section);
    if(exampleKey){
      const selectedKey=exampleKey==='defect'?'prior':'v3-reservation';
      select.value=selectedKey;select.disabled=true;label.textContent='Exact saved example evidence';prepare.textContent='Reload recorded analysis (no model call)';prepare.click();
    }
  };
})();
