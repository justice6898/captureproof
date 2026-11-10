(() => {
  const el = id => document.getElementById(id);
  let selected = null, generation = 0;
  const pending = new Set();
  async function api(id, post = false) {
    const response = await fetch(`/api/runs/${id}/diagnoses`, post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'AI_UNAVAILABLE');
    return data;
  }
  function paragraph(parent, text) { const p = document.createElement('p'); p.textContent = text; parent.append(p); }
  function references(item) {
    return `Evidence: ${item.evidenceRefs.join(', ')}. Code: ${item.codeRefs.map(r => `${r.sourceRef}:${r.startLine}–${r.endLine}`).join(', ') || 'None'}.`;
  }
  function render(record, saved) {
    const container = el('diagnosis-result'); container.replaceChildren();
    el('diagnosis-json').textContent = record ? JSON.stringify(record, null, 2) : '';
    if (!record) return;
    if (record.status !== 'succeeded') {
      el('diagnosis-status').textContent = `Analysis failed: ${record.error ?? record.status}. The experiment and its verdict are unchanged.`;
      return;
    }
    if (!record.reusable || !record.renderedResult) {
      el('diagnosis-status').textContent = `Historical or unvalidated analysis · ${record.schemaVersion ?? 'unknown contract'} · ${record.currentValidation ?? 'NOT_VALIDATED'}. Original response remains in JSON detail; it is not a current validated result.`;
      if (record.semanticReview) paragraph(container, `Semantic review: ${record.semanticReview.outcome}. ${record.semanticReview.reason}`);
      return;
    }
    const r = record.renderedResult;
    el('diagnosis-status').textContent = `${saved ? 'Saved analysis' : 'Analysis complete'} · ${record.mode} · ${record.returnedModel ?? record.requestedModel} · ${record.schemaVersion}. Reference, scalar-fact and typed-money checks passed; semantic correctness is not guaranteed.`;
    paragraph(container, `Assessment: ${r.assessment.replaceAll('_', ' ')}`);
    paragraph(container, 'Observed facts');
    for (const f of r.observedFacts) paragraph(container, `${f.field} = ${JSON.stringify(f.value)} [${f.evidenceRef}]`);
    for (const f of r.findings) { paragraph(container, `${f.kind}: ${f.explanation}`); paragraph(container, references(f)); }
    for (const [label, p] of [['Suggested fix (not applied)', r.fixDirection], ['Regression test proposal (not executed)', r.regressionTest]]) {
      if (p) { paragraph(container, `${label}: ${p.text}`); paragraph(container, references(p)); }
    }
    paragraph(container, 'Uncertainties and missing evidence');
    for (const u of r.uncertainties) paragraph(container, u);
    for (const s of record.sourceProvenance) paragraph(container, `${s.sourceRef} → ${s.path}: ${s.history}`);
  }
  async function load(id, token) {
    try {
      const state = await api(id);
      if (token !== generation) return;
      const current = state.records.find(r => r.matchesCurrentInputs && r.reusable);
      const latest = state.records.find(r => r.matchesCurrentInputs);
      render(current ?? latest, !!current);
      if (!current && !latest) el('diagnosis-status').textContent = state.configured ? `Ready · ${state.model}, ${state.reasoning} reasoning. No model request has been made.` : `AI unavailable: ${state.unavailableReason ?? 'AI_NOT_CONFIGURED'}. Configure the server’s local .env and restart. Payment results remain available.`;
      if (state.records.some(r => !r.matchesCurrentInputs)) {
        if (!current) paragraph(el('diagnosis-result'), 'Older analyses exist, but evidence, source or configuration changed. They are not reused.');
        el('diagnosis-json').textContent = JSON.stringify({ currentFingerprint: state.fingerprint, records: state.records }, null, 2);
      }
      for (const r of state.records.filter(r => r.semanticReview?.reuseAllowed === false)) {
        paragraph(el('diagnosis-result'), `Historical analysis ${r.id} (${r.schemaVersion}): ${r.semanticReview.outcome}. ${r.semanticReview.reason} Original structural status preserved; not reused.`);
      }
      el('analyze-ai').disabled = pending.has(id) || state.running || (!state.configured && !current);
    } catch (error) {
      if (token === generation) { el('diagnosis-status').textContent = `AI unavailable: ${error.message}. Payment results remain available.`; el('analyze-ai').disabled = true; }
    }
  }
  window.addEventListener('captureproof-run', event => {
    selected = event.detail; const token = ++generation;
    el('diagnosis-panel').hidden = !selected; el('analyze-ai').disabled = true;
    el('diagnosis-result').replaceChildren(); el('diagnosis-json').textContent = '';
    if (selected) { el('diagnosis-status').textContent = 'Loading saved analysis…'; void load(selected, token); }
  });
  el('analyze-ai').onclick = async () => {
    const id = selected, token = generation;
    if (!id || pending.has(id)) return;
    pending.add(id); el('analyze-ai').disabled = true;
    el('diagnosis-status').textContent = 'Analyzing saved evidence and source excerpts…';
    try { const record = await api(id, true); if (token === generation) render(record, record.saved); }
    catch (error) { if (token === generation) el('diagnosis-status').textContent = `Analysis unavailable: ${error.message}. The experiment is unchanged.`; }
    finally { pending.delete(id); if (token === generation) el('analyze-ai').disabled = false; }
  };
})();
