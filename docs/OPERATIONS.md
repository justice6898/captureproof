# Operating CaptureProof

See the [README](../README.md) for the short introduction and report quick start. This guide covers the supported execution workflow, evidence export, optional Sandbox checkout and separately authorized model generation.

## Run the application and verify your own supported change

The executable application registers supported source, previews a bounded execution plan, runs explicitly requested local campaigns, and exports exact results.

Supported execution platform: **macOS Apple Silicon, Node 24+, npm, sandbox-exec**, with pinned Medusa 2.7.0 and PayPal Server SDK 1.0.0. Other hosts can read the HTML; execution fails closed when required isolation or dependencies are unavailable.

From the repository root:

```sh
npm test
npm run verify -- check
# Only when dependencies are missing; this downloads public registry packages:
npm run external:setup
npm run verify -- check
npm run verify -- init my-change
# Edit candidates/my-change/provider.cjs and the listed helpers.
npm run verify -- import my-change
npm run start:verification -- 3200
```

Open **http://127.0.0.1:3200/external**. An empty workspace offers **Inspect bundled recorded comparison**. **Verify my change** opens the candidate workflow. Choose the imported candidate, then **Review execution plan · no execution**. Check scenarios, source identity and execution count before explicitly choosing **Run regression campaign**. CLI equivalent: `npm run verify -- run <candidate-id>`. Each campaign starts eight isolated local integrations; provider transport is simulated and the database/SDK are real. Reading the example does not authorize or start those executions. A plan preview followed by the bundled example shows two different things: your proposed run and an earlier frozen result. The earlier result does not validate your newly selected candidate.

Import freezes source without executing it. Candidates are trusted local flat CommonJS files with a `captureproof-medusa-candidate-1` manifest, pinned target/base hashes and required helpers. Arbitrary repositories are unsupported. `candidates/intentional-rejection` is a deliberate injected defect, not the upstream example. Dependency setup uses pinned npm packages with installation scripts disabled and validates source parity. No dependencies or database are bundled. Never weaken isolation to bypass a capability error.

Keep the returned job ID. `npm run verify -- show <job-id>` and UI refresh read its saved state. Default state is `data/verification-workspace`; CLI `--state <directory>` must match the optional state-directory argument to `start:verification`. Explicit job URLs retain their selection. A missing selected job is an error, not a fallback to recorded evidence. Inspect interrupted jobs before retrying; unfinished or unavailable evidence stays INCONCLUSIVE.

## Inspect and export a result

Use **Inspect evidence**, then inspect provider/merchant snapshots, source citations and separate repair evidence. Deterministic payment rules do not depend on AI review. Confirmed binding violations remain FAIL even when other evidence is unresolved. A separate current assessment never overwrites the recorded historical verdict.

A completed execution offers **Download portable HTML**, **Export replayable failure** and, when bound, **Export matching repair comparison**. Or:

```sh
npm run report:export -- ./candidate-report --job <job-id> --run <execution-id> --state data/verification-workspace
```

The destination must not exist. This validates saved source/artifact identities and starts nothing. PASS or INCONCLUSIVE without an observed failing rule produces an evidence-only report. Missing counters remain unknown; missing or mismatched required records are refused. New executions do not inherit the bundled AI response or replay status.

`npm run verify -- replay <downloaded-reproducer.json>` explicitly starts one new integration execution after setup. Saved replay associations require exact artifact bytes, source, origin and scenario, not a matching scenario name. Downloading is not replaying. The included original replay is REPRODUCED; the paired repair replay is NOT_REPRODUCED for the original violation, not proof of universal safety.

## Optional services and generation

Ordinary verification/example startup is offline. **Review AI input & cost for this execution** reads the bound input and saved attempts without generating. Historical v4 ACCEPTED/PARTIAL and v5 incomplete/null remain preserved privately; this public projection includes only the selected v6 response, its input, review, estimated usage/cost and frozen source. Provider routing IDs and unrelated attempts are omitted; reviewed prose and evidence are unchanged.

Real generation is separate: `npm run start:assistance -- <port> <state-directory> <approved-request.json>` requires a current server-side approval binding one request identity/hash, reviewed cost/pricing, maximum estimate, expiry and one-attempt limit. No approval is distributed. The UI additionally requires explicit paid confirmation. No automatic retry, paid grading, arbitrary financial action or automatic patch application is provided. Expired pricing/approval blocks dispatch; configuring a key is not authorization. Estimates are not confirmed billing or provider-enforced caps.

