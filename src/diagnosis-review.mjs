import { DIAGNOSIS_SCHEMA } from './diagnosis-contract.mjs';

// Retention is not validation: preserve only bounded allowlisted fields for private human review.
// Redact bounded sensitive spans; retain surrounding prose and explicit locations.
export function sanitizeRejectedDiagnosis(candidate, sensitiveValues = [], schema = DIAGNOSIS_SCHEMA, { maxBytes = 12000, maxStringLength = 1800, trustedSources = [] } = {}) {
  const omissions = [], redactions = []; let omittedFields = 0, remainingBytes = Math.min(maxBytes, 128000);
  const omit = (path, reason, count = 1) => {
    omittedFields += count;
    if (omissions.length < 80) omissions.push({ path, reason, count });
  };
  const secrets = sensitiveValues.filter(v => typeof v === 'string' && v.length > 0);
  const sources = new Map(trustedSources.filter(s => /^[a-f0-9]{64}$/.test(s.sha256) && s.revision === s.sha256).map(s => [s.id, s.sha256]));
  const trustedDigest = (value, path, parent) => /^diagnosis\.(?:findings\.\d+|fixDirection|regressionTest)\.codeRefs\.\d+\.sourceSha256$/.test(path) && sources.get(parent?.sourceRef) === value;
  function redact(text, path, parent) {
    const spans=[];
    for(const secret of secrets)for(let start=text.indexOf(secret);start>=0;start=text.indexOf(secret,start+secret.length))spans.push({start,end:start+secret.length,reason:'EXACT_SECRET'});
    const rules=[
      ['AUTHORIZATION', /\b(?:Bearer|Basic)\s+[^\s"',;]+/gi],
      ['API_KEY', /\bsk-[A-Za-z0-9_-]+/g],
      ['CREDENTIAL_ASSIGNMENT', /\b(?:authorization|client_secret|api_key|password)\s*["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\n,;}]+)/gi],
      ['PRIVATE_KEY', /-----BEGIN[\s\S]*?(?:-----END[^\n]*|$)/g],
      ['EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
      ['URL', /https?:\/\/[^\s"'<>]+/gi],
      ['PERSONAL_DATA', /\b(?:buyer|payer|shipping|billing)\s+(?:name|address|email|phone)\s*[:=][^\n;}]+/gi],
      ['PHONE_LIKE', /\+?\d[\d ()-]{9,}\d/g],
      ['CONTROL_CHARACTER', /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g]
    ];
    for(const[reason,pattern]of rules){
      // Only the phone heuristic is bypassed, only for this exact typed, input-bound digest.
      // Exact credentials and every other detector still take precedence.
      if(reason==='PHONE_LIKE'&&trustedDigest(text,path,parent))continue;
      for(const match of text.matchAll(pattern))spans.push({start:match.index,end:match.index+match[0].length,reason});
    }
    spans.sort((a,b)=>a.start-b.start||b.end-a.end);
    const merged=[];for(const span of spans){const last=merged.at(-1);if(last&&span.start<last.end){last.end=Math.max(last.end,span.end);if(!last.reasons.includes(span.reason))last.reasons.push(span.reason);}else merged.push({...span,reasons:[span.reason]});}
    if(redactions.length+merged.length>80){omit(path,'REDACTION_LIMIT');return '[REDACTED:REDACTION_LIMIT]';}
    let result='',cursor=0;for(const span of merged){result+=text.slice(cursor,span.start)+`[REDACTED:${span.reasons.join('+')}]`;cursor=span.end;redactions.push({path,start:span.start,end:span.end,reasons:span.reasons});}return result+text.slice(cursor);
  }
  function visit(value, schema, path, parent) {
    if (schema.anyOf) {
      const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      const selected = schema.anyOf.find(s => s.type === type || type === 'number' && s.type === 'integer');
      if (!selected) { omit(path, 'UNSUPPORTED_TYPE'); return undefined; }
      return visit(value, selected, path, parent);
    }
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { omit(path, 'UNSUPPORTED_TYPE'); return undefined; }
      const extras = Object.keys(value).filter(k => !Object.hasOwn(schema.properties, k)).length;
      if (extras) omit(`${path}.*`, 'UNALLOWLISTED_FIELDS', extras);
      const out = {};
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (!Object.hasOwn(value, key)) { omit(`${path}.${key}`, 'FIELD_NOT_PRESENT'); continue; }
        const child = visit(value[key], childSchema, `${path}.${key}`, value);
        if (child !== undefined) out[key] = child;
      }
      return out;
    }
    if (schema.type === 'array') {
      if (!Array.isArray(value)) { omit(path, 'UNSUPPORTED_TYPE'); return undefined; }
      const out = [];
      if (value.length > schema.maxItems) omit(path, 'ARRAY_LIMIT', value.length - schema.maxItems);
      value.slice(0, schema.maxItems).forEach((v, i) => {
        const child = visit(v, schema.items, `${path}.${i}`);
        if (child !== undefined) out.push(child);
      });
      return out;
    }
    if (schema.type === 'string') {
      if (typeof value !== 'string') { omit(path, 'UNSUPPORTED_TYPE'); return undefined; }
      if (value.length > Math.min(schema.maxLength ?? maxStringLength, maxStringLength, 128000)) { omit(path, 'STRING_LIMIT'); return undefined; }
      value = redact(value, path, parent);
    } else if (schema.type === 'null' ? value !== null : schema.type === 'boolean' ? typeof value !== 'boolean' :
      typeof value !== 'number' || !Number.isFinite(value)) { omit(path, 'UNSUPPORTED_TYPE'); return undefined; }
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > remainingBytes) { omit(path, 'CONTENT_BYTE_LIMIT'); return undefined; }
    remainingBytes -= bytes;
    return value;
  }
  const fields = candidate === undefined ? (omit('diagnosis', 'NO_PARSED_DIAGNOSIS'), null) : visit(candidate, schema, 'diagnosis') ?? null;
  return { classification: 'UNVALIDATED_REJECTED_OUTPUT', trustedEvidence: false, fields, omissions, omittedFields, redactions,
    redactedFields: new Set(redactions.map(r=>r.path)).size,
    omissionListCapped: omittedFields > 0 && omissions.length === 80, policy: 'Allowlisted fields only; sensitive spans have explicit redaction markers and locations. Unsupported/oversized values are omitted. Only input-bound typed source digests bypass the phone heuristic. No acceptance, original-byte recovery or semantic correctness implied.' };
}

// A parseable message is traversed by typed schema rather than treated as one giant string.
// Re-serialization is explicitly labeled, never represented as original response bytes.
export function sanitizeResponseTexts(texts, sensitiveValues, schema, trustedSources = []) {
  const messages = texts.slice(0,16).map(text => {
    let parsed;
    try { parsed=JSON.parse(text); } catch { /* Preserve safe spans of incomplete/non-JSON output. */ }
    if(parsed && typeof parsed==='object' && !Array.isArray(parsed))return { representation:'RESERIALIZED_SANITIZED_PARSED_JSON',
      ...sanitizeRejectedDiagnosis(parsed,sensitiveValues,schema,{maxBytes:128000,maxStringLength:128000,trustedSources}) };
    const textSchema={type:'object',properties:{text:{type:'string',maxLength:128000}}};
    return {representation:'SANITIZED_TEXT',...sanitizeRejectedDiagnosis({text},sensitiveValues,textSchema,{maxBytes:128000,maxStringLength:128000})};
  });
  return {classification:'UNVALIDATED_MODEL_TEXT',originalBytesRetained:false,messages,omittedMessages:Math.max(0,texts.length-16),
    omittedFields:messages.reduce((n,m)=>n+m.omittedFields,0),redactedFields:messages.reduce((n,m)=>n+m.redactedFields,0)};
}
