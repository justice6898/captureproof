// Trusted server entry only. Ordinary verification and all candidate workers stay offline.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { readExecutionApproval } from '../src/execution-assistance-policy.mjs';
const [port, state, approvalPath] = process.argv.slice(2);
try {
  if (!port || !state || !approvalPath || process.argv.length !== 5) {
    throw Error('USAGE: npm run start:assistance -- <port> <state-directory> <approved-request.json>');
  }
  if (readExecutionApproval(approvalPath)()?.authorized !== true) throw Error('EXPLICIT_REQUEST_APPROVAL_REQUIRED');
  const responseFetch = globalThis.fetch;
  await import('../test-support/offline-network.mjs');
  // Read only the credential needed by the trusted adapter; never copy .env into process.env.
  const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  if ((envText.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=/gm) ?? []).length !== 1) throw Error('UNIQUE_LOCAL_OPENAI_KEY_REQUIRED');
  const apiKey = parseEnv(envText).OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('replace_with_')) throw Error('LOCAL_OPENAI_KEY_REQUIRED');
  const { startServer } = await import('../server.mjs');
  await startServer({ argv: ['--verification', port, resolve(state)], responseFetch, approvalPath: resolve(approvalPath), apiKey, providerMode: 'openai-live' });
} catch (error) {
  const allowed = ['USAGE:', 'EXPLICIT_REQUEST_APPROVAL_REQUIRED', 'UNIQUE_LOCAL_OPENAI_KEY_REQUIRED', 'LOCAL_OPENAI_KEY_REQUIRED'];
  console.error(allowed.some(prefix => error.message?.startsWith(prefix)) ? error.message : 'ASSISTANCE_STARTUP_FAILED');
  process.exitCode = 1;
}
