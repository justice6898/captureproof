const $ = id => document.getElementById(id);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (className) node.className = className; return node; };
const add = (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; };
const badge = status => el('span', status ?? 'UNAVAILABLE', `badge ${(status ?? '').toLowerCase()}`);
const small = text => el('p', text, 'small');
const variants = ['original', 'candidate'];
const title = s => s === 'original' ? 'Original plugin' : 'Repair candidate';
let report, selected;
function caseLink(name, label = name, checkpoint) {
  const b = el('button', label, 'case-link'); b.type = 'button';
  b.addEventListener('click', () => { $('filter').value = 'all'; selectCase(name); renderList();
    const target = checkpoint ? document.getElementById(`checkpoint-${checkpoint}`) : $('investigation'); target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('investigation').focus({ preventScroll: true }); }); return b;
}
function refs(parent, values) {
  const links = el('div', null, 'ref-links');
  for (const ref of values) { const a = el('a', ref); a.href = `#event-${ref}`; a.addEventListener('click', () => {
    const node = document.getElementById(`event-${ref}`); if (!node) return;
    node.closest('details').open = true; setTimeout(() => node.scrollIntoView({ block: 'center' }), 0);
  }); links.append(a); } parent.append(links);
}
function facts(items) {
  const dl = el('dl', null, 'facts'); for (const [name,value] of items) add(dl, el('dt', name), el('dd', value ?? 'Not observed')); return dl;
}
function renderList() {
  const f = $('filter').value;
  const cases = report.cases.filter(c => f === 'all' || (f === 'failure' && c.original.recordedVerdict === 'FAIL') || (f === 'unknown' && c.candidate.recordedVerdict === 'INCONCLUSIVE') || (f === 'unmatched' && !c.paired));
  $('case-count').textContent = `${cases.length} / ${report.scenarioCount}`;
  $('case-list').replaceChildren(...cases.map(c => {
    const b = el('button', null, 'case-button'); b.type = 'button'; b.setAttribute('aria-current', String(c.scenario === selected));
    const label = v => c[v].availability === 'AVAILABLE' ? c[v].recordedVerdict : 'UNAVAILABLE';
    b.setAttribute('aria-label', `${c.scenario}. Original ${label('original')}. Candidate ${label('candidate')}. ${c.paired ? 'Compatible pair' : 'Unmatched'}`);
    const badges = el('span', null, 'dots'); add(badges, badge(label('original')), badge(label('candidate')));
    add(b, el('span', c.scenario, 'case-name'), badges); b.addEventListener('click', () => selectCase(c.scenario)); return b;
  }));
  if (!cases.length) $('case-list').append(small('No scenarios match this filter.'));
}
function checkpointCard(c, cp, variant) {
  const card = el('article', null, 'execution');
  add(card, add(el('header'), el('h3', title(variant)), badge(cp.verdict.status)), small(`Checkpoint ${cp.index} · ${cp.outcome ?? 'Outcome unavailable'}${cp.error ? ' · ' + cp.error : ''}`));
  const p = cp.provider, db = cp.afterShutdown;
  const capture = p.orderCaptures.map(x => x.status).join(', ') || (p.orderRead.httpStatus === 200 ? 'None in order read-back' : 'Read-back unavailable');
  add(card, facts([
    ['Provider order / HTTP', `${p.orderRead.status ?? 'Unknown'} / ${p.orderRead.httpStatus ?? 'unavailable'}`],
    ['Authorization', p.authorization?.status], ['Capture in order read-back', capture],
    ['Capture detail / HTTP', `${p.detailRead.capture?.status ?? 'Not observed'} / ${p.detailRead.httpStatus ?? 'unavailable'}`],
    ['Provider amount (detail)', p.detailRead.capture?.amount], ['Merchant captured_at', db.payment.captured_at ?? 'null'],
    ['Collection', db.collection.status], ['Collection captured amount', db.collection.capturedAmount],
    ['Stored capture status', db.payment.storedCaptures.map(x => x.status).join(', ') || 'None'],
    ['Independent DB connection', `PID ${db.backendPid} · tx ${db.transactionId}`], ['Auditor non-mutation', cp.auditorNonMutation ? 'Recorded unchanged' : 'Not established']
  ]));
  const counters = el('div', null, 'counters');
  for (const [n,label] of [[cp.counters.posts,'Capture POST attempts'],[cp.counters.providerCaptures,'Provider resources'],[db.captures.length,'Active DB capture rows']]) add(counters, add(el('div'), el('strong', n), el('span', label)));
  add(card, counters, small(`Cumulative counters within this execution · worker ${cp.workerPid}`));
  if (cp.uncertainty) add(card, add(el('div', null, 'warning'), el('strong', 'Evidence unresolved at this boundary'), el('p', cp.uncertainty.reason), el('p', `Needed: ${cp.uncertainty.needed}`)));
  for (const rule of cp.verdict.rules) {
    const line = add(el('div', null, 'rule'), badge(rule.status), el('code', ` ${rule.id}`), el('p', rule.reason)); refs(line, rule.evidenceRefs); card.append(line);
  }
  const detail = add(el('details'), el('summary', 'Provider identities, snapshots & checkpoint JSON'));
  add(detail, small(`Recorded at ${cp.at}. Retained simulator state is shown separately from auditor read-back; it cannot fill an unavailable observation.`), el('pre', JSON.stringify({ contract: c[variant].money, ids: c[variant].ids, ...cp }, null, 2)));
  card.append(detail); return card;
}
function selectCase(name) {
  const c = report.cases.find(x => x.scenario === name); if (!c) return;
  selected = name; const selectedUrl=new URL(location.href);selectedUrl.searchParams.set('case',name);selectedUrl.searchParams.set('report',report.id);history.replaceState(null, '', selectedUrl); renderList();
  const panel = $('investigation'); panel.replaceChildren();
  const head = add(el('div', null, 'case-head'), add(el('div'), el('div', 'SELECTED INVESTIGATION', 'eyebrow'), el('h2', name)), badge(c.paired ? 'MATCHED SCENARIO' : 'UNMATCHED'));
  head.querySelector('h2').id = 'case-title'; panel.append(head);
  add(panel, small(`${c.mode} provider control · ${c.steps.length} semantic checkpoints per execution${c.negativeEvidence ? ' · Deliberately invalid evidence test' : ''}`));
  if (!c.paired) panel.append(el('p', 'Pairing unavailable: inspect each available execution independently. Missing or incompatible evidence cannot support a comparison.', 'warning'));
  const violated = [...new Set(c.original.checkpoints.flatMap(p => p.verdict.rules.filter(r => r.status === 'FAIL').map(r => r.id)))];
  const conclusion = violated.length ? `Recorded original violation: ${violated.join(', ')}. Compare the database state at the same declared action boundary below.` : 'No original rule violation is established in the available checkpoints. Method outcomes and lifecycle state remain separate from the scoped verdict.';
  add(panel, add(el('div', null, 'summary-callout'), el('p', conclusion)));
  const premature = c.original.checkpoints.find(p => p.verdict.rules.some(r => r.id === 'PENDING_NOT_COMPLETED' && r.status === 'FAIL') && p.provider.orderCaptures.some(x => x.status === 'PENDING') && p.afterShutdown.collection.status === 'completed');
  if (premature) add(panel, el('p', `At checkpoint ${premature.index}, the original merchant recorded a completed collection while the auditor read a PENDING provider capture. Its database retained ${premature.afterShutdown.captures.length} capture row(s). ${c.paired ? 'The paired observation below shows whether the candidate avoided that mismatch.' : 'No compatible paired comparison is available.'}`));
  const executions = el('div', null, 'comparison');
  for (const v of variants) {
    const r = c[v], card = add(el('article', null, 'execution'), add(el('header'), el('h3', title(v)), badge(r.availability === 'AVAILABLE' ? r.recordedVerdict : 'UNAVAILABLE')));
    add(card, small('Recorded execution aggregate · historical verdict'));
    if (r.availability !== 'AVAILABLE') add(card, el('p', r.issue, 'warning'), small(`Summary label retained: ${r.recordedVerdict ?? 'not recorded'}. Excluded from supported verdict totals.`));
    else { const last = r.checkpoints.at(-1);
      add(card, el('p', r.money.display), small(`Latest checkpoint: ${last.verdict.status}. Lifecycle: ${last.afterShutdown.collection.status}. A PASS can describe safely unresolved payment.`), el('p', `Run ${r.id}`, 'mono run-ref'), small(`${r.startedAt} → ${r.finishedAt}`));
    } executions.append(card);
  } panel.append(executions);
  const candidate = c.candidate.checkpoints;
  // Only display recovery counters and identity continuity when the record establishes them.
  if (c.paired && candidate.length > 1 && candidate[0].afterShutdown.captures.length === 0 && candidate.at(-1).afterShutdown.captures.length === 1 && candidate.at(-1).verdict.status === 'PASS') {
    const ids = candidate.map(p => p.provider.retainedSimulatorCapture?.id);
    const stableId = ids.every(id => id && id === ids[0]);
    add(panel, add(el('div', null, 'summary-callout'), el('strong', 'This candidate sequence: explicit recovery recorded'),
      el('p', `Capture POSTs ${candidate.map(p => p.counters.posts).join(' → ')} · provider resources ${candidate.map(p => p.counters.providerCaptures).join(' → ')} · DB capture rows ${candidate.map(p => p.afterShutdown.captures.length).join(' → ')}.`),
      small(`${stableId ? 'One unchanged retained provider capture identity.' : 'Capture identity continuity not established.'} ${new Set(candidate.map(p => p.workerPid)).size > 1 ? 'Distinct worker processes recorded.' : 'Single worker process recorded.'} Earlier verdicts are retained.`)));
  }
  const limits = el('ul', null, 'limitations'); for (const text of report.limitations) limits.append(el('li', text)); panel.append(limits);
  add(panel, el('h3', 'Aligned actions, separate executions'), small('Aligned by declared phase and action position, not wall-clock time. “capture” after a prior attempt is an explicit reconciliation / repeated call through the same Medusa entry point.'));
  for (const [i, step] of c.steps.entries()) {
    const section = el('section', null, 'evidence-step'); section.id = `checkpoint-${i + 1}`;
    add(section, add(el('h3', null, 'step-title'), el('strong', `${i + 1}. ${step.actions.join(' → ')}`), el('span', `Phase ${step.phase} · action ${step.key}${step.phase > 1 ? ' · after process restart' : ''}`)));
    const columns = el('div', null, 'comparison');
    for (const v of variants) columns.append(c[v].checkpoints[i] ? checkpointCard(c, c[v].checkpoints[i], v) : el('p', `${title(v)} checkpoint unavailable.`, 'warning'));
    add(section, columns); panel.append(section);
  }
  const recommendations = violated.map(id => [id, report.recommendations[id]]);
  if (recommendations.length) {
    const box = add(el('section', null, 'details-block'), el('h3', 'Repair direction · deterministic engineering summary'));
    for (const [id,r] of recommendations) {
      add(box, el('h3', id));
      if (!r) { box.append(small('No grounded recommendation is recorded for this category.')); continue; }
      add(box, small(`Implemented: ${r.implemented}`), small(`Verification scope: ${r.verified}`), small(`Unverified: ${r.unverified}`));
      const a = el('a', r.source); a.href = '#repair-code'; box.append(a);
    } panel.append(box);
  }
  for (const v of variants) if (c[v].availability === 'AVAILABLE') {
    const details = add(el('details', null, 'details-block'), el('summary', `${title(v)} · ordered observation timeline (${c[v].events.length} events)`));
    add(details, small('Each timestamp belongs to this execution only. Sanitized fields omit provider envelopes, SQL and unrelated application records.'));
    for (const e of c[v].events) {
      const item = el('div', null, 'event'); item.id = `event-${e.id}`;
      add(item, el('strong', `${e.ordinal}. ${e.kind}${e.action ? ' · ' + e.action : ''}`), el('small', `${e.at} · ${e.actor} · worker ${e.workerPid}`));
      add(item, el('span', [e.method, e.path, e.status, e.outcome, e.requestId ? `Request ID ${e.requestId}` : null, e.providerCommitted ? 'Simulated provider committed before response discard' : null].filter(x => x !== null).join(' · ')), el('small', e.id)); details.append(item);
    } panel.append(details);
  }
}
function overview() {
  const fields = [ ['External target', `${report.target.name}@${report.target.version}`, `Revision ${report.target.revision}`], ['Repair candidate', report.candidate.version, `SHA-256 ${report.candidate.sha256}`], ['Recorded campaign', report.id, `${report.scope}. Medusa ${report.runtime?.medusa ?? 'version unavailable'} · PostgreSQL package ${report.runtime?.postgresPackage ?? 'version unavailable'}.`] ];
  for (const [label,value,detail] of fields) add($('identity'), add(el('div'), el('span', label, 'label'), el('strong', value), el('span', detail, 'mono')));
  for (const v of variants) {
    const n = report.counts[v], card = el('article', null, `metric ${v}`);
    add(card, add(el('div', null, 'metric-header'), el('h2', title(v)), el('span', `${n.available} available / ${n.executions} scenario-executions`, 'small')));
    const grid = el('div', null, 'metric-grid'); for (const status of ['PASS', 'FAIL', 'INCONCLUSIVE']) add(grid, add(el('div', null, status.toLowerCase()), el('strong', n[status]), el('span', status))); add(card, grid);
    if (n.UNAVAILABLE) card.append(el('p', `${n.UNAVAILABLE} unavailable: not counted as PASS.`, 'warning')); $('metrics').append(card);
  }
  $('units').textContent = `${report.scenarioCount} declared scenarios · ${report.executionCount} indexed executions · ${report.compatiblePairs} compatible pairs · ${report.counts.original.checkpoints + report.counts.candidate.checkpoints} available checkpoints. Any FAIL is retained; otherwise any INCONCLUSIVE is retained. A later PASS never erases history.`;
  const patternGrid = el('div', null, 'pattern-grid');
  for (const p of report.patterns) {
    const box = add(el('article', null, 'pattern'), el('h3', p.id), el('p', `${p.executions} / ${report.counts.original.available + report.counts.candidate.available} available scenario-executions · ${p.checkpoints} failed checkpoints / ${report.counts.original.checkpoints + report.counts.candidate.checkpoints} available checkpoints.`));
    const r = report.recommendations[p.id]; if (r) add(box, el('p', `Implemented: ${r.implemented}`), el('p', `Unverified: ${r.unverified}`));
    const details = add(el('details'), el('summary', 'Contributing observations'));
    const list = el('ul'); for (const o of p.observations) list.append(add(el('li'), caseLink(o.scenario, `${o.scenario} / ${o.implementation} / checkpoint ${o.checkpoint}`, o.checkpoint))); add(details, list); add(box, details); patternGrid.append(box);
  } $('patterns').append(patternGrid);
  $('unknown-summary').textContent = `${report.counts.candidate.INCONCLUSIVE} candidate scenario-executions retain INCONCLUSIVE aggregates, spanning ${report.counts.candidate.inconclusiveCheckpoints} unknown checkpoints. Original executions also contain ${report.counts.original.inconclusiveCheckpoints} unknown checkpoints; their aggregate FAIL takes precedence. Reasons below are recorded per checkpoint, not assumed safe behavior.`;
  for (const c of report.cases) for (const cp of c.candidate.checkpoints.filter(x => x.uncertainty)) {
    const row = add(el('article', null, 'unknown-row'), caseLink(c.scenario, `${c.scenario} · checkpoint ${cp.index}`, cp.index), el('p', `Recorded reason: ${cp.uncertainty.reason}`), el('p', `Needed at that boundary: ${cp.uncertainty.needed}`), small(`Observed merchant: ${cp.afterShutdown.collection.status}; ${cp.afterShutdown.captures.length} DB capture rows. Later checkpoint: ${c.candidate.checkpoints.at(-1).verdict.status}; historical aggregate: ${c.candidate.recordedVerdict}.`));
    $('unknowns').append(row);
  }
  if (report.source) { $('source-ref').textContent = `${report.source.reference} · SHA-256 ${report.source.sha256}`; $('source-code').textContent = report.source.lines.map(l => `${String(l.number).padStart(3)}  ${l.text}`).join('\n'); }
  $('export').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const a = el('a'); a.href = url; a.download = `captureproof-${report.id}-sanitized.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  $('filter').addEventListener('change', renderList);
}
async function loadHistory() {
  try {
    const catalogResponse = await fetch('/api/external-reports'); if (!catalogResponse.ok) throw new Error('Report catalog unavailable.');
    const catalog = await catalogResponse.json(); if (!catalog.length){$('recorded-demo').hidden=true;$('load-status').textContent='No historical reports are bundled. Use the verification workspace above; new runs have their own evidence and no inherited AI diagnosis.';return;}
    const reportId=new URL(location.href).searchParams.get('report') ?? catalog[0].id;
    for(const entry of catalog){const a=el('a',entry.label);a.href=`/external?report=${encodeURIComponent(entry.id)}`;a.className='catalog-link';if(entry.id===reportId)a.setAttribute('aria-current','page');$('report-catalog').append(a);}
    const response = await fetch(`/api/external-reports/${encodeURIComponent(reportId)}`); report = await response.json();
    if (!response.ok || report.availability === 'UNAVAILABLE') throw new Error(`Evidence unavailable: ${(report.issues ?? []).join('; ')}`);
    $('load-status').textContent = report.issues.length ? `Partial report: ${report.issues.join('; ')}` : '';
    if (report.issues.length) $('load-status').className = 'warning';
    if(report.kind==='reservation-crash'){renderCrash();return;}
    $('report').hidden = false; overview();
    const requested = new URL(location.href).searchParams.get('case');
    if(requested&&!report.cases.some(c=>c.scenario===requested))throw Error('Selected historical case is unavailable in this report. No other case was substituted.');
    const best = report.cases.find(c => c.scenario === 'pending-restart' && c.paired && c.original.recordedVerdict === 'FAIL' && c.candidate.recordedVerdict === 'PASS');
    selectCase(report.cases.some(c => c.scenario === requested) ? requested : best?.scenario ?? report.cases[0]?.scenario);
  } catch (error) { $('load-status').textContent = error.message; $('load-status').className = 'warning'; }
}
if(new URL(location.href).searchParams.has('report')||new URL(location.href).searchParams.has('example'))loadHistory();
else window.addEventListener('captureproof:history',loadHistory,{once:true});

function renderCrash() {
  const panel=$('crash-report');panel.hidden=false;document.querySelector('.skip').href='#crash-investigation';
  if(new URL(location.href).searchParams.has('example')){window.mountExternalDiagnosis(panel,'prior');return;}
  add(panel,el('div','FOCUSED RECOVERY EXPERIMENT','eyebrow'),el('h2','A reservation is not a transmission.'),
    el('p','The earlier CaptureProof candidate stalls after a hard process termination. Recovery implementations preserve operation identity and require bound completed evidence. Inspect each labeled implementation and execution separately.'),
    el('p',report.recordedSubset?'Selected recorded earlier-candidate execution. Use the labeled AI examples for the exact revision 3 and limited-prefix evidence.':'Old candidate results remain historical. This report contains one previous-candidate reproduction and five revision-2 checks. The earlier 15-scenario campaign is unchanged.','warning'),
    small(`${report.target.name}@${report.target.version} · ${report.target.revision}`));
  add(panel,add(el('div',null,'summary-callout'),el('strong','Safety and progress are separate'),el('p','STALLED is an observed liveness failure, even when the existing financial oracle reports INCONCLUSIVE. Completed-call verdicts below do not grade the unfinished crash boundary. A committed tentative DB row is not a completed capture.')));
  const context=report.retentionContext;
  const retention=el('section',null,'summary-callout');retention.id='capture-retention';
  add(retention,el('h3','Retention: documentation, policy and experiment'),
    el('p',`Documented provider retention: ${context.documentedProvider.retentionDays} days for authorized-payment capture. Not empirically verified.`),
    el('p',`Application retry policy: ${context.application.replayWindowMs/60000} minutes from the persisted reservation time. Retries and restarts do not reset it; expiry blocks POST, not read-back reconciliation.`),
    el('p',`This recorded execution: revision 2, simulated ${context.experiment.retentionMs/60000}-minute provider retention. Its evidence and verdicts are unchanged.`),
    el('p',context.observed),small('Revision 3 adds strict timing and merchant-context checks. Older executions are not revision-3 verification.'));
  const provenance=el('details');add(provenance,el('summary','Endpoint and documentation provenance'));
  add(provenance,el('p',`${context.endpoint} · ${context.sdk} · ${context.header}`),el('p',`Documentation retrieved ${context.retrievedAt}. ${context.documentedProvider.ambiguity}`));
  for(const source of context.documentedProvider.sources){const a=el('a',source.section);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';add(provenance,add(el('p'),a));}
  add(retention,provenance);panel.append(retention);
  add(panel,small('Original execution scope and limitations (retained at recording time):'));
  const limits=el('ul',null,'limitations');for(const l of report.limitations)limits.append(el('li',l));panel.append(limits);
  add(panel,el('h3','Controller evidence versus application knowledge'),el('p','The controller observes the durable reservation, instrumented dispatch counter, provider file and a fresh SQL read after SIGKILL. The restarted candidate receives normal payment/operation records and SDK read-back only. It treats the reservation as ambiguous. Empty read-back never proves non-submission. The one-hour retention guarantee is an explicit simulator assumption, not a live PayPal finding.'));
  const requestedCase=new URL(location.href).searchParams.get('case');if(requestedCase&&!report.executions.some(r=>r.name===requestedCase)){$('load-status').textContent='Selected historical case is unavailable. No substitute was opened.';return;}const selector=el('select');selector.id='crash-case';const label=el('label','Execution to inspect');label.htmlFor=selector.id;for(const r of report.executions){const o=el('option',`${r.label} · ${r.progress.status}`);o.value=r.name;selector.append(o);}selector.value=report.executions.some(r=>r.name===new URL(location.href).searchParams.get('case'))?new URL(location.href).searchParams.get('case'):(report.executions.find(r=>r.name==='repaired')?.name??report.executions[0].name);
  add(panel,label,selector);const investigation=el('section');investigation.id='crash-investigation';investigation.tabIndex=-1;panel.append(investigation);
  const render=()=>{
    const run=report.executions.find(r=>r.name===selector.value);investigation.replaceChildren();
    if(new URL(location.href).searchParams.has('example')){
      selector.hidden=true;label.hidden=true;
      window.mountExternalDiagnosis(investigation,'prior');return;
    }
    add(investigation,el('h2',run.label),badge(run.progress.status),small(`Completed-call aggregate: ${run.recordedVerdict} · ${run.money.display}`),el('p',run.progress.reason),small(`Run ${run.runId} · ${run.startedAt} → ${run.finishedAt}`),el('p',`Stable operation identity: ${run.operationIds.join(', ') || 'None recorded'}`,'mono'));
    for(const p of run.points){
      const card=add(el('article',null,'execution crash-point'),add(el('header'),el('h3',p.label),badge(p.boundary)),small(`Worker ${p.workerPid}${p.outcome?' · '+p.outcome:''}${p.error?' · '+p.error:''}`));
      const counts=el('div',null,'counters');for(const [n,l]of[[p.posts??'Unknown','Dispatched capture POSTs'],[p.accepted??'Unknown','Provider-accepted operations'],[p.distinctCaptures??'Unknown','Distinct provider capture IDs'],[p.database.captures.length,'Active database capture rows']])add(counts,add(el('div'),el('strong',n),el('span',l)));card.append(counts);
      add(card,facts([['Provider capture',p.captureStatus??'None'],['Provider capture ID',p.captureId??'None'],['captured_at',p.database.payment.captured_at??'null'],['Collection state',p.database.collection.status],['Captured amount',p.database.collection.capturedAmount],['Operation state',p.database.operations.map(o=>o.state).join(', ')],['Independent SQL read',`PID ${p.database.backendPid} · tx ${p.database.transactionId}`]]));
      if(p.reason)card.append(el('p',p.reason,p.boundary==='INCONCLUSIVE'?'warning':'small'));
      if(p.rules)for(const r of p.rules)add(card,small(`${r.status} · ${r.id}: ${r.reason}`));
      const details=add(el('details'),el('summary','Sanitized evidence and references'),el('pre',JSON.stringify(p,null,2)));add(card,details);investigation.append(card);
    }
    window.mountExternalDiagnosis(investigation,run.name);
    const timeline=add(el('details',null,'details-block'),el('summary','Ordered observations and source hashes'),el('pre',JSON.stringify({sourceReferences:run.sourceReferences,events:run.events},null,2)));investigation.append(timeline);
  };selector.addEventListener('change',render);render();
  const exportButton=el('button','Download sanitized crash evidence JSON ↓');exportButton.id='crash-export';exportButton.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=`captureproof-${report.id}-sanitized.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});panel.append(exportButton);
  for(const source of report.source)add(panel,add(el('details',null,'details-block'),el('summary',`Frozen ${source.name} · ${source.sha256}`),el('pre',source.text)));
}
