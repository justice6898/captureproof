// Shared, inert checkpoint rendering for the application and portable report.
(() => {
 const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
 };
 // One guarded fragment reader for initial load, async rendering and history changes.
 window.captureFragment = () => {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
 };
 window.revealCaptureFragment = () => {
  const id = window.captureFragment();
  if (id) window.revealCaptureTarget(id);
 };
 window.renderCaptureComparison = (original, candidate) => {
  const summary = element('div', undefined, 'comparison-brief');
  summary.append(element('strong', 'At the same first returned call'));
  for (const [label, view] of [['Original', original], ['Repair / candidate', candidate]]) {
   const fact = name => view.facts.find(([key]) => key === name)?.[1] ?? 'Unknown';
   summary.append(element('p', `${label}: provider ${fact('Provider capture')}; merchant ${fact('Merchant collection')}; capture rows ${fact('Active capture rows')}.`));
  }
  return summary;
 };
 window.renderCaptureCheckpoint = (title, view) => {
  const card = element('article', undefined, 'state-card');
  card.dataset.verdict = view.status;
  const header = element('header');
  header.append(element('h3', title), element('span', view.status, 'verdict-tag'));
  const facts = element('dl', undefined, 'state-facts');
  for (const [label, value] of view.facts) {
   facts.append(element('dt', label), element('dd', String(value)));
  }
  card.append(header, facts);
  const reason = element('div', undefined, 'verdict-reason');
  for (const text of view.reasons) reason.append(element('p', text));
  if (view.uncertainty) reason.append(element('p', 'Unresolved: ' + view.uncertainty));
  card.append(reason);
  const counts = element('details', undefined, 'checkpoint-counts');
  counts.append(element('summary', 'Request and resource counts'), element('p', view.counters));
  card.append(counts);
  return card;
 };
// Shared disclosure/navigation behavior. Targets retain their original identifiers.
 const node = element;
 window.renderCapturePhase = (title, entries) => {
  const phase = node('section', undefined, 'evidence-phase');
  phase.append(node('h3', title));
  const summary = node('div', undefined, 'phase-summary');
  const full = node('details');
  full.append(node('summary', 'Inspect state, counters and rule evidence'));
  const cards = node('div', undefined, 'comparison');
  for (const { label, view, card } of entries) {
   const item = node('div');
   if (card.dataset.implementation) item.dataset.implementation = card.dataset.implementation;
   item.append(node('strong', `${label} · ${view.status}`), node('p', view.reasons.join(' ')));
   if (view.uncertainty) item.append(node('p', 'Unresolved: ' + view.uncertainty));
   summary.append(item); cards.append(card);
  }
  full.append(cards); phase.append(summary, full);
  return phase;
 };
 window.revealCaptureTarget = id => {
  window.dispatchEvent(new CustomEvent('captureproof:reveal', { detail: { id } }));
  const target = document.getElementById(id);
  if (!target) return;
  for (let parent = target; parent; parent = parent.parentElement) {
   if (parent.tagName === 'DETAILS') parent.open = true;
   if (parent.hidden) parent.hidden = false;
  }
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
 };
 window.addEventListener('hashchange', window.revealCaptureFragment);
 window.addEventListener('DOMContentLoaded', window.revealCaptureFragment);
 window.trackCaptureSections = nav => {
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const update = () => {
   if (!nav.isConnected) return;
   const entries = links.map(link => ({ link, section: document.getElementById(link.hash.slice(1)) })).filter(x => x.section?.getClientRects().length);
   let active = entries[0];
   for (const entry of entries) if (entry.section.getBoundingClientRect().top <= 150) active = entry;
   if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) active = entries.at(-1);
   for (const { link } of entries) {
    if (link === active?.link) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
   }
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('hashchange', update);
  window.addEventListener('resize', update);
  update();
 };
})();
