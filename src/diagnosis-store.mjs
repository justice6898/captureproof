import { backup, DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, lstatSync, writeFileSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dirname, join } from 'node:path';
import { sanitizeRejectedDiagnosis, sanitizeResponseTexts } from './diagnosis-review.mjs';
import { DiagnosisError } from './diagnosis-contract.mjs';
import { randomUUID } from 'node:crypto';
import { diagnosisPresentation } from './diagnosis-presentation.mjs';

export class DiagnosisStore {
  #reviewDirectory; #sensitiveValues;
  constructor(db, { reviewDirectory, sensitiveValues = [process.env.OPENAI_API_KEY, process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET] } = {}) {
    this.db = db;
    const file = db.prepare('PRAGMA database_list').all().find(d => d.name === 'main').file;
    this.#reviewDirectory = reviewDirectory ?? (file ? join(dirname(file), 'private-diagnosis-reviews') : null);
    this.#sensitiveValues = sensitiveValues;
  }
  retainResponse({ texts, metadata, input, schema }) {
    if (!this.#reviewDirectory || !/^[0-9a-f-]{36}$/.test(metadata.clientRequestId)) throw new DiagnosisError('PRIVATE_RESPONSE_STORAGE_FAILED');
    mkdirSync(this.#reviewDirectory, { recursive: true, mode: 0o700 });
    const directory = lstatSync(this.#reviewDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new DiagnosisError('PRIVATE_RESPONSE_STORAGE_FAILED');
    chmodSync(this.#reviewDirectory, 0o700);
    const retained = sanitizeResponseTexts(texts, this.#sensitiveValues, schema, input?.sources);
    // Compare in memory without retaining raw text, sensitive values, or their hashes.
    const preservationComparison = retained.messages.map((message, index) => ({
      representation: message.representation,
      contentEqual: isDeepStrictEqual(message.fields, message.representation === 'RESERIALIZED_SANITIZED_PARSED_JSON' ? JSON.parse(texts[index]) : { text: texts[index] }),
      omittedFields: message.omittedFields, redactedFields: message.redactedFields
    }));
    const artifact = { ...retained, classification: 'UNVALIDATED_MODEL_TEXT', metadata, preservationComparison };
    const path = join(this.#reviewDirectory, `${metadata.clientRequestId}.response.json`);
    writeFileSync(path, JSON.stringify(artifact, null, 2), { flag: 'wx', mode: 0o600, flush: true });
    if (!isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), artifact)) throw new DiagnosisError('PRIVATE_RESPONSE_ROUNDTRIP_FAILED');
    return { retained: true, omittedFields: retained.omittedFields, redactedFields: retained.redactedFields,
      omittedMessages: retained.omittedMessages, preservationComparison, storedMatchesSanitized: true };
  }
  retainRejected(record, candidate, schema) {
    if (!this.#reviewDirectory) return { retained: false, reason: 'PRIVATE_REVIEW_STORAGE_NOT_CONFIGURED' };
    try {
      if (!/^[0-9a-f-]{36}$/.test(record.id)) throw new Error('Invalid attempt identity');
      mkdirSync(this.#reviewDirectory, { recursive: true, mode: 0o700 });
      const directory = lstatSync(this.#reviewDirectory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe review directory');
      chmodSync(this.#reviewDirectory, 0o700);
      const review = sanitizeRejectedDiagnosis(candidate, this.#sensitiveValues, schema, { trustedSources: record.input?.sources });
      const artifact = { ...review, attemptId: record.id, runId: record.runId, rejectionReason: record.error,
        responseStatus: record.responseStatus, incompleteReason: record.incompleteReason ?? null, requestedModel: record.requestedModel, returnedModel: record.returnedModel,
        responseId: record.responseId ?? null, metadataOmissions: record.metadataOmissions ?? [], promptVersion: record.promptVersion, schemaVersion: record.schemaVersion,
        validatorVersion: record.validatorVersion, evidenceFingerprint: record.fingerprint,
        promptHash: record.promptHash, schemaHash: record.schemaHash, createdAt: record.createdAt,
        finishedAt: record.finishedAt, usage: record.usage, usageStatus: record.usageStatus ?? 'UNKNOWN',
        clientRequestId: record.clientRequestId ?? null, providerRequestId: record.providerRequestId ?? null,
        effectiveDeadlineMs: record.effectiveDeadlineMs ?? record.config?.timeoutMs, elapsedMs: record.elapsedMs ?? null,
        transportAttempts: record.transportAttempts ?? null, localCancellation: record.localCancellation ?? false, providerOutcome: record.providerOutcome ?? 'UNKNOWN' };
      const content = JSON.stringify(artifact, null, 2);
      if (Buffer.byteLength(content) > 32000) throw new Error('Review byte bound exceeded');
      writeFileSync(join(this.#reviewDirectory, `${record.id}.json`), content, { flag: 'wx', mode: 0o600 });
      // The public record contains only a receipt, never the private generated fields or path.
      return { retained: true, classification: review.classification, omittedFields: review.omittedFields };
    } catch { return { retained: false, reason: 'PRIVATE_REVIEW_STORAGE_FAILED' }; }
  }
  retainedResponse(id) {
    if (!this.#reviewDirectory || !/^[0-9a-f-]{36}$/.test(id)) return null;
    try {
      const value = JSON.parse(readFileSync(join(this.#reviewDirectory, `${id}.response.json`), 'utf8'));
      if (value.metadata?.clientRequestId !== id || value.classification !== 'UNVALIDATED_MODEL_TEXT') return null;
      return value;
    } catch { return null; }
  }
  static async open(db) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='diagnoses'").get()) {
      const file = db.prepare('PRAGMA database_list').all().find(d => d.name === 'main').file;
      if (file) {
        const dir = join(dirname(file), 'backups'); mkdirSync(dir, { recursive: true, mode: 0o700 });
        const path = join(dir, `pre-diagnosis-${randomUUID()}.sqlite`);
        await backup(db, path); chmodSync(path, 0o600);
        const copy = new DatabaseSync(path, { readOnly: true });
        try { if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('DIAGNOSIS_BACKUP_INVALID'); }
        finally { copy.close(); }
      }
      db.exec(`CREATE TABLE IF NOT EXISTS diagnoses (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record))
      ); CREATE INDEX IF NOT EXISTS diagnoses_lookup ON diagnoses(run_id, fingerprint, created_at);`);
    }
    return new DiagnosisStore(db);
  }
  list(runId) { return this.db.prepare('SELECT record FROM diagnoses WHERE run_id=? ORDER BY rowid DESC').all(runId).map(r => JSON.parse(r.record)); }
  reserve(record, maxAttempts, timeoutMs, present = diagnosisPresentation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const history = this.list(record.runId);
      for (const prior of history) if (prior.status === 'running') {
        if (record.createdAt - prior.createdAt <= (prior.config?.timeoutMs ?? timeoutMs) + 5000) throw new DiagnosisError('AI_BUSY');
        this.save({ ...prior, status: 'failed', error: 'AI_INTERRUPTED', finishedAt: record.createdAt });
      }
      const matches = history.filter(r => r.fingerprint === record.fingerprint);
      const saved = matches.find(r => present(r, record.input).reusable);
      if (saved) { this.db.exec('COMMIT'); return saved; }
      if (matches.filter(r => r.providerAttempt).length >= maxAttempts) throw new DiagnosisError('AI_ATTEMPT_LIMIT_REACHED');
      this.save(record); this.db.exec('COMMIT'); return record;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  save(record) {
    this.db.prepare(`INSERT INTO diagnoses VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,record=excluded.record`)
      .run(record.id, record.runId, record.fingerprint, record.status, record.createdAt, JSON.stringify(record));
    return record;
  }
}
