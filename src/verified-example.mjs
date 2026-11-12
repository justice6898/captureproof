import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scenarioFinding } from '../public/verification-state.mjs';

export const PRIMARY_EXAMPLE = 'reviewed-v6';
const examples = Object.freeze({
  'reviewed-v6': {directory: 'reviewed-v6-journey-2026-11-12', sha256: 'f06942a8688537dd4e89a9370ba4c9141ef3280ed0dbaf88a6818ba2fede347a', attemptId: '3dcbf49c-439b-441a-9b69-3e8acd643054', runId: 'f111b657-0de7-4b05-91d0-9cafcaf3449b'},
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
export function bundledExample(id = PRIMARY_EXAMPLE, { read = readFileSync } = {}) {
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
    const selected = primary.analysis.records?.find(r=>r.id===primary.analysis.selectedAttemptId);
    if(entry.attemptId && (primary.execution.runId!==entry.runId || primary.analysis.executionId!==entry.runId || primary.analysis.input?.execution?.runId!==entry.runId || selected?.id!==entry.attemptId || primary.analysis.records.length!==1 || selected.schemaVersion!=='external-diagnosis-6' || selected.currentValidation!=='ACCEPTED' || selected.semanticReview?.outcome!=='PASS'))throw Error('EXAMPLE_DIAGNOSIS_IDENTITY');
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
      analysisStatus: selected ? 'MATCHED_REVIEWED_DIAGNOSIS' : primary.analysis.records?.length ? 'SEPARATE_STORED_ANALYSIS' : 'NO_MATCHING_ANALYSIS',
      selectedAttemptId: selected?.id ?? null
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
