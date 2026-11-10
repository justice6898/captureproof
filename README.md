# CaptureProof — release candidate

CaptureProof checks a supported PayPal integration against independent payment-provider and merchant observations. It includes an executable local candidate workflow and an offline recorded report. **The static report is evidence for selected past executions, not the full application or a certification.**

Run the commands below from the prepared distribution directory, not the original historical workspace.

[Recorded demo script](docs/DEMO.md) · [Submission draft and missing inputs](docs/SUBMISSION.md). These new publication documents do not change the immutable example or imply another installation/reproduction.

This is a development source snapshot for [justice6898/captureproof](https://github.com/justice6898/captureproof), **not a final frozen release**. Original CaptureProof material owned by Jeongui Hong is licensed under **MIT**, **Copyright (c) 2026 Jeongui Hong**, in [LICENSE](LICENSE). This does not relicense third-party material. Preserve the third-party notices in `LICENSES.md`.

## 1. Inspect the recorded example first — no credentials or installation

Open `data/portable-reports/upstream-pending-replayed-2026-10-29/report.html` directly in a browser. That one HTML file embeds evidence, executed source, the separately authored repair comparison, matching historical AI response/review and downloadable artifacts. It works offline. The adjacent manifest hashes the delivered HTML; embedded checksums cover downloads. No original database is required.

On the supported Mac with Node 24+, an optional read-only server is:

```sh
npm run start:example -- 3100
```

Open **http://127.0.0.1:3100/external**. Download the whole HTML at **http://127.0.0.1:3100/examples/upstream-pending/download**, or use the report's buttons to save its exact reproducer/evidence. This server allows only selected reads, scrubs inherited credentials, blocks outgoing application network calls and uses macOS sandbox-exec. It cannot launch a verification. `npm run start:demo -- 3100` in the distribution is an alias for this recorded path.

The upstream example observed a PENDING provider capture while Medusa recorded completed payment and one capture row. Its repair retained merchant state `authorized` with zero capture rows while pending, then recorded one row after completed read-back. `authorized` is a local merchant state here; it does not establish an actual PayPal authorization event or money movement. These are saved **actual Medusa/PostgreSQL/SDK executions with simulated PayPal**, not live Sandbox evidence. The stored AI response remains **structural ACCEPTED / preservation PASS / semantic PARTIAL; approved reuse blocked**. Replay success applies only to the exact identified exported artifact and saved replay receipt. Reading or exporting never constitutes a new replay.

The reviewed current comparison is also available offline at [Current comparison report](data/portable-reports/developer-reviewed-2026-11-06/report.html). It identifies its own campaign and exact replay inputs, has no matching AI response, and does not inherit the historical example’s AI review. Opening HTML or downloading a reproducer does not execute it. Running a replay requires the supported installed workspace described below.

## 2. Check execution capability

Use a normal Terminal outside a parent sandbox. The controller must create each database/worker's own OS sandbox; applying an outer sandbox can prevent that. A different port alone does not fix the execution context. `npm run start:verification` removes inherited credentials and loads no `.env`; external application HTTP is blocked. The bounded child-sandbox check runs only an OS utility, not candidate code or PostgreSQL. It establishes sandbox application capability, while each real execution independently checks its full containment and database observations.

The UI separates dependencies, isolation capability and active execution. It caches capability for 30 seconds; every new admission or explicit retry rechecks it server-side. **Recheck capability** starts no campaign. Missing dependencies and unavailable isolation have different recovery actions; there is no unsandboxed candidate fallback.

### Install only if dependencies are missing

Supported runner: **macOS on Apple Silicon, Node.js 24+ with npm, `/usr/bin/sandbox-exec`**, and permission to start local isolated PostgreSQL processes. Other platforms are not supported. Root npm installation is unnecessary. The runtime uses pinned Medusa **2.7.0**, PayPal Server SDK **1.0.0**, embedded PostgreSQL package **16.14.0-beta.17**, and the exact transitive lockfile. Source and pin provenance are in `external/medusa-persistence/provenance.json`.

```sh
npm test
npm run verify -- check
# Only if dependencies are missing; this downloads public registry packages:
npm run external:setup
npm run verify -- check
```

Distribution `npm test` runs only the listed offline unit/HTTP/packaging tests; it starts no Medusa/PostgreSQL experiment. Setup uses `npm ci --ignore-scripts`, restores declared native-package symlinks, and checks published-source parity and pinned hashes. No dependencies or databases are bundled. Do not weaken isolation when preflight reports a blocker. The November 4 release manifest was installed successfully on November 5 in its separate directory on the existing Mac: 598 packages, unchanged pins/source parity and READY preflight. One exported upstream failure was actually reproduced. This is not new-machine validation; recorded viewing still needs no runtime packages.

## 3. Register a supported candidate, then explicitly verify

```sh
npm run verify -- init my-change
# Edit candidates/my-change/provider.cjs and its listed helpers.
npm run verify -- import my-change
npm run start:verification -- 3200
```

Open **http://127.0.0.1:3200/external**. Import freezes validated files without executing them. The included `intentional-rejection` candidate is an explicitly injected defect. The built-in revision 3 follows the same supplied-source contract. Candidates must be trusted local developer code, flat CommonJS files with a `captureproof-medusa-candidate-1` manifest, the pinned target/base hash, and required helpers; arbitrary repositories are not supported.

Choose **Verify my change**, validate/import your edited candidate, then click **Review execution plan · no execution**. Inspect its scenarios, source identity and execution count before explicitly launching **Run regression campaign**, or `npm run verify -- run <candidate-id>`. Each campaign starts **8 isolated local integration executions**. Provider transport is simulated; the database and installed SDK are real. No API credentials are used. This is separate from reading the example, and was **not run during release preparation**. The historical execution allowance remains 42/42. A separately authorized repair allowance is tracked outside the distributed source; these commands describe capability, not an unlimited execution authorization.

Keep the returned job ID. `npm run verify -- show <job-id>`, reload and reopening with the same state directory read the existing job. UI/CLI default to `data/verification-workspace`; optional CLI `--state <directory>` must correspond to the server's optional state-directory argument. If interrupted, inspect that job's state/error before an explicit retry. Do not blindly repeat launch commands. Missing or unfinished evidence is INCONCLUSIVE, not a completed payment or a successful test.

## 4. Inspect, export and replay the exact result

The empty application workspace offers **Inspect bundled recorded comparison**. Its HTML and manifest are hash-checked directly; no private jobs or omitted evidence sidecars are needed. A populated workspace may offer **Inspect workspace comparison** for its exact saved selection. The separate earlier AI example never supplies an answer for a different run. Missing or altered bundled files show an integrity/unavailability message, without launching or substituting another run. On unsupported execution hosts, open either bundled HTML directly in a browser; dependency setup is unnecessary for recorded viewing.

Exact-run AI remains opt-in. Ordinary `npm run start:verification` is offline and cannot generate a real response. The trusted `npm run start:assistance -- <port> <state-directory> <approved-request.json>` entry permits only a bound Responses API POST; candidate workers keep their existing scrubbed environment and OS restrictions. It reads only `OPENAI_API_KEY` from the ignored local `.env`, without exporting credentials to workers. Do not run it merely to test connectivity.

Before that entry can dispatch, the owner must approve one concrete preview: job/execution, request identity/hash, cost hash, pricing-review hash, maximum estimate (at most $0.30), one attempt, and expiry. The server-only approval file must carry those exact values plus `authorized: true`; an unapproved proposal has `authorized: false`. Neither a key nor a browser-supplied price grants permission. The existing UI separately requires **Confirm one paid explanation**. No authorization file is distributed. One separately authorized real model response completed in the private development workspace under the previous contract; its original ACCEPTED / PARTIAL assessment remains unchanged. Its permission was revoked and its private request/response are not distributed. The reviewed pricing policy expires; unavailable/expired pricing blocks dispatch until official rates and the proposal are reviewed again. Estimates are not provider-enforced caps or settled billing.

Preview/reload/download remain read-only. Stored attempts appear in the preview even after approval expires. Concurrent or repeated requests reuse the durable attempt; a possibly transmitted request is never automatically retried or assumed free. Pending, response preservation, structural/factual validation, semantic review and actual repair testing remain distinct. A response can be rejected and still be privately retained; an accepted explanation is not verified repair evidence. A changed input or configuration invalidates consent. This is local deduplication, not provider exactly-once execution.

### Versioned regression guidance

Future external diagnoses use **external-diagnosis-5**. Proposed controls include purpose, preconditions, ordered actions, observable assertions with boundaries, execution-bound references and explicit evidence gaps. Controls are **proposed / not applicable**, never fabricated executed results; actual observations remain in their own evidence fields. Issue diagnoses under the supported capture contract require normal completion, unavailable read-back and conflicting-evidence controls; PENDING and restart/repetition controls depend on the supplied observations. Healthy results need no invented fix; insufficient evidence calls for bounded evidence collection.

Validation distinguishes structure, exact evidence/reference integrity, guidance coverage and independent semantic judgment. Enum/range/identity/coverage checks cannot prove that prose is useful or supported by the cited source. A concrete-looking but misleading proposal still requires human review. Old answers load under their original contracts; ACCEPTED and PARTIAL can both be correct. New read-only annotations bind the exact historical input/result/record and do not upgrade the answer. The historical bundled reports are immutable and retain their original UI/reviews. New JSON and portable reports include version-aware guidance metadata and readable controls.

No real request has tested v5 model adherence. Its larger request is reflected in the future preview and full-body cost estimate; prior approval hashes cannot authorize it. There is no distributed live permission, automatic test execution, repair application or paid grading.

Confirmed binding violations remain FAIL even when completion is still unresolved. The unresolved boundary is displayed separately. Newly exported/read evidence can include **Separate current assessment · persistence-assessment-2**; this is a read-only interpretation, not a rewrite of the original recorded verdict or a new execution. Historical bundled HTML stays immutable.

Selected executions offer **Review AI input & cost for this execution**. Preview includes bound code/evidence, full request identity and a conservative estimate. Live dispatch is disabled in the offline application; only an injected test transport is enabled by tests. A separately authorized live check must revalidate current pricing and credentials in a trusted controller, outside isolated candidate workers. No API key belongs in candidate files or exports. One request identity retains its attempt after duplicates, failures or interrupted transport; it is never automatically retried. Structural/factual validation, semantic review and separately executed repair tests remain distinct. Existing PARTIAL reviews are unchanged.

Open a scenario's **Inspect evidence** link. Provider and committed merchant state appear together. History can remain INCONCLUSIVE while the final checkpoint passes. An initialization failure has no comparable payment results; unobserved scenarios are NOT RUN. Source and separately tested repair are inspectable. Stored AI remains a separate reviewed record; this workflow does not generate a diagnosis.

**Export replayable failure** downloads the exact JSON passed to a new replay. **Export matching repair comparison** keeps the original scenario, origin and rule, replacing only the implementation with the frozen paired candidate. Each replay starts one execution. The runner retains the input bytes and SHA-256, and the report revalidates the saved raw execution, source, scenario and deterministic rules before attaching a replay result. Same request key with different bytes is a conflict. A same-named scenario or an older receipt cannot substitute.

Return to the originating campaign after replay and reopen its evidence. **Open saved replay** and **Open saved repair replay** lead to the linked jobs; a newly downloaded portable HTML includes their verified association. Earlier downloaded reports stay unchanged. An artifact with different bytes remains unverified even if its parsed JSON looks similar.

### Portable report

On a completed execution card, choose **Download portable HTML** beside the evidence/reproducer exports. Or:

```sh
npm run report:export -- ./candidate-report --job <job-id> --run <execution-id> --state data/verification-workspace
```

The destination must not exist. This validates persisted artifact/source identities and starts nothing. FAIL includes its exact failure reproducer. PASS or INCONCLUSIVE without a failing rule is evidence-only. Missing counters remain Unknown; incomplete jobs or corrupt required evidence are refused. AI and repair sections require matching records; they are not mandatory and no response is generated. A new run does not inherit the bundled example's AI or replay result.

To reproduce a saved failure later, `npm run verify -- replay <downloaded-reproducer.json>` starts **one new integration execution**, requiring the installed runtime. Reduction is unnecessary for the recorded exercise. Do not confuse downloading with executing. The no-selection `report:export` command is a historical-workspace convenience; use explicit job/run/state for your own work. To save the bundled example, use its fixed HTML download, not a historical database regeneration.

## 5. Optional external services — separate from local verification

The shipped `.env.example` contains placeholders and safe local defaults only. Copy it locally to ignored `.env`, restrict permissions (`chmod 600 .env`), and enter credentials there, never in chat or source control. `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` must belong to a **Sandbox** app; use a separate Sandbox buyer. `OPENAI_API_KEY` is optional; `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` retain the existing diagnostic configuration. Configuring a key does not authorize paid evaluation.

`npm start` loads `.env` and opens the separate local Sandbox checkout at **http://127.0.0.1:3000** (or configured PORT). Explicit create/approval/capture/recovery actions can call PayPal Sandbox; explicit diagnosis can incur API cost. Keep these services unconfigured for the recorded exercise. Verification/example startup ignores credentials. No paid model evaluation is included or scheduled; model and Sandbox transactions were not reverified for this release.

## Independent recorded-evidence handoff

Without coaching, open the report; identify the provider/merchant mismatch and a supporting checkpoint; locate the executed source and separately tested repair; download the HTML and exact reproducer; explain which components were simulated and which actually ran. Distinguish the AI review from the deterministic rules and state what the example does **not** establish. Note any confusing steps. Do **not** launch a campaign/replay or external call for this exercise. No tester feedback is fabricated and agent walkthroughs are not independent human validation.

## Distribution integrity and limits

`source-bundle.json` is the explicit staged file list, byte counts and SHA-256 hashes, including original hashes for any documentation/package derivatives. `scripts/prepare-first-use.mjs` contains the release allowlist. Only the two pinned self-contained reports and their two manifests under `data/` are intentionally distributed; private application DBs, environment files, cost ledgers, other experiments, caches and node_modules are excluded. Preserve notices when copying.

The historical report remains byte-identical. Source/evidence digests identify bytes, not publisher authenticity. This public-source candidate is prepared locally on the existing Mac; it is **not** a final frozen release, fresh installation, independent human test or deployment. The recorded successful same-Mac installation/reproduction belongs to the earlier November 4 release, not this candidate. New-machine installation and broader platform/browser/production correctness remain unverified. MIT adoption is complete. Updates to the public repository require explicit owner authorization; this source does not grant payment, model, deployment or campaign permission.
