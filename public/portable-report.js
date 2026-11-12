(() => {
 const data = JSON.parse(document.getElementById('report-data').textContent);
 const p = data.primary, main = document.getElementById('main');
 const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
 const add = (n, ...children) => { n.append(...children); return n; };
 const disclosure = label => add(el('details'), el('summary', label));
 const raw = (label, value) => add(disclosure(label), el('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
 const anchor = (label, id) => {
  const a = el('a', label); a.href = '#' + id;
  a.onclick = e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) window.revealCaptureTarget(id); };
  return a;
 };
 const section = (id, title) => { const s = el('section'); s.id = id; if (title) s.append(el('h2', title)); main.append(s); return s; };
 const download = (label, content, name) => {
  const button = el('button', label); button.type = 'button'; button.setAttribute('aria-label', `Download ${name}`);
  button.onclick = () => { const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })), a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return button;
 };
 const fileButton = (path, label = 'Download') => {
  const f = data.exportFiles.find(file => file.path === path);
  if (!f) return el('span', 'Artifact unavailable');
  const button = download(label, f.content, path.split('/').at(-1));
  const source = path.startsWith('sources/') ? p.sources[Number(path.split('/')[1].split('.')[0])] : null;
  button.setAttribute('aria-label', 'Download ' + (source?.path ?? path));
  return button;
 };
 const card = (title, cp) => {
  const article = window.renderCaptureCheckpoint(title, checkpointPresentation(cp));
  if (cp?.assessment?.changed) article.append(el('p', assessmentDescription(cp.assessment)), raw('Separate current assessment; recorded verdict unchanged', cp.assessment));
  return article;
 };
 const first = p.execution.checkpoints[0], fixed = p.repairExecution?.checkpoints[0];
 document.body.classList.add('portable-report');
 main.append(el('p', 'CAPTUREPROOF / SAVED REPORT', 'eyebrow'));
 const nav = el('nav', undefined, 'report-nav result-nav'); nav.setAttribute('aria-label', 'Report sections');
 for (const [id, label] of [['finding','Overview'],['timeline','Evidence'],['ai','AI review'],['repair','Repair'],['files','Files']]) nav.append(anchor(label, id));
 main.append(nav);
 const overview = section('finding');
 overview.append(el('h1', resultHeadline(first, p.findingSummary?.finding ?? 'Recorded payment evidence')),
  el('p', 'For developers debugging supported checkout integrations: connect provider observations, merchant records and source-bound explanations to a reproducible failure.', 'intro'),
  el('p', data.scope + ' The repair is developer-authored.', 'scope-line'));
 const comparison = el('div', undefined, 'comparison');
 comparison.append(card('Original · first returned call', first));
 if (p.repairExecution) comparison.append(card('Developer repair · same boundary', fixed));
 overview.append(window.renderCaptureComparison(checkpointPresentation(first), checkpointPresentation(fixed)), comparison, el('p', 'Authorized is a local merchant state, not proof of PayPal authorization or money movement. Capture rows count database records, not deliveries.', 'scope-line'));
 const actions = el('div', undefined, 'result-actions');
 const inspect = anchor('Inspect evidence', 'timeline'); inspect.className = 'primary-action';
 actions.append(inspect, anchor('Read AI review', 'ai'), anchor('Use the application', 'application-setup'), anchor('Export files', 'files')); overview.append(actions);
 const certainty = raw('Recorded history, comparison and identities', { originalFinding: p.repair.finding, summary: p.findingSummary, aggregate: p.execution.verdict, finalRepair: p.repairExecution?.checkpoints.at(-1)?.verdict, jobId: p.jobId, executionId: p.execution.runId, repairRun: p.repairExecution?.runId }); overview.append(certainty);
 if (p.findingSummary) overview.append(el('p', p.findingSummary.comparison.summary + ' This observed pair only.', 'scope-line'));
 if (p.missingObservations?.length) overview.append(el('p', p.missingObservations.join(' '), 'scope-line'));

 const evidence = section('timeline', 'Recorded phases, distinct observations');
 evidence.append(el('p', 'Later completion does not erase the initial violation. Repeated POST attempts are not evidence of duplicate charges.', 'scope-line'));
 const filter = el('select'); filter.setAttribute('aria-label', 'Checkpoint implementation');
 for (const [value, label] of [['all','Original and candidate'],['upstream','Original only'],['repair','Candidate only']]) { const option = el('option', label); option.value = value; filter.append(option); }
 evidence.append(add(el('label', 'Show '), filter));
 const runs = [['upstream','Original',p.execution],['repair','Repair / candidate',p.repairExecution]].filter(([, , run]) => run);
 const count = Math.max(...runs.map(([, , run]) => run.checkpoints.length));
 for (let i = 0; i < count; i++) {
  const entries = runs.map(([kind, label, run]) => {
   const cp = run.checkpoints[i], detail = card(label, cp); detail.id = `checkpoint-${run.runId}-${i + 1}`; detail.dataset.implementation = kind;
   detail.append(raw('Independent snapshots and recorded rules', cp ?? { observation: 'Unavailable' }));
   return { label, view: checkpointPresentation(cp), card: detail };
  });
  const title = `Checkpoint ${i + 1} · ${checkpointPhase(p.execution.checkpoints, i)}`;
  evidence.append(window.renderCapturePhase(title, entries));
 }
 const filterCards = () => { for (const c of evidence.querySelectorAll('[data-implementation]')) c.hidden = filter.value !== 'all' && c.dataset.implementation !== filter.value; };
 filter.onchange = filterCards;
 window.addEventListener('captureproof:reveal', e => { if (e.detail.id.startsWith('checkpoint-')) { filter.value = 'all'; filterCards(); } });
 for (const [, label, run] of runs) evidence.append(raw(`${label}: ordered events`, run.events));

 const ai = section('ai', 'AI review');
 if (p.analysis.input) window.mountExactExecutionDiagnosis(ai, p.analysis, { repairHref: '#repair' });
 else ai.append(el('p', p.analysis.reason ?? 'Matching input unavailable. No explanation was generated.'));
 const repair = section('repair', 'The separately tested repair');
 repair.append(el('p', 'This implementation predates the selected AI response. Its saved campaign observations are separate from the saved replay results below.'));
 if (p.repair.availability === 'AVAILABLE') {
  repair.append(el('p', p.findingSummary?.comparison.summary ?? 'Inspect the recorded pair; no general safety conclusion.'));
  for (const component of p.repair.components) {
   const d = disclosure(component.title); d.append(el('p', component.change), el('p', component.relationship), el('p', component.verified));
   for (const [label, source] of [['Executed original',component.before],['Executed developer repair',component.after]]) if (source) {
    const index = p.sources.findIndex(s => s.path === source.path);
    d.append(el('h3', label), anchor(`${source.path.split('/').at(-1)}:${source.startLine}`, `source-${index}-${source.startLine}`), el('pre', source.lines.map(l => `${l.number}: ${l.text}`).join('\n')));
   }
   for (const ref of component.evidenceRefs ?? []) d.append(anchor(`${ref.runId === p.execution.runId ? 'Original' : 'Repair'} checkpoint ${ref.checkpoint}`, `checkpoint-${ref.runId}-${ref.checkpoint}`));
   repair.append(d);
  }
  repair.append(raw('Integration requirements and limits', [...p.repair.integrationRequirements, ...p.repair.limits]));
 } else repair.append(el('p', p.repair.reason));

 const files = section('files', 'Files and reproducibility');
 const application = disclosure('Use the executable application · preview your change'); application.id='application-setup';
 application.append(el('p', 'This HTML is saved evidence, not an execution environment. In the supported CaptureProof workspace on macOS Apple Silicon with Node 24+, run:'), el('pre', 'npm run start:verification -- 3200'), el('p', 'Open http://127.0.0.1:3200/external in your browser. Choose Verify my change, select a supported candidate, then Review execution plan · no execution. See README for candidate import and dependency setup.'), el('p', 'A plan preview creates no result. Returning to the bundled example shows its earlier frozen execution, not evidence from your selected candidate. Running a campaign is a separate explicit action.'));
 files.append(application);
 files.append(el('p', 'Downloads preserve the selected artifact bytes. Reading or downloading starts no execution.'));
 const fileRow = (title, path) => add(el('div', undefined, 'file-row'), el('span', title), fileButton(path, 'Download'));
 files.append(el('h3','Evidence'), fileRow('Selected observations and provenance', 'evidence.json'));
 files.append(el('h3','AI review'), add(el('div', undefined, 'result-actions'), anchor('Inspect the response and review', 'ai'), download('Download AI review', JSON.stringify(p.analysis, null, 2), `captureproof-analysis-${p.execution.runId}.json`)));
 files.append(el('h3','Replay inputs and results'));
 for (const path of [data.reproduction.artifactName, 'upstream-repair-comparison.json', 'replay-verification.json', 'reduced-failure.json']) if (path && data.exportFiles.some(f => f.path === path)) files.append(fileRow(path, path));
 const reproduction = disclosure('Reproduction setup and separately saved replay observations'); reproduction.id = 'reproduce';
 reproduction.append(el('p', data.reproduction.requirements), el('pre', data.reproduction.setup.join('\n')), el('p', data.reproduction.primaryStatus), el('pre', data.reproduction.primaryCommand));
 if (data.replayVerification) {
  const replay = data.replayVerification;
  reproduction.append(el('p', 'These are separate replay executions, not additional checkpoints of the original campaign.'), raw('Exact artifact, source and replay bindings', replay));
  const replayPanels = el('div', undefined, 'replay-panels');
  for (const [label, receipt] of [['Original replay', replay.upstream], ['Developer repair replay', replay.repair]]) if (receipt) {
   const d = disclosure(`${label}: ${receipt.status}`); const cards = el('div', undefined, 'replay-checkpoints');
   for (const cp of receipt.execution.checkpoints) cards.append(card(`Replay checkpoint ${cp.index}`, cp));
   d.append(cards); replayPanels.append(d);
  }
  reproduction.append(replayPanels, el('p', 'NOT_REPRODUCED means the original rule violation was absent in that replay, not general repair safety.'));
  if (replay.repair) reproduction.append(el('pre', 'npm run verify -- replay upstream-repair-comparison.json'));
 }
 if (data.secondary) reproduction.append(raw('Separate injected regression and reduction', data.secondary), el('p', data.reproduction.reducedStatus), el('pre', data.reproduction.reducedCommand));
 files.append(reproduction);
 const sources = disclosure(`Source files (${p.sources.length}) · inspect or download`); sources.id = 'sources';
 sources.append(el('p', 'Exact frozen source; code is inert. SHA-256 identifies the full file, not a reformatted excerpt.'));
 for (const [index, source] of p.sources.entries()) {
  const d = disclosure(`${source.path.split('/').at(-1)} · ${source.path.startsWith('supplied/') ? 'developer candidate' : source.path.includes('node_modules/') ? 'dependency' : 'executed source'}`); d.id = 'source-file-' + index;
  d.append(el('p', source.path, 'mono'), el('p', 'SHA-256 ' + source.sha256, 'mono'), fileButton(`sources/${index}.txt`, 'Download source'));
  const code = el('pre'); source.text.split('\n').forEach((text, i) => { const line = el('span', `${i + 1}: ${text}\n`); line.id = `source-${index}-${i + 1}`; code.append(line); }); d.append(code); sources.append(d);
 }
 files.append(sources);
 const notices = disclosure('Licenses and notices');
 for (const file of data.exportFiles.filter(f => f.path.startsWith('licenses/'))) notices.append(raw(file.path.split('/').at(-1), file.content));
 files.append(notices);
 const scope = disclosure('Limitations, provenance and checksums'); scope.id = 'scope';
 for (const text of p.limits) scope.append(el('p', text));
 scope.append(el('p', 'No live PayPal, concurrency, fulfillment or production guarantee. Agent review is not independent-human validation.'), raw('Selected export checksums', data.manifest)); files.append(scope);
 window.trackCaptureSections(nav);
 window.revealCaptureFragment();
 main.dataset.ready = 'true';
})();
