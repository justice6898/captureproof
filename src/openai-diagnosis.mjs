import { randomUUID } from 'node:crypto';
import { DIAGNOSIS_SCHEMA, INSTRUCTIONS, LIMITS, DiagnosisError } from './diagnosis-contract.mjs';
import { withMonetaryFacts } from './diagnosis-money.mjs';

export function diagnosisConfig(env = process.env) {
  const model = env.OPENAI_MODEL || 'gpt-6.1-sol';
  const reasoning = env.OPENAI_REASONING_EFFORT || 'medium';
  const deadline = env.OPENAI_REQUEST_TIMEOUT_MS ?? '180000';
  const timeoutMs = Number(deadline);
  const validDeadline = /^\d+$/.test(String(deadline)) && Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300000;
  const valid = validDeadline && /^[a-zA-Z0-9._-]{1,80}$/.test(model) && ['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoning);
  return Object.freeze({ model, reasoning, valid, maxOutputTokens: LIMITS.outputTokens, timeoutMs, maxAttempts: LIMITS.attempts, serviceTier: 'default', transport: 'node-fetch-responses-v1', automaticRetries: 0 });
}
export class OpenAIDiagnosis {
  #key; #fetch;
  constructor({ apiKey, config = diagnosisConfig(), fetchImpl = fetch, beforeRequest = null, preserveResponse = null, contract = { INSTRUCTIONS, DIAGNOSIS_SCHEMA } } = {}) {
    this.#key = apiKey; this.#fetch = fetchImpl; this.config = config;
    this.beforeRequest = beforeRequest; this.contract = contract;
    this.preserveResponse = preserveResponse;
    this.mode = fetchImpl === fetch ? 'openai-live' : 'mock-transport';
  }
  get unavailableReason() { return this.config.valid === false ? 'INVALID_AI_CONFIGURATION' : 'AI_NOT_CONFIGURED'; }
  get configured() { return this.config.valid !== false && typeof this.#key === 'string' && !!this.#key.trim() && !this.#key.startsWith('replace_with_'); }
  requestBody(input) {
    input = withMonetaryFacts(input);
    return { model: this.config.model, reasoning: { effort: this.config.reasoning },
      service_tier: 'default', store: false, max_output_tokens: this.config.maxOutputTokens,
      instructions: this.contract.INSTRUCTIONS, input: [{ role: 'user', content: JSON.stringify(input) }],
      text: { format: { type: 'json_schema', name: 'captureproof_diagnosis', strict: true, schema: this.contract.DIAGNOSIS_SCHEMA } } };
  }
  async analyze(input, { clientRequestId = randomUUID(), onLateMetadata = null, beforeDispatch = null } = {}) {
    if (!this.configured) throw new DiagnosisError(this.unavailableReason);
    input = withMonetaryFacts(input);
    const payload = JSON.stringify(input);
    if (Buffer.byteLength(payload) > LIMITS.inputBytes) throw new DiagnosisError('INPUT_TOO_LARGE');
    const requestBody = JSON.stringify(this.requestBody(input));
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(clientRequestId)) throw new DiagnosisError('INVALID_CLIENT_REQUEST_ID');
    // Reservation/preflight precedes the transport clock and can never cause a retry.
    if (this.beforeRequest) await this.beforeRequest(requestBody);
    const controller = new AbortController(), signal = controller.signal, startedAt = Date.now();
    const metadataOmissions = [];
    const safeIdentifier = (value, field) => {
      if (value === undefined || value === null) return null;
      const secrets = [this.#key, process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET].filter(v => typeof v === 'string' && v);
      if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(value) || /^sk-/.test(value) || secrets.some(secret => value.includes(secret))) {
        metadataOmissions.push(field); return null;
      }
      return value;
    };
    const metadata = { clientRequestId, providerRequestId: null, responseId: null, responseStatus: null,
      usage: null, usageStatus: 'UNKNOWN', providerOutcome: 'UNKNOWN', metadataOmissions,
      effectiveDeadlineMs: this.config.timeoutMs, transportAttempts: 1, localCancellation: false };
    let expired = false, timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true; metadata.localCancellation = true;
        // Abort fetch/body consumption. This is not confirmation of provider cancellation.
        controller.abort(); reject(new DiagnosisError('AI_TIMEOUT'));
      }, this.config.timeoutMs);
    });
    const work = (async () => {
      let response;
      if (beforeDispatch) await beforeDispatch(requestBody);
      if (signal.aborted) throw new DiagnosisError('AI_TIMEOUT');
      response = await this.#fetch('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.#key}`, 'X-Client-Request-Id': clientRequestId },
        body: requestBody
      });
      metadata.providerRequestId = safeIdentifier(response.headers?.get('x-request-id'), 'providerRequestId');
      if (!response.ok) {
        await response.body?.cancel();
        const code = response.status === 401 ? 'AI_AUTHENTICATION_FAILED' : [403, 404].includes(response.status) ? 'AI_MODEL_UNAVAILABLE' : response.status === 429 ? 'AI_RATE_LIMITED' : response.status >= 500 ? 'AI_SERVICE_UNAVAILABLE' : 'AI_REQUEST_REJECTED';
        throw new DiagnosisError(code);
      }
      let text = ''; let bytes = 0; const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > LIMITS.responseBytes) throw new DiagnosisError('AI_RESPONSE_TOO_LARGE');
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
      let body;
      try { body = JSON.parse(text); } catch { throw new DiagnosisError('AI_INVALID_RESPONSE'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DiagnosisError('AI_INVALID_RESPONSE');
      Object.assign(metadata, {
        responseStatus: ['completed', 'incomplete', 'failed', 'in_progress', 'queued', 'cancelled'].includes(body.status) ? body.status : null,
        returnedModel: safeIdentifier(body.model, 'returnedModel'), responseId: safeIdentifier(body.id, 'responseId'),
        returnedServiceTier: safeIdentifier(body.service_tier, 'returnedServiceTier'),
        usage: Object.fromEntries(['input_tokens', 'output_tokens', 'total_tokens'].filter(k => Number.isSafeInteger(body.usage?.[k]) && body.usage[k] >= 0).map(k => [k, body.usage[k]]))
      });
      metadata.providerOutcome = metadata.responseStatus ?? 'UNKNOWN';
      for (const [group, keys] of Object.entries({ input_tokens_details: ['cached_tokens', 'cache_write_tokens'], output_tokens_details: ['reasoning_tokens'] })) {
        const details = Object.fromEntries(keys.filter(k => Number.isSafeInteger(body.usage?.[group]?.[k]) && body.usage[group][k] >= 0).map(k => [k, body.usage[group][k]]));
        if (Object.keys(details).length) metadata.usage[group] = details;
      }
      metadata.usageStatus = Number.isSafeInteger(metadata.usage.input_tokens) && Number.isSafeInteger(metadata.usage.output_tokens) ? 'REPORTED' : 'UNKNOWN';
      if (!Object.keys(metadata.usage).length) metadata.usage = null;
      // Optional private retention precedes JSON/schema validation, including incomplete/refused output.
      // Only message text is handed off; never the raw provider envelope or request headers.
      if (this.preserveResponse) await this.preserveResponse({
        texts: Array.isArray(body.output) ? body.output.filter(o => o?.type === 'message').flatMap(o => Array.isArray(o.content) ? o.content : [])
          .filter(c => ['output_text', 'refusal'].includes(c?.type)).map(c => c.text ?? c.refusal).filter(t => typeof t === 'string') : [],
        metadata: structuredClone({ ...metadata, elapsedMs: Date.now() - startedAt }),
        input, schema: this.contract.DIAGNOSIS_SCHEMA
      });
      const fail = code => { const e = new DiagnosisError(code); e.metadata = metadata; throw e; };
      if (!Array.isArray(body.output)) fail('AI_INVALID_RESPONSE');
      if (body.output.some(o => !o || typeof o !== 'object' || (o.type === 'message' && (!Array.isArray(o.content) || o.content.some(c => !c || typeof c !== 'object'))))) fail('AI_INVALID_RESPONSE');
      if (body.output.some(o => o.type === 'message' && o.content?.some(c => c.type === 'refusal'))) fail('AI_REFUSED');
      if (body.status === 'incomplete') fail('AI_INCOMPLETE_OUTPUT');
      if (body.status === 'failed') fail('AI_RESPONSE_FAILED');
      if (body.status !== 'completed' || !Array.isArray(body.output)) fail('AI_INVALID_RESPONSE');
      const parts = body.output.filter(o => o.type === 'message').flatMap(o => o.content ?? []).filter(c => c.type === 'output_text');
      if (parts.length !== 1 || typeof parts[0].text !== 'string') fail('AI_INVALID_RESPONSE');
      let result;
      try { result = JSON.parse(parts[0].text); } catch { fail('AI_INVALID_OUTPUT_JSON'); }
      return { result, ...metadata };
    })();
    // Observe late settlement without changing the already finalized result. Only safe
    // metadata can reach the existing attempt; no late generated text is accepted.
    const observeLate = () => {
      if (expired && onLateMetadata) {
        try { onLateMetadata(structuredClone({ ...metadata, elapsedMs: Date.now() - startedAt })); }
        catch { /* A closed store cannot be repaired by retransmitting a request. */ }
      }
    };
    work.then(observeLate, observeLate);
    try {
      const output = await Promise.race([work, deadline]);
      return { ...output, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      const failure = expired ? new DiagnosisError('AI_TIMEOUT') : error instanceof DiagnosisError ? error : new DiagnosisError('AI_TRANSPORT_ERROR');
      failure.metadata = structuredClone({ ...metadata, elapsedMs: Date.now() - startedAt });
      throw failure;
    } finally { clearTimeout(timer); }
  }
}
