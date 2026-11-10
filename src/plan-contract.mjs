import { SCENARIOS } from './experiment.mjs';

// This validates a future model's bounded plan; it does not call a model.
// No URL, shell command, money amount, or credential can be supplied by this plan.
export function validatePlan(plan, availableEvidenceIds) {
  if (!Array.isArray(plan) || plan.length < 1 || plan.length > 3) throw new Error('Plan must have 1..3 experiments.');
  const available = new Set(availableEvidenceIds);
  const seen = new Set();
  for (const step of plan) {
    if (!step || Object.keys(step).some(k => !['scenario', 'reason', 'evidenceRefs'].includes(k))) throw new Error('Unknown plan field.');
    if (!SCENARIOS.includes(step.scenario) || seen.has(step.scenario)) throw new Error('Unknown or repeated scenario.');
    if (typeof step.reason !== 'string' || step.reason.length < 1 || step.reason.length > 600) throw new Error('A concise reason is required.');
    if (!Array.isArray(step.evidenceRefs) || !step.evidenceRefs.length || step.evidenceRefs.some(id => !available.has(id))) throw new Error('Every reason needs existing evidence references.');
    seen.add(step.scenario);
  }
  return structuredClone(plan);
}
