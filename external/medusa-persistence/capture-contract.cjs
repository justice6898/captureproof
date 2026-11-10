// Endpoint documentation, application policy and historical simulator scope are separate.
const APPLICATION_REPLAY_WINDOW_MS = 3600000;
const captureContract = {
  revision: 'capture-contract-1', retrievedAt: '2026-10-21',
  endpoint: 'POST /v2/payments/authorizations/{authorization_id}/capture',
  sdk: '@paypal/paypal-server-sdk@1.0.0', header: 'PayPal-Request-Id',
  documentedProvider: { retentionDays: 45, empiricallyVerified: false,
    sources: [
      { url: 'https://github.com/paypal/PayPal-PHP-Server-SDK/blob/main/doc/controllers/payments.md#capture-authorized-payment', section: 'Capture Authorized Payment / paypalRequestId', finding: 'Documents 45-day key retention.' },
      { url: 'https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/main/doc/controllers/payments.md#capture-authorized-payment', section: 'Capture Authorized Payment / paypalRequestId', finding: 'Independently documents the same 45-day retention.' },
      { url: 'https://developer.paypal.com/api/payments/v2/authorizations-capture', section: 'Endpoint and Header Parameters', finding: 'Exact endpoint and header; current REST page omits a duration.' },
      { url: 'https://developer.paypal.com/api/rest/reference/idempotency/', section: 'Example / Usage notes', finding: 'Same-ID authorized-capture retry while the ID is retained; simultaneous requests may fail.' }
    ],
    installedSource: 'node_modules/@paypal/paypal-server-sdk/dist/cjs/controllers/paymentsController.js:72-110',
    ambiguity: 'SDK prose specifies 45 days; REST reference omits the duration. No measured retention, exact provider clock boundary, account-specific guarantee or live retry is established.' },
  application: { revision: 'candidate-v3', replayWindowMs: APPLICATION_REPLAY_WINDOW_MS,
    anchor: 'Durable operation.created_at, reserved before dispatch; never reset by update, retry or restart.',
    timing: 'Require valid created_at <= updated_at <= now and 0 <= now - created_at < 1 hour. Reservation is not provider acceptance time. Assumes a coherent database/application clock; no proof against undetectable wall-clock rollback.',
    merchantScope: 'One fixed Sandbox merchant context; configuration must match the persisted binding. No third-party assertion or multi-merchant support.' },
  observed: 'Historical revision-2 SIGKILL and same-ID SDK replay under a simulated one-hour contract. Revision-3 deterministic-time and focused crash checks are separate; no 45-day experiment or live PayPal verification.'
};
module.exports = { APPLICATION_REPLAY_WINDOW_MS, captureContract };
