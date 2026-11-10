import { usdMinor } from './checkout-contract.mjs';

// USD-only diagnosis formatting. Checkout arithmetic and provider evidence are untouched.
export function canonicalMoney(amountMinor, currency) {
  if (currency !== 'USD' || !Number.isSafeInteger(amountMinor) || amountMinor < 0) return null;
  const n = BigInt(amountMinor);
  const major = `${n / 100n}.${String(n % 100n).padStart(2, '0')}`;
  if (usdMinor(major) !== amountMinor) return null;
  return { amountMinor, currency, major, display: `${currency} ${major}` };
}

export function monetaryFacts(input) {
  return (input.evidence ?? []).flatMap(e => Object.entries(e.fields ?? {})
    .filter(([field]) => /(^|\.)amountMinor$/.test(field))
    .map(([amountField, amountMinor]) => {
      const prefix = amountField.slice(0, -'amountMinor'.length), currencyField = `${prefix}currency`;
      const currency = e.fields[currencyField], canonical = canonicalMoney(amountMinor, currency);
      // Do not silently reconcile conflicting declarations within a single fact.
      const contradictions = ['unit', 'amountUnit'].some(k => Object.hasOwn(e.fields, prefix + k) && e.fields[prefix + k] !== 'minor') ||
        ['major', 'amountMajor'].some(k => Object.hasOwn(e.fields, prefix + k) && e.fields[prefix + k] !== canonical?.major) ||
        (Object.hasOwn(e.fields, prefix + 'display') && e.fields[prefix + 'display'] !== canonical?.display);
      return { evidenceRef: e.id, amountField, currencyField,
        ...(canonical && !contradictions ? { available: true, ...canonical } :
          { available: false, reason: 'MISSING_INVALID_OR_CONFLICTING_MONEY_FIELDS' }) };
    }));
}

export function withMonetaryFacts(input) {
  return { ...input, monetaryFacts: monetaryFacts(input) };
}

// A bounded English contract guard, NOT a general natural-language truth checker.
// Money values belong in typed claims and {{money:N}} references, never free prose.
const moneyLanguage = /[$€£¥]|\b(?:USD|EUR|GBP|JPY|CAD|AUD|dollars?|cents?|pennies|minor[\s_-]+units?|major[\s_-]+units?)\b/i;
const token = /\{\{money:(0|[1-9]\d*)\}\}/g;
export function validateMonetaryClaims(result, input, fail, policy = 'referenced') {
  if (!['referenced', 'display-grounded-facts'].includes(policy)) fail('INVALID_MONEY_POLICY');
  const facts = monetaryFacts(input), used = new Set();
  for (const claim of result.moneyClaims) {
    const matches = facts.filter(f => f.evidenceRef === claim.evidenceRef && f.amountField === claim.amountField && f.currencyField === claim.currencyField);
    if (matches.length !== 1 || !matches[0].available) fail('MONEY_EVIDENCE_UNAVAILABLE');
    const canonical = canonicalMoney(claim.amountMinor, claim.currency);
    if (!canonical || canonical.major !== claim.major || canonical.display !== claim.display) fail('MONEY_UNIT_MISMATCH');
    if (claim.kind !== 'negative_test' &&
        (matches[0].amountMinor !== claim.amountMinor || matches[0].currency !== claim.currency)) fail('MONEY_FACT_MISMATCH');
    if (claim.kind === 'negative_test' && matches[0].amountMinor === claim.amountMinor) fail('NEGATIVE_MONEY_INPUT_MUST_DIFFER');
  }
  const inspect = (text, evidenceRefs, negativeAllowed = false) => {
    const remainder = text.replace(token, (_, index) => {
      const claim = result.moneyClaims[Number(index)];
      if (!claim || !evidenceRefs.includes(claim.evidenceRef)) fail('MONEY_REFERENCE_MISMATCH');
      if (claim.kind === 'negative_test' && !negativeAllowed) fail('NEGATIVE_MONEY_CONTEXT');
      used.add(Number(index));
      return '';
    });
    if (/\{\{|\}\}/.test(remainder)) fail('INVALID_MONEY_TOKEN');
    if (moneyLanguage.test(remainder)) fail('UNSTRUCTURED_MONEY_TEXT');
  };
  for (const f of result.findings) inspect(f.explanation, f.evidenceRefs);
  if (result.fixDirection) inspect(result.fixDirection.text, result.fixDirection.evidenceRefs);
  if (result.regressionTest) inspect(result.regressionTest.text, result.regressionTest.evidenceRefs, true);
  for (const c of result.regressionControls ?? []) for (const text of [c.purpose,c.preconditions,...c.actions,...c.assertions.map(a=>a.observation),c.reason,c.evidenceGap].filter(x=>x!==null)) inspect(text,c.evidenceRefs);
  for (const u of result.uncertainties) inspect(u, []);
  // Displayed observed/expected facts need no prose token, but every claim above
  // is grounded first. Hypothetical inputs still require regression-test context.
  if (result.moneyClaims.some((claim, index) => !used.has(index) &&
      (policy === 'referenced' || claim.kind === 'negative_test'))) fail('UNUSED_MONEY_CLAIM');
}

// Call only after current validation. No generated text is repaired or overwritten.
export function formatMoneyClaim(c) {
  const value = `${c.display} (${c.amountMinor} minor units) [${c.evidenceRef}:${c.amountField}, ${c.currencyField}]`;
  return c.kind === 'negative_test' ? `HYPOTHETICAL NEGATIVE-TEST INPUT: ${value}; not an observed or expected payment` : `${c.kind}: ${value}`;
}
export function renderMonetaryClaims(result, { includeMetadata = false } = {}) {
  const render = text => text.replace(token, (_, i) => {
    const c = result.moneyClaims[Number(i)];
    return formatMoneyClaim(c);
  });
  return { ...result,
    ...(includeMetadata ? { monetaryMetadata: result.moneyClaims.map(formatMoneyClaim) } : {}),
    ...(result.regressionControls ? {regressionControls:result.regressionControls.map(c=>({...c,purpose:render(c.purpose),preconditions:render(c.preconditions),actions:c.actions.map(render),assertions:c.assertions.map(a=>({...a,observation:render(a.observation)})),reason:render(c.reason),evidenceGap:c.evidenceGap===null?null:render(c.evidenceGap)}))} : {}),
    findings: result.findings.map(f => ({ ...f, explanation: render(f.explanation) })),
    fixDirection: result.fixDirection && { ...result.fixDirection, text: render(result.fixDirection.text) },
    regressionTest: result.regressionTest && { ...result.regressionTest, text: render(result.regressionTest.text) },
    uncertainties: result.uncertainties.map(render) };
}
