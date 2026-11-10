(() => {
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const add=(n,...children)=>{n.append(...children);return n;};
  const anchor=(text,id)=>{const a=el('a',text);a.href=`#${id}`;a.onclick=()=>{const target=document.getElementById(id);if(!target)return;for(let n=target;n;n=n.parentElement)if(n.tagName==='DETAILS')n.open=true;};return a;};
  const sourceId=path=>'repair-file-'+path.replaceAll(/[^a-zA-Z0-9]/g,'-');
  function code(label,excerpt){
    const box=el('div',undefined,'repair-code');box.append(el('h4',label));
    if(!excerpt){box.append(el('p','Additional CaptureProof integration component. No corresponding upstream replacement file.'));return box;}
    add(box,anchor(`${excerpt.path}:${excerpt.startLine}–${excerpt.endLine}`,sourceId(excerpt.path)),el('pre',excerpt.lines.map(l=>`${l.number}  ${l.text}`).join('\n')));return box;
  }
  window.mountRepairReview=(parent,job,request,{exactAnalysis=false}={})=>{
    const review=job.repairReview,section=el('section',undefined,'repair-review');section.id='repair-review';parent.append(section);
    if(review?.availability!=='AVAILABLE'){add(section,el('h3','Repair review unavailable'),el('p',review?.reason??'No source-bound repair review is available.'));return;}
    const f=review.finding;
    add(section,el('div','EVIDENCE → CODE → REVIEW MATERIAL','eyebrow'),el('h2',f.title),el('p',f.explanation,'intro'),
      el('p',`${review.target.name}@${review.target.version} · Medusa ${review.target.versions['@medusajs/payment']} · PayPal SDK ${review.target.versions['@paypal/paypal-server-sdk']}`),
      el('p',`Pinned upstream revision ${review.target.revision}`,'mono'),el('p','Saved execution · actual Medusa/PostgreSQL · simulated PayPal. Both executions completed; FAIL describes the payment invariant, not an infrastructure crash.','provenance'));
    const nav=el('nav',undefined,'repair-nav');add(nav,anchor('1. Supporting observations','repair-observations'),anchor('2. Actual code changes','repair-changes'),anchor('3. Download & reproduce','repair-material'));section.append(nav);
    const observations=el('div',undefined,'comparison');observations.id='repair-observations';
    for(const [label,p]of [['Upstream · premature paid state',f.baseline],['Candidate · pending stays unpaid',f.candidate],['Candidate · completed read-back',f.recovered]]){
      const card=el('article',undefined,'execution');add(card,el('h3',label),el('strong',`${p.providerStatus} provider / ${p.merchantPaid?'paid':'unpaid'} merchant`),el('p',`Invariant result: ${p.verdict}. Active DB capture rows: ${p.counters.databaseRows}.`),el('p',`POST attempts ${p.counters.posts}; accepted operations ${p.counters.accepted??'unknown'}; unique provider captures ${p.counters.providerCaptures}.`),anchor(`Open checkpoint ${p.checkpoint}`,`evidence-${p.runId}-${p.checkpoint}`));observations.append(card);
    }section.append(observations);
    add(section,el('p',`Failed invariant: ${f.rule}. Later settlement does not erase an earlier premature paid state.`),el('p','The candidate comparison improves the observed pending-to-completed transition. Compensation may remove a tentative row; recovery may create a new valid row. Row replacement or a refreshed completion timestamp alone does not mean a duplicate payment.'));
    const changes=el('section');changes.id='repair-changes';
    add(changes,el('h3','What actually changed'),el('p',review.attribution),el('p','Integration-specific candidate: provider overrides + PostgreSQL operation store + Medusa host hook. The pinned upstream source is unchanged. This is not a standalone upstream patch.','warning'));
    for(const c of review.components){
      const d=el('details',undefined,'repair-component');d.id=`repair-component-${c.id}`;
      add(d,el('summary',c.title),el('p',c.layer,'eyebrow'),el('p',c.change),el('p',c.relationship),el('p',`Evidence scope: ${c.verified}`));
      const refs=el('p');for(const [i,ref]of c.evidenceRefs.entries()){if(i)refs.append(document.createTextNode(' · '));refs.append(anchor(`${ref.runId===f.baseline.runId?'Upstream':'Candidate'} checkpoint ${ref.checkpoint}`,`evidence-${ref.runId}-${ref.checkpoint}`));}d.append(refs);
      const compare=el('div',undefined,c.before?'comparison':'');if(c.before)compare.append(code('Executed baseline method',c.before));compare.append(code(c.before?'Executed candidate override':'Executed added component',c.after));d.append(compare);changes.append(d);
    }section.append(changes);
    const material=el('section');material.id='repair-material';add(material,el('h3','Take the review material with you'),el('p','Download exact selected source snapshots, hashes, annotated code ranges, integration requirements, evidence references and reproduction instructions. No credentials, private AI responses, SQL logs or payment database records are included.'));
    const requirements=el('details');requirements.append(el('summary','Integration requirements and limits'));for(const text of [...review.integrationRequirements,...review.limits])requirements.append(el('p',text));material.append(requirements);
    const reproduce=el('details');add(reproduce,el('summary','Reproduce explicitly in this workspace'),el('pre',review.reproduction.command),el('p',`Select ${review.reproduction.target} / ${review.reproduction.scenario}. ${review.reproduction.action}`));for(const text of review.reproduction.prerequisites)reproduce.append(el('p',text));reproduce.append(el('p',review.reproduction.timing));material.append(reproduce);
    const download=el('button','Download repair review bundle');download.id='repair-review-download';const status=el('p');status.setAttribute('role','status');
    download.onclick=async()=>{download.disabled=true;try{const bundle=await request(`/api/verifications/${job.id}/repair-review`);const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=`captureproof-repair-review-${job.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Integration-specific review bundle downloaded. Nothing was applied or executed.';}catch(e){status.textContent=e.message;}finally{download.disabled=false;}};
    add(material,download,status);section.append(material);
    const files=el('details');files.append(el('summary','Selected file identities and full-source links'));
    for(const file of review.fileManifest){const row=el('div');row.id=sourceId(file.path);add(row,el('h4',file.path),el('p',`${file.role} · SHA-256 ${file.sha256}`,'mono'));const index=job.sources.findIndex(s=>s.path===file.path&&s.sha256===file.sha256);if(index>=0)row.append(anchor('Open full frozen source',`verification-source-${index}`));else row.append(el('p','Exact contents included in the review download.'));files.append(row);}section.append(files);
    if(exactAnalysis){section.append(el('p','Read stored AI analysis on the exact upstream execution below. Its original review is separate from this developer-authored repair comparison.'));return;}
    const ai=el('section');ai.id='repair-ai-boundary';
    add(ai,el('h3','AI diagnosis not generated for this run'),el('p','Prepare an UNSENT request using only this upstream execution, its frozen provider/Medusa source and operating contract. The repair code, comparison verdict and engineering explanation above are excluded. Preparation does not validate model quality or authorize a model call.'));
    const prepare=el('button','Prepare upstream AI input — no model call');prepare.id='upstream-ai-prepare';const output=el('div');output.id='upstream-ai-preparation';
    prepare.onclick=async()=>{prepare.disabled=true;output.replaceChildren(el('p','Reading bound upstream evidence…'));try{
      const prepared=await request(`/api/verifications/${job.id}/diagnosis-preparation`);
      if(prepared.jobId!==job.id||prepared.executionId!==f.baseline.runId||prepared.status!=='UNSENT'||prepared.dispatchEnabled!==false)throw Error('AI_PREPARATION_IDENTITY_MISMATCH');
      output.replaceChildren(el('strong','UNSENT · AI diagnosis not generated for this run'),el('p',`Contract ${prepared.contractVersion}. Model configuration retained; no request, retry or budget reservation.`));
      const identity=el('details');add(identity,el('summary','Exact upstream input, executed sources and request identity'),el('pre',JSON.stringify(prepared,null,2)));output.append(identity);
      const download=el('button','Download UNSENT upstream AI request');download.id='upstream-ai-download';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(prepared,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download=`captureproof-upstream-${prepared.executionId}-unsent.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};output.append(download);
    }catch(e){output.replaceChildren(el('p',`Preparation unavailable: ${e.message}. No model request made.`));}finally{prepare.disabled=false;}};
    add(ai,prepare,output,el('p','The explanation and repair material above are deterministic engineering review and developer-authored code. Historical blocked-recovery and healthy AI responses analyzed different executions; none is attached to this comparison. Their original rejection, PARTIAL and reuse restrictions remain intact.'));
    const link=el('a','Open separately recorded AI examples');link.href='/external?report=da3bbb86-3647-49d3-973d-efc3eacbb4be&case=prior&example=defect#external-diagnosis';ai.append(link);section.append(ai);
  };
})();