For separately authorized Sandbox work, copy `.env.example` to ignored `.env`, restrict it with `chmod 600 .env`, and enter Sandbox `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` locally. Optional `OPENAI_API_KEY` stays server-side. Never put secrets in candidates or reports. `npm start` loads `.env` and serves the separate checkout at http://127.0.0.1:3000 (or configured PORT); explicit checkout/diagnosis actions can contact paid/external services. Keep them unconfigured for the recorded route.

## Separate PayPal Sandbox checkout

The supported checkout is a separate one-product USD flow, not the simulated-provider Medusa demonstration. `npm start` loads the ignored `.env` with Node's environment-file option; default URL is **http://127.0.0.1:3000/** (`PORT` may override it). Use a Sandbox app linked to a Business account and a separate Personal Sandbox buyer. Keep `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` local and server-side. Preserve an existing `.env`; do not overwrite configured values.

The checkout UI creates the order, opens manual Sandbox approval, then requests server-side capture and read-back. Approval alone does not mark it paid. For separately authorized fault testing, `ENABLE_TEST_FAULTS=true` exposes application-level response discarding; recovery reads the same provider order. It is not a demonstrated network outage.

- `src/paypal-sandbox.mjs` fixes the endpoint to `https://api-m.sandbox.paypal.com`, performs OAuth, creates an Orders v2 CAPTURE order, captures it and reads it back. POST operations carry their persisted `PayPal-Request-Id`.
- `src/checkout-contract.mjs` owns the product, integer-minor-unit USD amount and evidence binding checks. `src/checkout-service.mjs` coordinates capture/read-back and recovery; response success alone cannot write paid state.
- `src/order-store.mjs` persists merchant orders and entitlements in SQLite. `server.mjs` connects this adapter to the checkout routes; `public/checkout.js` supplies the approval/capture/recovery UI.

Normal capture and application-response-discard recovery were observed in separate genuine Sandbox development transactions. Those private records are not included or newly exposed here. They do not prove live Sandbox behavior for the primary upstream PENDING example. `start:verification` and `start:example` remain offline and do not load these credentials. 

## Recorded evidence and model review

At the first returned-call boundary, original Medusa state is completed with one capture row while provider capture is PENDING. The developer repair retains local authorized state with zero rows at that same boundary. **Authorized is a local merchant state, not proof of PayPal authorization or money movement.** Later completed read-back and repeated calls are shown separately. Repeated POSTs are not duplicate charges: inspect request, provider resource and row counts separately.

The selected execution is `f111b657-0de7-4b05-91d0-9cafcaf3449b`. Exactly one saved response is selected by ID: `3dcbf49c-439b-441a-9b69-3e8acd643054`, external-diagnosis-6, actual gpt-6.1-sol / medium / default. It completed, passed structural validation and received same-development-session semantic PASS over 46 prose fields. This is one reviewed case, not blind evaluation or general AI accuracy. Five proposed regression-control kinds are structurally complete; **AI-proposed corrections and tests were not executed**. The displayed tested repair was independently developer-authored earlier; AI did not create or verify it.

This example contains saved **real Medusa/PostgreSQL/installed SDK execution with simulated PayPal**. Genuine Sandbox checkout and response-discard recovery were verified separately in development; they do not establish live PayPal verification for this upstream PENDING scenario. No real network outage, concurrency, fulfillment or production guarantee is demonstrated here.

Historical routes remain `/examples/reviewed-comparison` (earlier same-run report without AI) and `/examples/upstream-pending` (separate older execution with PARTIAL AI review). Their HTML/manifest bytes are unchanged. Missing or corrupt primary assets produce an error; another execution is never substituted.

## Verification and attribution

The distributed example and application have been checked on the same supported Mac with offline tests and real-browser inspection. That is not fresh-machine installation, independent-user validation or production verification. The report retains exact source, execution and review identities.

Codex assisted implementation, documentation and local verification. The included diagnostic response is a separate real saved OpenAI response; its model configuration and review scope are described above. The developer repair predates that response.
