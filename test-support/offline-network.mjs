// Test-only pre-transmission guard. Real provider calls are forbidden; local HTTP tests remain available.
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
function localOnly(target) {
  const url = target instanceof URL ? target : new URL(typeof target === 'string' ? target : target.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('OFFLINE_EXTERNAL_REQUEST_BLOCKED');
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = (target, options) => { localOnly(target); return nativeFetch(target, { ...options, redirect: 'error' }); };
for (const module of [http, https]) for (const method of ['request', 'get']) {
  const original = module[method];
  module[method] = (...args) => {
    const first = args[0];
    if (typeof first === 'string' || first instanceof URL) localOnly(first);
    else {
      if (module === https || !['127.0.0.1', '::1'].includes(first?.hostname ?? first?.host) || first?.socketPath) throw new Error('OFFLINE_EXTERNAL_REQUEST_BLOCKED');
    }
    return original.apply(module, args);
  };
}
syncBuiltinESMExports();
