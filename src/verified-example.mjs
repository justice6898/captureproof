import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scenarioFinding } from '../public/verification-state.mjs';

const examples = Object.freeze({
  'upstream-pending': {
    directory: 'upstream-pending-replayed-2026-10-29',
    sha256: '9c81ed56f2f24bfb2bf7ab7a94734835c15e37fe4ea62e7c9011000e7e5b08a3'
  },
  'reviewed-comparison': {
    directory: 'developer-reviewed-2026-11-06',
    sha256: '30b106cbffd6cc10cebc4f64387013f708a1506c5ba9c94f4568fc7332f2fb3e'
  }
});

// Only catalog entries become file paths. Hash-pinned HTML is the distributed artifact;
// its embedded data is parsed as JSON, never executed or loaded from a private job DB.
export function bundledExample(id = 'reviewed-comparison', { read = readFileSync } = {}) {
  const entry = examples[id];
  if (!entry) return { available: false, reason: 'Unknown bundled example.' };
  try {
    const directory = fileURLToPath(new URL(`../data/portable-reports/${entry.directory}/`, import.meta.url));
    const body = read(directory + 'report.html');
    const manifest = JSON.parse(read(directory + 'manifest.json'));
    const sha256 = createHash('sha256').update(body).digest('hex');
    const file = manifest.files.find(f => f.path === 'report.html');
    if (sha256 !== entry.sha256 || file?.sha256 !== sha256 || file.bytes !== body.length) throw Error('EXAMPLE_INTEGRITY');
    const match = body.toString().match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/);
    const data = JSON.parse(match?.[1]);
    if (data.format !== 'captureproof-portable-report-1') throw Error('EXAMPLE_FORMAT');
    const primary = data.primary;
    return {
      available: true, origin: 'BUNDLED_RECORDED_EVIDENCE',
      title: 'Provider pending. Merchant already paid.',
      url: `/examples/${id}`, download: `/examples/${id}/download`, sha256, body,
      jobId: primary.jobId, runId: primary.execution.runId, caseId: primary.caseId,
      artifactSha256: primary.reproducer?.origin.artifactSha256,
      finding: scenarioFinding(primary.execution, primary.repairExecution),
      baseline: primary.execution.checkpoints[0], candidate: primary.repairExecution?.checkpoints[0],
      final: primary.repairExecution?.checkpoints.at(-1),
      scope: 'Bundled recorded comparison; separate from your workspace. No execution or AI generation.',
      analysisStatus: primary.analysis.records?.length ? 'SEPARATE_STORED_ANALYSIS' : 'NO_MATCHING_ANALYSIS'
    };
  } catch (error) {
    return { available: false, origin: 'BUNDLED_RECORDED_EVIDENCE', reason: error.code === 'ENOENT'
      ? 'Bundled report is missing. Restore the matching report and manifest; your workspace is separate.'
      : 'Bundled report failed its integrity check. No other run was substituted.' };
  }
}

export function verifiedExample(options = {}) {
  return bundledExample('upstream-pending', options);
}

export function reviewedSelection(options = {}) {
  const example = bundledExample('reviewed-comparison', options);
  if (!example.available) throw Error('REVIEW_SELECTION_INTEGRITY');
  const { jobId, runId, caseId, artifactSha256 } = example;
  return { jobId, runId, caseId, artifactSha256 };
}
