import { runExperiment, SCENARIOS } from './src/experiment.mjs';

console.log('CaptureProof starter: LOCAL SIMULATION ONLY — no PayPal or AI calls.');
for (const scenario of SCENARIOS) {
  for (const implementation of ['seeded-bug', 'fixed']) {
    const result = await runExperiment({ scenario, implementation });
    console.log(JSON.stringify({ scenario, implementation, ...result.verdict }));
  }
}
